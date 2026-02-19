require('dotenv').config();
const http = require('http');
const Planner = require('./planner');
const Coder = require('./coder');
const GitHubClient = require('./githubClient');
const PreviewManager = require('./previewManager');
const LineNotifier = require('../../webhook-receiver/src/lineNotifier');
const db = require('../../shared/db');
const logger = require('../../shared/logger');

const MAX_RETRY = parseInt(process.env.MAX_RETRY_COUNT || '3');

const planner = new Planner();
const coder = new Coder();
const github = new GitHubClient();
const preview = new PreviewManager();
const notifier = new LineNotifier(process.env.LINE_CHANNEL_ACCESS_TOKEN);

// 現在処理中のプロジェクトID（グローバルエラーハンドリング用）
let currentProjectId = null;
let currentUserId = null;

// ────────────────────────────────────────────
// ジョブポーリング（webhook-receiverがDBにキューを積んだものを検知）
// ────────────────────────────────────────────

async function pollJobs() {
  const db_ = db;

  setInterval(async () => {
    if (currentProjectId) return; // 処理中は次のポーリングをスキップ

    // statusが 'queued' のプロジェクトを1件取得
    // NOTE: 実際にはdb.getNextQueuedProject()を実装する
    // ここでは簡易的にDBを直接参照
    try {
      await checkAndRunNextJob();
    } catch (err) {
      logger.error('poll error', { err: err.message });
    }
  }, 3000); // 3秒ごとにポーリング
}

async function checkAndRunNextJob() {
  
  const path = require('path');
  const dbPath = process.env.DB_PATH || path.join(__dirname, '../../db/projects.db');

  let rawDb;
  try {
    rawDb = new Database(dbPath);
  } catch {
    return; // DBがまだ存在しない場合はスキップ
  }

  const row = rawDb.prepare(
    "SELECT * FROM projects WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1"
  ).get();

  if (!row) return;

  // フィードバック待ちのジョブも確認
  const fbRow = rawDb.prepare(
    "SELECT * FROM projects WHERE status = 'awaiting_processing' ORDER BY updated_at ASC LIMIT 1"
  ).get();

  rawDb.close();

  if (row) {
    await runNewProject(row);
  } else if (fbRow) {
    await runFeedback(fbRow);
  }
}

// ────────────────────────────────────────────
// 新規案件処理
// ────────────────────────────────────────────

async function runNewProject(project) {
  currentProjectId = project.id;
  currentUserId = project.line_user_id;

  logger.info('runner: starting new project', { projectId: project.id });

  try {
    // Phase 1: 計画立案
    db.updateStatus(project.id, 'planning');
    const plan = await withRetry(() => planner.generate(project.description, project.id));
    db.updateProjectFields(project.id, { title: plan.title, plan_markdown: plan.markdown });
    await notifier.notifyPlanReady(project.line_user_id, project.id, plan.markdown);

    // Phase 2: コード生成
    db.updateStatus(project.id, 'coding');
    const fileMap = await withRetry(() =>
      coder.generate(plan, (percent) => {
        if (percent === 50) {
          notifier.notifyProgress(project.line_user_id, project.id, 50).catch(() => {});
        }
      })
    );

    // Phase 3: GitHub操作
    db.updateStatus(project.id, 'github');
    const repo = await withRetry(() =>
      github.createRepo(plan.repoName, plan.title)
    );
    const { prUrl, branch } = await withRetry(() =>
      github.commitAndPR(repo.repoName, fileMap, plan.title, project.id)
    );
    db.updateProjectFields(project.id, {
      github_repo_url: repo.repoUrl,
      github_pr_url: prUrl,
    });

    // コンテキストを保存（FB時に使用）
    db.updateContext(project.id, {
      repoName: repo.repoName,
      branch,
      planMarkdown: plan.markdown,
    });

    await notifier.notifyPRCreated(project.line_user_id, project.id, prUrl);

    // Phase 4: プレビュー生成
    db.updateStatus(project.id, 'previewing');
    const previewUrl = await preview.deploy(project.id, fileMap);
    if (previewUrl) {
      db.updateProjectFields(project.id, { preview_url: previewUrl });
      await notifier.notifyPreviewReady(project.line_user_id, project.id, previewUrl);
    }

    // 完了
    db.updateStatus(project.id, 'awaiting_feedback');
    logger.info('runner: new project complete', { projectId: project.id, prUrl });

  } catch (err) {
    await handleError(project.id, project.line_user_id, err);
  } finally {
    currentProjectId = null;
    currentUserId = null;
  }
}

