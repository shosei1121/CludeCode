/**
 * Webhook受信統合テスト
 * LINE API / Claude API / GitHub API には接続しない（モック使用）
 */

// 環境変数は require より前に設定
process.env.LINE_CHANNEL_SECRET       = 'test_secret';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test_token';
process.env.LINE_USER_ID              = 'U_test_user';
process.env.ANTHROPIC_API_KEY         = 'sk-ant-test';
process.env.GITHUB_TOKEN              = 'ghp_test';
process.env.GITHUB_USERNAME           = 'testuser';
process.env.NODE_ENV                  = 'test';
process.env.PORT                      = '3099';

const path = require('path');
const fs   = require('fs');
const TEST_DB_PATH = path.join(__dirname, '../tmp/integration-test.db');
process.env.DB_PATH = TEST_DB_PATH;
fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });

const crypto = require('crypto');
const http   = require('http');

// LINE API をモック
const LineNotifier = require('../../webhook-receiver/src/lineNotifier');
LineNotifier.prototype._request = async (method, apiPath) => {
  console.log(`  [MOCK] LINE API ${method} ${apiPath}`);
  return {};
};

function makeSignature(body) {
  return crypto.createHmac('SHA256', 'test_secret').update(body).digest('base64');
}

function httpPost(path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const options = {
      hostname: 'localhost', port: 3099, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...extraHeaders },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: 'localhost', port: 3099, path }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }));
    }).on('error', reject);
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runTests() {
  console.log('\n■ Webhook 統合テスト\n');

  require('../../webhook-receiver/src/index');
  await sleep(500);

  // ── GET /health ──────────────────────
  console.log('【GET /health】');
  const health = await httpGet('/health');
  assert(health.status === 200, 'ステータス200を返す');
  assert(health.body.status === 'ok', 'status:okを返す');
  assert(typeof health.body.queue === 'object', 'キュー情報が含まれる');

  // ── 署名検証 ─────────────────────────
  console.log('\n【POST /webhook/line - 署名検証】');
  const invalidRes = await httpPost('/webhook/line', { events: [] }, { 'x-line-signature': 'invalid' });
  assert(invalidRes.status === 401, '不正な署名は401を返す');

  // ── 新規案件受付 ──────────────────────
  console.log('\n【POST /webhook/line - 新規案件受付】');
  const newProjectBody = JSON.stringify({
    events: [{
      type: 'message', replyToken: 'test_reply_token',
      source: { userId: 'U_test_user' },
      message: { type: 'text', text: '【案件】ReactでTodoアプリを作って' },
    }],
  });
  const newRes = await httpPost('/webhook/line', JSON.parse(newProjectBody), {
    'x-line-signature': makeSignature(newProjectBody),
  });
  assert(newRes.status === 200, '200を即時返す');
  assert(newRes.body.status === 'ok', 'status:okを返す');

  await sleep(300);

  // node-sqlite3-wasm でDB確認
  const { Database } = require('node-sqlite3-wasm');
  const rawDb = new Database(TEST_DB_PATH);
  const project = rawDb.get("SELECT * FROM projects WHERE line_user_id = 'U_test_user' ORDER BY created_at DESC LIMIT 1");
  rawDb.close();

  assert(project !== undefined, 'DBに案件レコードが作成される');
  assert(project.description === 'ReactでTodoアプリを作って', '案件の説明が正しく保存される');
  assert(project.status !== 'pending', 'ステータスがpendingから変更されている');
  console.log(`  [INFO] 作成された案件ID: ${project.id}`);

  // ── フィードバック受付 ────────────────
  console.log('\n【POST /webhook/line - フィードバック受付】');
  const fbBody = JSON.stringify({
    events: [{
      type: 'message', replyToken: 'test_reply_token_fb',
      source: { userId: 'U_test_user' },
      message: { type: 'text', text: `【FB #${project.id}】ボタンを青にして` },
    }],
  });
  const fbRes = await httpPost('/webhook/line', JSON.parse(fbBody), {
    'x-line-signature': makeSignature(fbBody),
  });
  assert(fbRes.status === 200, 'FB受信も200を返す');

  await sleep(200);
  const rawDb2 = new Database(TEST_DB_PATH);
  const fbMsg = rawDb2.get(`SELECT * FROM messages WHERE project_id = '${project.id}' AND message_type = 'feedback'`);
  rawDb2.close();
  assert(fbMsg !== undefined, 'FBメッセージがDBに保存される');
  assert(fbMsg.content === 'ボタンを青にして', 'FB内容が正しく保存される');

  // ── 別ユーザーは無視 ──────────────────
  console.log('\n【POST /webhook/line - 別ユーザーは無視】');
  const otherBody = JSON.stringify({
    events: [{
      type: 'message', replyToken: 'other_reply_token',
      source: { userId: 'U_other_user' },
      message: { type: 'text', text: '【案件】別ユーザーからの案件' },
    }],
  });
  const otherRes = await httpPost('/webhook/line', JSON.parse(otherBody), {
    'x-line-signature': makeSignature(otherBody),
  });
  assert(otherRes.status === 200, '別ユーザーも200を返す');

  await sleep(100);
  const rawDb3 = new Database(TEST_DB_PATH);
  const otherProject = rawDb3.get("SELECT * FROM projects WHERE line_user_id = 'U_other_user'");
  rawDb3.close();
  assert(!otherProject, '別ユーザーの案件はDBに保存されない');

  console.log('\n✅ Webhook 統合テストすべてパス\n');
}

runTests()
  .catch(err => { console.error('\n❌', err.message, '\n', err.stack); process.exit(1); })
  .finally(() => {
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    process.exit(0);
  });
