require('dotenv').config();
const express = require('express');
const LineHandler = require('./lineHandler');
const LineNotifier = require('./lineNotifier');
const JobQueue = require('./jobQueue');
const db = require('../../shared/db');
const logger = require('../../shared/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// ────────────────────────────────────────────
// インスタンス生成
// ────────────────────────────────────────────
const lineHandler = new LineHandler(process.env.LINE_CHANNEL_SECRET);
const notifier = new LineNotifier(process.env.LINE_CHANNEL_ACCESS_TOKEN);
const queue = new JobQueue();

// ────────────────────────────────────────────
// ジョブキューのイベントハンドラー
// ────────────────────────────────────────────
queue.on('complete', (job) => {
  logger.info('queue: job complete', { projectId: job.projectId });
});

queue.on('error', async ({ job, err }) => {
  logger.error('queue: job error', { projectId: job.projectId, err: err.message });
  db.updateStatus(job.projectId, 'error');
  db.updateProjectFields(job.projectId, { error_message: err.message });
  try {
    const project = db.getProject(job.projectId);
    if (project) {
      await notifier.notifyError(project.line_user_id, job.projectId, err.message);
    }
  } catch (notifyErr) {
    logger.error('failed to send error notification', { err: notifyErr.message });
  }
});

// ────────────────────────────────────────────
// ミドルウェア
// ────────────────────────────────────────────

// LINEのWebhook署名検証のために生のbodyが必要
app.use('/webhook/line', express.raw({ type: 'application/json' }));
app.use(express.json());

// ────────────────────────────────────────────
// ルーティング
// ────────────────────────────────────────────

/**
 * POST /webhook/line
 * LINE Webhookの受信口
 */
app.post('/webhook/line', async (req, res) => {
  // 署名検証
  const signature = req.headers['x-line-signature'];
  const rawBody = req.body.toString();

  if (!lineHandler.verify(rawBody, signature)) {
    logger.warn('invalid LINE signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // LINEに即座に200 OKを返す（5秒タイムアウト対策）
  res.status(200).json({ status: 'ok' });

  // 非同期で処理（awaitしない）
  handleWebhookEvents(JSON.parse(rawBody).events).catch(err => {
    logger.error('webhook handling error', { err: err.message });
  });
});

/**
 * GET /health
 */
app.get('/health', (req, res) => {
  res.json({ status: 'ok', queue: queue.getStatus() });
});

/**
 * GET /projects  （デバッグ用・本番では削除またはIP制限）
 */
app.get('/projects', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // NOTE: 簡易実装。実際にはdb.getAllProjectsを実装する
  res.json({ message: 'debug endpoint - check db directly' });
});

// ────────────────────────────────────────────
// Webhookイベント処理（非同期）
// ────────────────────────────────────────────

async function handleWebhookEvents(events) {
  const messages = lineHandler.parse(events);

  for (const msg of messages) {
    logger.info('processing message', { userId: msg.userId, type: msg.messageType });

    switch (msg.messageType) {
      case 'new_project':
        await handleNewProject(msg);
        break;

      case 'feedback':
        await handleFeedback(msg);
        break;

      case 'status_check':
        await handleStatusCheck(msg);
        break;
    }
  }
}

async function handleNewProject(msg) {
  const description = lineHandler.extractDescription(msg.text);

  // DBに案件を作成
  const project = db.createProject({
    lineUserId: msg.userId,
    description,
  });

  // メッセージをDBに保存
  db.saveMessage({
    projectId: project.id,
    lineUserId: msg.userId,
    direction: 'inbound',
    messageType: 'new_project',
    content: description,
  });

  // キューにジョブを追加
  queue.enqueue({
    projectId: project.id,
    type: 'new_project',
    userId: msg.userId,
    description,
    execute: async () => {
      // claude-runnerが別プロセスのため、DBのステータス変化をポーリングで伝達
      // 実際の実装ではIPC/HTTPでclaude-runnerにジョブを送信する
      db.updateStatus(project.id, 'queued');
      logger.info('new_project job queued', { projectId: project.id });
    },
  });

  // 受付通知をLINEに返信
  await notifier.notifyReceived(msg.replyToken, project.id);

  logger.info('new project created', { projectId: project.id, userId: msg.userId });
}

async function handleFeedback(msg) {
  if (!msg.projectId) {
    await notifier.reply(msg.replyToken,
      '❌ 案件IDが見つかりませんでした。\n例: 【FB #a1b2c3d4】修正内容'
    );
    return;
  }

  const project = db.getProject(msg.projectId);
  if (!project) {
    await notifier.reply(msg.replyToken, `❌ 案件 #${msg.projectId} が見つかりません。`);
    return;
  }

  const feedback = lineHandler.extractFeedback(msg.text);

  // DBに更新
  db.saveMessage({
    projectId: msg.projectId,
    lineUserId: msg.userId,
    direction: 'inbound',
    messageType: 'feedback',
    content: feedback,
  });

  // フィードバックジョブをキューに追加
  queue.enqueue({
    projectId: msg.projectId,
    type: 'feedback',
    userId: msg.userId,
    feedback,
    execute: async () => {
      db.updateStatus(msg.projectId, 'awaiting_processing');
      logger.info('feedback job queued', { projectId: msg.projectId });
    },
  });

  await notifier.notifyFeedbackReceived(msg.replyToken, msg.projectId);
}

async function handleStatusCheck(msg) {
  // 「【状態】」の後に案件IDがあれば特定の案件を、なければ最新案件を返す
  const idMatch = msg.text.match(/【状態】\s*#?([a-zA-Z0-9]+)/);
  const projectId = idMatch ? idMatch[1] : null;

  let statusText;
  if (projectId) {
    const project = db.getProject(projectId);
    if (!project) {
      statusText = `案件 #${projectId} は見つかりません。`;
    } else {
      statusText = formatProjectStatus(project);
    }
  } else {
    statusText = '案件IDを指定してください。例: 【状態】 #a1b2c3d4';
  }

  await notifier.reply(msg.replyToken, statusText);
}

function formatProjectStatus(project) {
  const statusLabels = {
    pending: '⏳ 受付待ち',
    queued: '🔜 キュー待機中',
    planning: '📋 計画立案中',
    coding: '⚙️ コード生成中',
    github: '🔀 GitHub操作中',
    previewing: '👀 プレビュー生成中',
    pr_created: '✅ PR作成完了',
    awaiting_feedback: '💬 フィードバック待ち',
    awaiting_processing: '🔧 FB処理待ち',
    completed: '🎉 完了',
    error: '❌ エラー',
  };

  const lines = [
    `📦 案件 #${project.id}`,
    `ステータス: ${statusLabels[project.status] || project.status}`,
    `作成日時: ${project.created_at}`,
  ];

  if (project.github_pr_url) lines.push(`PR: ${project.github_pr_url}`);
  if (project.preview_url)   lines.push(`プレビュー: ${project.preview_url}`);
  if (project.error_message) lines.push(`エラー: ${project.error_message}`);

  return lines.join('\n');
}

// ────────────────────────────────────────────
// サーバー起動
// ────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`webhook-receiver started`, { port: PORT, env: process.env.NODE_ENV });
});

module.exports = app;
