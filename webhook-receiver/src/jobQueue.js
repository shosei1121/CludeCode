const EventEmitter = require('events');
const logger = require('../../shared/logger');

/**
 * FIFO ジョブキュー
 * - 同時実行は常に1件（直列処理）
 * - 完了・エラー時にEventEmitterでイベントを発火
 */
class JobQueue extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.isRunning = false;
  }

  /**
   * ジョブをキューに追加する
   * @param {Job} job
   */
  enqueue(job) {
    this.queue.push(job);
    logger.info('job enqueued', { projectId: job.projectId, type: job.type, queueLength: this.queue.length });
    if (!this.isRunning) this._process();
  }

  /**
   * キューの先頭から1件取り出して処理する（再帰）
   * @private
   */
  async _process() {
    if (this.queue.length === 0) {
      this.isRunning = false;
      return;
    }

    this.isRunning = true;
    const job = this.queue.shift();

    logger.info('job started', { projectId: job.projectId, type: job.type });

    try {
      await job.execute();
      this.emit('complete', job);
      logger.info('job completed', { projectId: job.projectId, type: job.type });
    } catch (err) {
      this.emit('error', { job, err });
      logger.error('job failed', { projectId: job.projectId, type: job.type, err: err.message });
    }

    // 次のジョブへ
    this._process();
  }

  /**
   * キューの現在の状態を返す
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      queueLength: this.queue.length,
      pending: this.queue.map(j => ({ projectId: j.projectId, type: j.type })),
    };
  }
}

module.exports = JobQueue;
