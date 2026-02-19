const https = require('https');
const logger = require('../../shared/logger');

const LINE_API_BASE = 'api.line.me';

/**
 * LINE Push API / Reply API の送信クラス
 */
class LineNotifier {
  constructor(accessToken) {
    this.accessToken = accessToken;
  }

  /**
   * Push Message（任意のタイミングで送信）
   * @param {string} userId - 送信先LINEユーザーID
   * @param {string} text - 送信テキスト
   */
  async push(userId, text) {
    const body = JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text }],
    });
    return this._request('POST', '/v2/bot/message/push', body);
  }

  /**
   * Reply Message（WebhookのreplyTokenを使って返信）
   * @param {string} replyToken
   * @param {string} text
   */
  async reply(replyToken, text) {
    const body = JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    });
    return this._request('POST', '/v2/bot/message/reply', body);
  }

  /**
   * 案件受付通知
   */
  async notifyReceived(replyToken, projectId) {
    await this.reply(replyToken,
      `✅ 案件 #${projectId} を受け付けました。\nプロジェクト計画を立案中です...`
    );
  }

  /**
   * 計画書完成通知
   */
  async notifyPlanReady(userId, projectId, planMarkdown) {
    // LINEは5000文字制限があるため長い場合は先頭部分のみ送信
    const preview = planMarkdown.length > 4800
      ? planMarkdown.slice(0, 4800) + '\n\n...(続きはGitHubで確認)'
      : planMarkdown;
    await this.push(userId,
      `📋 案件 #${projectId} の計画書が完成しました。\n\n${preview}`
    );
  }

  /**
   * コード生成進捗通知
   */
  async notifyProgress(userId, projectId, percent) {
    await this.push(userId,
      `⚙️ 案件 #${projectId} コード生成中... ${percent}%`
    );
  }

  /**
   * PR作成完了通知
   */
  async notifyPRCreated(userId, projectId, prUrl) {
    await this.push(userId,
      `🔀 案件 #${projectId} のコードが完成しました！\n\nPR: ${prUrl}\n\nレビューしてフィードバックをどうぞ。\n例: 【FB #${projectId}】修正内容をここに書いてください`
    );
  }

  /**
   * プレビュー公開通知
   */
  async notifyPreviewReady(userId, projectId, previewUrl) {
    await this.push(userId,
      `👀 案件 #${projectId} のプレビューを公開しました。\n\nURL: ${previewUrl}`
    );
  }

  /**
   * FB受付通知
   */
  async notifyFeedbackReceived(replyToken, projectId) {
    await this.reply(replyToken,
      `🔧 案件 #${projectId} のフィードバックを受け付けました。修正中...`
    );
  }

  /**
   * FB修正完了通知
   */
  async notifyFeedbackDone(userId, projectId, prUrl) {
    await this.push(userId,
      `✅ 案件 #${projectId} の修正が完了しました。\n\nPR: ${prUrl}`
    );
  }

  /**
   * エラー通知
   */
  async notifyError(userId, projectId, errorMessage) {
    await this.push(userId,
      `❌ 案件 #${projectId} でエラーが発生しました。\n\n${errorMessage}\n\n再送する場合は同じメッセージをもう一度送ってください。`
    );
  }

  /**
   * LINE APIへのHTTPSリクエスト
   * @private
   */
  _request(method, path, body) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: LINE_API_BASE,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data || '{}'));
          } else {
            logger.error('LINE API error', { statusCode: res.statusCode, body: data });
            reject(new Error(`LINE API ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

module.exports = LineNotifier;
