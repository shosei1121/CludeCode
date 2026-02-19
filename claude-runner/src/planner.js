const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../../shared/logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Claude APIを使ってプロジェクト計画書を生成するクラス
 */
class Planner {
  /**
   * 案件説明からプロジェクト計画書を生成する
   * @param {string} description - 案件の説明文
   * @param {string} projectId
   * @returns {Promise<Plan>}
   */
  async generate(description, projectId) {
    logger.info('planner: generating plan', { projectId });

    const prompt = this.buildPrompt(description, projectId);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0].text;
    const plan = this.parseResponse(raw, projectId, description);

    logger.info('planner: plan generated', { projectId, title: plan.title });
    return plan;
  }

  /**
   * 計画生成用プロンプトを構築する
   * @param {string} description
   * @param {string} projectId
   * @returns {string}
   */
  buildPrompt(description, projectId) {
    return `あなたは優秀なフリーランスエンジニアです。
以下の案件内容をもとに、詳細なプロジェクト計画書を作成してください。

【案件内容】
${description}

【出力形式】
以下のMarkdown形式で出力してください。JSONブロックも必ず含めてください。

# プロジェクト計画書

## プロジェクトタイトル
（簡潔なタイトル）

## 概要
（案件の概要）

## 技術スタック
（使用する技術・フレームワーク・ライブラリ）

## ディレクトリ構成
\`\`\`
（ディレクトリ・ファイル構成）
\`\`\`

## 実装ステップ
1. （ステップ1）
2. （ステップ2）
...

## 生成するファイル一覧
\`\`\`json
{
  "projectId": "${projectId}",
  "title": "（プロジェクトタイトル）",
  "repoName": "（GitHubリポジトリ名・英数字とハイフンのみ）",
  "files": [
    { "path": "ファイルパス", "description": "ファイルの役割" }
  ]
}
\`\`\`

## 工数見積もり
（時間・難易度の見積もり）`;
  }

  /**
   * Claude応答をPlanオブジェクトにパースする
   * @param {string} raw - Claude APIの応答テキスト
   * @param {string} projectId
   * @param {string} description
   * @returns {Plan}
   */
  parseResponse(raw, projectId, description) {
    // JSONブロックを抽出
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
    let meta = {};

    if (jsonMatch) {
      try {
        meta = JSON.parse(jsonMatch[1]);
      } catch (e) {
        logger.warn('planner: failed to parse JSON block', { projectId });
      }
    }

    return {
      projectId,
      title: meta.title || description.slice(0, 50),
      repoName: meta.repoName || `project-${projectId}`,
      files: meta.files || [],
      markdown: raw,
      description,
    };
  }
}

module.exports = Planner;