// ────────────────────────────────────────────
// フィードバック処理
// ────────────────────────────────────────────

async function runFeedback(project) {
  currentProjectId = project.id;
  currentUserId = project.line_user_id;

  logger.info('runner: processing feedback', { projectId: project.id });

  try {
    // DBから最新のFBメッセージを取得
    
    const path = require('path');
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../db/projects.db');
    const rawDb = new Database(dbPath);

    const fbMsg = rawDb.prepare(
      "SELECT content FROM messages WHERE project_id = ? AND message_type = 'feedback' ORDER BY created_at DESC LIMIT 1"
    ).get(project.id);
    rawDb.close();

    if (!fbMsg) {
      logger.warn('runner: no feedback message found', { projectId: project.id });
      return;
    }

    const feedback = fbMsg.content;
    const context = project.context_json ? JSON.parse(project.context_json) : {};

    db.updateStatus(project.id, 'coding');

    // フィードバックをコードに適用
    const updatedFileMap = await withRetry(() =>
      coder.applyFeedback(project.id, feedback, context.planMarkdown || '')
    );

    // GitHubに追加コミット
    db.updateStatus(project.id, 'github');
    await withRetry(() =>
      github.commitFeedback(context.repoName, context.branch, updatedFileMap, feedback)
    );

    // プレビュー更新
    const previewUrl = await preview.deploy(project.id, updatedFileMap);
    if (previewUrl) {
      db.updateProjectFields(project.id, { preview_url: previewUrl });
    }

    db.updateStatus(project.id, 'awaiting_feedback');
    await notifier.notifyFeedbackDone(project.line_user_id, project.id, project.github_pr_url);

    logger.info('runner: feedback complete', { projectId: project.id });

  } catch (err) {
    await handleError(project.id, project.line_user_id, err);
  } finally {
    currentProjectId = null;
    currentUserId = null;
  }
}

// ────────────────────────────────────────────
// ユーティリティ
// ────────────────────────────────────────────

/**
 * リトライ付き実行（指数バックオフ）
 * @param {function(): Promise<T>} fn
 * @param {number} maxRetry
 * @returns {Promise<T>}
 */
async function withRetry(fn, maxRetry = MAX_RETRY) {
  let lastErr;
  for (let i = 0; i < maxRetry; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const waitMs = Math.pow(2, i) * 1000; // 1s, 2s, 4s...
      logger.warn(`retry ${i + 1}/${maxRetry}`, { err: err.message, waitMs });
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

async function handleError(projectId, userId, err) {
  logger.error('runner: error', { projectId, err: err.message, stack: err.stack });
  db.updateStatus(projectId, 'error');
  db.updateProjectFields(projectId, { error_message: err.message });
  db.incrementRetry(projectId);

  try {
    await notifier.notifyError(userId, projectId, err.message);
  } catch (notifyErr) {
    logger.error('failed to send error notification', { err: notifyErr.message });
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ────────────────────────────────────────────
// グローバルエラーハンドリング
// ────────────────────────────────────────────

process.on('uncaughtException', async (err) => {
  logger.error('uncaughtException', { err: err.message, stack: err.stack });
  if (currentProjectId && currentUserId) {
    await handleError(currentProjectId, currentUserId, err).catch(() => {});
  }
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', { reason: String(reason) });
});

// ────────────────────────────────────────────
// 起動
// ────────────────────────────────────────────

logger.info('claude-runner started');
pollJobs();

// ヘルスチェック用の簡易HTTPサーバー
http.createServer((req, res) => {
  res.writeHead(200);
  res.end(JSON.stringify({ status: 'ok', busy: !!currentProjectId, projectId: currentProjectId }));
}).listen(3001);
