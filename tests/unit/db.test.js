const path = require('path');
const fs = require('fs');

// テスト用の一時DBパスを設定（requireより前に設定必須）
const TEST_DB_PATH = path.join(__dirname, '../tmp/test.db');
process.env.DB_PATH = TEST_DB_PATH;
fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });

const db = require('../../shared/db');

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function cleanup() {
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
}

function runTests() {
  console.log('\n■ Database 単体テスト\n');

  console.log('【createProject()】');
  const project = db.createProject({ lineUserId: 'U_test_user', description: 'テスト案件：ReactのTodoアプリを作って' });
  assert(project !== null, 'プロジェクトが作成される');
  assert(typeof project.id === 'string' && project.id.length > 0, 'IDが設定される');
  assert(project.line_user_id === 'U_test_user', 'line_user_idが正しい');
  assert(project.status === 'pending', '初期ステータスはpending');
  assert(project.retry_count === 0, '初期retry_countは0');
  const projectId = project.id;

  console.log('\n【getProject()】');
  const fetched = db.getProject(projectId);
  assert(fetched !== null, '存在するIDで取得できる');
  assert(fetched.id === projectId, '正しいプロジェクトが返る');
  assert(db.getProject('nonexistent') === null, '存在しないIDはnullを返す');

  console.log('\n【updateStatus()】');
  db.updateStatus(projectId, 'planning');
  assert(db.getProject(projectId).status === 'planning', 'ステータスが更新される');

  console.log('\n【updateProjectFields()】');
  db.updateProjectFields(projectId, {
    title: 'React Todoアプリ',
    github_repo_url: 'https://github.com/test/todo-app',
  });
  const withFields = db.getProject(projectId);
  assert(withFields.title === 'React Todoアプリ', 'titleが更新される');
  assert(withFields.github_repo_url === 'https://github.com/test/todo-app', 'github_repo_urlが更新される');

  console.log('\n【updateContext()】');
  db.updateContext(projectId, { repoName: 'todo-app', branch: 'feat/project-abc' });
  const withCtx = db.getProject(projectId);
  assert(withCtx.context !== null, 'contextが設定される');
  assert(withCtx.context.repoName === 'todo-app', 'context.repoNameが正しい');

  console.log('\n【incrementRetry()】');
  db.incrementRetry(projectId);
  db.incrementRetry(projectId);
  assert(db.getProject(projectId).retry_count === 2, 'retry_countが2回インクリメントされる');

  console.log('\n【saveMessage()】');
  db.saveMessage({ projectId, lineUserId: 'U_test_user', direction: 'inbound', messageType: 'new_project', content: 'テスト' });
  assert(true, 'メッセージ保存でエラーなし');

  console.log('\n【createJob() / updateJobStatus()】');
  const jobId = db.createJob({ projectId, phase: 'plan' });
  assert(jobId !== null, 'ジョブIDが返る');
  db.updateJobStatus(projectId, 'plan', 'running');
  db.updateJobStatus(projectId, 'plan', 'done');
  assert(true, 'ジョブステータス更新でエラーなし');

  console.log('\n✅ Database テストすべてパス\n');
}

try {
  runTests();
  cleanup();
  process.exit(0);
} catch (err) {
  console.error('\n❌', err.message);
  cleanup();
  process.exit(1);
}
