const crypto = require('crypto');

// ─────────────────────────────────────────
// 【重要】環境変数は require より前に設定する
// ─────────────────────────────────────────
process.env.LINE_USER_ID = 'U_test_user';

const LineHandler = require('../../webhook-receiver/src/lineHandler');

const CHANNEL_SECRET = 'test_channel_secret';

function makeSignature(body) {
  return crypto.createHmac('SHA256', CHANNEL_SECRET).update(body).digest('base64');
}

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function runTests() {
  const handler = new LineHandler(CHANNEL_SECRET);

  console.log('\n■ LineHandler 単体テスト\n');

  // ── verify() ──────────────────────────
  console.log('【verify()】');
  const body = JSON.stringify({ events: [] });
  assert(handler.verify(body, makeSignature(body)), '正しい署名はtrueを返す');
  assert(!handler.verify(body, 'invalid_sig'), '不正な署名はfalseを返す');
  assert(!handler.verify(body, ''), '空の署名はfalseを返す');

  // ── detectType() ──────────────────────
  console.log('\n【detectType()】');
  assert(handler.detectType('【案件】ECサイトを作って') === 'new_project', '【案件】はnew_project');
  assert(handler.detectType('【FB #abc123】修正して') === 'feedback', '【FB #...】はfeedback');
  assert(handler.detectType('【状態】 #abc123') === 'status_check', '【状態】はstatus_check');
  assert(handler.detectType('こんにちは') === 'other', 'それ以外はother');
  assert(handler.detectType('') === 'other', '空文字はother');

  // ── extractProjectId() ────────────────
  console.log('\n【extractProjectId()】');
  assert(handler.extractProjectId('【FB #a1b2c3d4】内容') === 'a1b2c3d4', 'IDを正しく抽出する');
  assert(handler.extractProjectId('【FB #ABC】内容') === 'ABC', '大文字IDも抽出できる');
  assert(handler.extractProjectId('【FB】IDなし') === null, 'IDがない場合はnullを返す');
  assert(handler.extractProjectId('関係ないメッセージ') === null, '無関係なメッセージはnullを返す');

  // ── extractDescription() ──────────────
  console.log('\n【extractDescription()】');
  assert(handler.extractDescription('【案件】ECサイトを作って') === 'ECサイトを作って', '【案件】プレフィックスを除去する');
  assert(handler.extractDescription('【案件】  スペースあり  ') === 'スペースあり', '前後のスペースをtrimする');

  // ── extractFeedback() ─────────────────
  console.log('\n【extractFeedback()】');
  assert(handler.extractFeedback('【FB #a1b2】ボタンを青にして') === 'ボタンを青にして', 'FBプレフィックスを除去する');

  // ── parse() ───────────────────────────
  console.log('\n【parse()】');
  const events = [
    {
      type: 'message',
      replyToken: 'reply_token_1',
      source: { userId: 'U_test_user' },
      message: { type: 'text', text: '【案件】TodoアプリをReactで作って' },
    },
    {
      // 'other' 種別なので無視される
      type: 'message',
      replyToken: 'reply_token_2',
      source: { userId: 'U_test_user' },
      message: { type: 'text', text: '関係ないメッセージ' },
    },
    {
      // message 以外のイベントは無視される
      type: 'follow',
      source: { userId: 'U_test_user' },
    },
    {
      // 別ユーザーからのメッセージは無視される
      type: 'message',
      replyToken: 'reply_token_3',
      source: { userId: 'U_other_user' },
      message: { type: 'text', text: '【案件】別ユーザーからの案件' },
    },
  ];

  const parsed = handler.parse(events);
  assert(parsed.length === 1, 'new_projectのみが返る（otherと別ユーザーは無視）');
  assert(parsed[0].messageType === 'new_project', 'messageTypeがnew_project');
  assert(parsed[0].userId === 'U_test_user', '正しいuserIdが設定される');
  assert(parsed[0].replyToken === 'reply_token_1', '正しいreplyTokenが設定される');
  assert(parsed[0].projectId === null, 'new_projectのprojectIdはnull');

  // FB と status_check も parse できることを確認
  const fbEvents = [{
    type: 'message',
    replyToken: 'fb_token',
    source: { userId: 'U_test_user' },
    message: { type: 'text', text: '【FB #a1b2c3d4】ボタンを青にして' },
  }];
  const fbParsed = handler.parse(fbEvents);
  assert(fbParsed.length === 1, 'FBメッセージが1件返る');
  assert(fbParsed[0].messageType === 'feedback', 'messageTypeがfeedback');
  assert(fbParsed[0].projectId === 'a1b2c3d4', 'projectIdが抽出される');

  console.log('\n✅ LineHandler テストすべてパス\n');
}

try {
  runTests();
  process.exit(0);
} catch (err) {
  console.error('\n❌', err.message);
  process.exit(1);
}
