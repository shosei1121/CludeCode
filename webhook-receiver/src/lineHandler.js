const crypto = require('crypto');

/**
 * LINE Webhookの署名検証・メッセージ種別判定
 */
class LineHandler {
  constructor(channelSecret) {
    this.channelSecret = channelSecret;
    // 自分のLINEユーザーIDのみ処理する
    this.allowedUserId = process.env.LINE_USER_ID;
  }

  /**
   * X-Line-Signature ヘッダーを検証する
   * @param {string} rawBody - 生のリクエストボディ文字列
   * @param {string} signature - ヘッダー値
   * @returns {boolean}
   */
  verify(rawBody, signature) {
    const hash = crypto
      .createHmac('SHA256', this.channelSecret)
      .update(rawBody)
      .digest('base64');
    return hash === signature;
  }

  /**
   * Webhookのevents配列を解析してメッセージ種別を付与する
   * @param {object[]} events
   * @returns {ParsedMessage[]}
   */
  parse(events) {
    const results = [];
    for (const event of events) {
      // テキストメッセージ以外は無視
      if (event.type !== 'message' || event.message.type !== 'text') continue;

      const userId = event.source.userId;
      const text = event.message.text.trim();
      const replyToken = event.replyToken;

      // 自分以外のユーザーからのメッセージは無視
      if (this.allowedUserId && userId !== this.allowedUserId) continue;

      const messageType = this.detectType(text);
      if (messageType === 'other') continue;

      results.push({
        userId,
        text,
        replyToken,
        messageType,
        projectId: messageType === 'feedback' ? this.extractProjectId(text) : null,
      });
    }
    return results;
  }

  /**
   * メッセージ種別を判定する
   * 【案件】 → new_project
   * 【FB #XXX】 → feedback
   * 【状態】 → status_check
   * それ以外 → other
   * @param {string} text
   * @returns {'new_project'|'feedback'|'status_check'|'other'}
   */
  detectType(text) {
    if (text.startsWith('【案件】')) return 'new_project';
    if (text.startsWith('【FB'))    return 'feedback';
    if (text.startsWith('【状態】')) return 'status_check';
    return 'other';
  }

  /**
   * 「【FB #a1b2c3d4】内容」からプロジェクトIDを抽出する
   * @param {string} text
   * @returns {string|null}
   */
  extractProjectId(text) {
    const match = text.match(/【FB\s*#([a-zA-Z0-9]+)】/);
    return match ? match[1] : null;
  }

  /**
   * 「【案件】内容」から案件説明文のみ取り出す
   * @param {string} text
   * @returns {string}
   */
  extractDescription(text) {
    return text.replace(/^【案件】\s*/, '').trim();
  }

  /**
   * 「【FB #XXX】内容」からFB本文のみ取り出す
   * @param {string} text
   * @returns {string}
   */
  extractFeedback(text) {
    return text.replace(/^【FB\s*#[a-zA-Z0-9]+】\s*/, '').trim();
  }
}

module.exports = LineHandler;
