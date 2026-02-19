const JobQueue = require('../../webhook-receiver/src/jobQueue');

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
  console.log('\n■ JobQueue 単体テスト\n');

  // ────────────────────────────
  console.log('【基本動作】');

  const queue = new JobQueue();
  const results = [];

  queue.enqueue({
    projectId: 'proj-001',
    type: 'new_project',
    execute: async () => { results.push('job1'); },
  });

  queue.enqueue({
    projectId: 'proj-002',
    type: 'new_project',
    execute: async () => { results.push('job2'); },
  });

  await sleep(100);
  assert(results.length === 2, '2件のジョブが実行される');
  assert(results[0] === 'job1', 'job1が先に実行される（FIFO）');
  assert(results[1] === 'job2', 'job2が後に実行される（FIFO）');

  // ────────────────────────────
  console.log('\n【直列処理】');

  const queue2 = new JobQueue();
  const order = [];

  queue2.enqueue({
    projectId: 'proj-003',
    type: 'new_project',
    execute: async () => {
      order.push('start-1');
      await sleep(50);
      order.push('end-1');
    },
  });

  queue2.enqueue({
    projectId: 'proj-004',
    type: 'new_project',
    execute: async () => {
      order.push('start-2');
      await sleep(10);
      order.push('end-2');
    },
  });

  await sleep(200);
  assert(order[0] === 'start-1', 'job1が先に開始');
  assert(order[1] === 'end-1', 'job1が完了してからjob2が開始');
  assert(order[2] === 'start-2', 'job2はjob1完了後に開始');

  // ────────────────────────────
  console.log('\n【エラーハンドリング】');

  const queue3 = new JobQueue();
  const errors = [];
  const successAfterError = [];

  queue3.on('error', ({ job, err }) => {
    errors.push({ projectId: job.projectId, message: err.message });
  });

  queue3.enqueue({
    projectId: 'proj-fail',
    type: 'new_project',
    execute: async () => { throw new Error('意図的なエラー'); },
  });

  queue3.enqueue({
    projectId: 'proj-success',
    type: 'new_project',
    execute: async () => { successAfterError.push('executed'); },
  });

  await sleep(100);
  assert(errors.length === 1, 'エラーが1件発生');
  assert(errors[0].projectId === 'proj-fail', '正しいprojectIdでエラーが記録される');
  assert(successAfterError.length === 1, 'エラー後も次のジョブが実行される');

  // ────────────────────────────
  console.log('\n【getStatus()】');

  const queue4 = new JobQueue();
  const status = queue4.getStatus();
  assert(status.isRunning === false, '初期状態はisRunning:false');
  assert(status.queueLength === 0, '初期状態はqueueLength:0');

  console.log('\n✅ JobQueue テストすべてパス\n');
}

runTests().catch(err => {
  console.error('\n❌', err.message);
  process.exit(1);
});
