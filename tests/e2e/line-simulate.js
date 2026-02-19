#!/usr/bin/env node
/**
 * LINE Webhookシミュレーター
 *
 * 使い方:
 *   node tests/e2e/line-simulate.js new "ReactでTodoアプリを作って"
 *   node tests/e2e/line-simulate.js fb a1b2c3d4 "ボタンを青にして"
 *   node tests/e2e/line-simulate.js status a1b2c3d4
 *   node tests/e2e/line-simulate.js health
 */

// dotenv が存在する場合のみ読み込む（なくてもエラーにしない）
try { require('dotenv').config(); } catch {}

const crypto = require('crypto');
const http = require('http');

const CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || 'test_secret';
const LINE_USER_ID   = process.env.LINE_USER_ID || 'U_local_test_user';
const PORT           = process.env.PORT || 3000;

const [,, command, ...args] = process.argv;

if (!command || command === 'help') {
  console.log('\n📱 LINE Webhookシミュレーター\n');
  console.log('使い方:');
  console.log('  node tests/e2e/line-simulate.js <コマンド> [引数]\n');
  console.log('コマンド:');
  console.log('  new     <案件内容>               新規案件を送信');
  console.log('  fb      <projectId> <内容>        フィードバックを送信');
  console.log('  status  <projectId>               状態確認');
  console.log('  health                            ヘルスチェック');
  console.log('\n例:');
  console.log('  node tests/e2e/line-simulate.js new "ReactでTodoアプリを作って"');
  console.log('  node tests/e2e/line-simulate.js fb a1b2c3d4 "ボタンを青にして"');
  console.log('  node tests/e2e/line-simulate.js health');
  process.exit(0);
}

function buildMessageText(command, args) {
  switch (command) {
    case 'new':
      return `【案件】${args[0] || 'テスト案件'}`;
    case 'fb':
      if (!args[0]) { console.error('❌ projectIdを指定してください'); process.exit(1); }
      return `【FB #${args[0]}】${args[1] || 'テストフィードバック'}`;
    case 'status':
      return `【状態】 #${args[0] || ''}`;
    default:
      console.error(`❌ 不明なコマンド: ${command}`);
      process.exit(1);
  }
}

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const signature = crypto.createHmac('SHA256', CHANNEL_SECRET).update(bodyStr).digest('base64');
    const options = {
      hostname: 'localhost', port: PORT, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'X-Line-Signature': signature,
      },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        console.error(`\n❌ サーバーに接続できません（localhost:${PORT}）`);
        console.error('docker-compose up が完了しているか確認してください。\n');
        process.exit(1);
      }
      reject(err);
    });
    req.write(bodyStr);
    req.end();
  });
}

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get({ hostname: 'localhost', port: PORT, path }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data || '{}') }));
    }).on('error', reject);
  });
}

async function main() {
  if (command === 'health') {
    console.log(`\n🔍 ヘルスチェック（localhost:${PORT}）...\n`);
    const res = await httpGet('/health');
    console.log(`ステータス: ${res.status}`);
    console.log(JSON.stringify(res.body, null, 2));
    return;
  }

  const text = buildMessageText(command, args);
  const webhookBody = {
    events: [{
      type: 'message',
      replyToken: `simulate_reply_${Date.now()}`,
      source: { userId: LINE_USER_ID, type: 'user' },
      message: { type: 'text', id: `simulate_msg_${Date.now()}`, text },
      timestamp: Date.now(),
    }],
  };

  console.log('\n📤 Webhookリクエストを送信中...');
  console.log(`送信先: localhost:${PORT}/webhook/line`);
  console.log(`メッセージ: ${text}\n`);

  const res = await httpPost('/webhook/line', webhookBody);

  if (res.status === 200) {
    console.log('✅ 送信成功（200 OK）');
    console.log('処理は非同期で実行されます。\n');
    console.log('ログを確認: docker-compose logs -f');
    console.log('DB確認    : node tests/e2e/check-db.js');
  } else if (res.status === 401) {
    console.error('❌ 署名検証失敗（401）');
    console.error('LINE_CHANNEL_SECRET が .env に正しく設定されているか確認してください。');
  } else {
    console.error(`❌ エラー (${res.status})`, res.body);
  }
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
