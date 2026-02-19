const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const logger = require('../../shared/logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const OUTPUT_BASE = process.env.OUTPUT_BASE || '/app/projects';

/**
 * Claude APIを使ってコードを生成するクラス
 * @typedef {Object.<string, string>} FileMap - { "src/index.js": "コード内容", ... }
 */
class Coder {
  /**
   * 計画書に基づきコードを生成する
   * @param {Plan} plan
   * @param {function(number): void} onProgress - 進捗コールバック 0-100
   * @returns {Promise<FileMap>}
   */
  async generate(plan, onProgress = () => {}) {
    logger.info('coder: starting code generation', { projectId: plan.projectId, fileCount: plan.files.length });

    const fileMap = {};
    const files = plan.files;

    if (files.length === 0) {
      // ファイル一覧が空の場合はClaude に全体生成を依頼
      return this.generateAll(plan, onProgress);
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      logger.info('coder: generating file', { path: file.path, projectId: plan.projectId });

      fileMap[file.path] = await this.generateFile(file, plan);

      const percent = Math.round((i + 1) / files.length * 100);
      onProgress(percent);
    }

    // ローカルに保存
    await this.saveToLocal(fileMap, plan.projectId);
    logger.info('coder: code generation complete', { projectId: plan.projectId });

    return fileMap;
  }

  /**
   * ファイル一覧が不明な場合にまとめて生成する
   * @param {Plan} plan
   * @param {function} onProgress
   * @returns {Promise<FileMap>}
   */
  async generateAll(plan, onProgress) {
    const prompt = `以下のプロジェクト計画書に基づいて、すべてのファイルを生成してください。

【計画書】
${plan.markdown}

【出力形式】
各ファイルを以下の形式で出力してください：

===FILE: ファイルパス===
ファイルの内容
===END===

すべてのファイルをこの形式で出力してください。`;

    onProgress(10);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });

    onProgress(80);

    const fileMap = this.parseMultiFileResponse(response.content[0].text);
    await this.saveToLocal(fileMap, plan.projectId);

    onProgress(100);
    return fileMap;
  }

  /**
   * 個別ファイルを生成する
   * @param {{ path: string, description: string }} file
   * @param {Plan} plan
   * @returns {Promise<string>}
   */
  async generateFile(file, plan) {
    const prompt = `以下のプロジェクトの「${file.path}」ファイルを生成してください。

【プロジェクト計画】
${plan.markdown}

【このファイルの役割】
${file.description}

コードのみを出力してください。説明文や\`\`\`マークは不要です。`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0].text;
  }

  /**
   * フィードバックを既存コードに適用して差分を生成する
   * @param {string} projectId
   * @param {string} feedback - フィードバック内容
   * @param {string} planMarkdown - 元の計画書
   * @returns {Promise<FileMap>}
   */
  async applyFeedback(projectId, feedback, planMarkdown) {
    logger.info('coder: applying feedback', { projectId });

    // 既存のファイルを読み込む
    const projectDir = path.join(OUTPUT_BASE, projectId);
    const existingFiles = this.readLocalFiles(projectDir);

    const existingFilesText = Object.entries(existingFiles)
      .map(([filePath, content]) => `===FILE: ${filePath}===\n${content}\n===END===`)
      .join('\n\n');

    const prompt = `以下の既存コードにフィードバックを適用して修正版を生成してください。

【フィードバック】
${feedback}

【元の計画書】
${planMarkdown}

【既存のコード】
${existingFilesText}

【出力形式】
修正が必要なファイルのみ、以下の形式で出力してください：

===FILE: ファイルパス===
修正後のファイル全内容
===END===`;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8192,
      messages: [{ role: 'user', content: prompt }],
    });

    const updatedFiles = this.parseMultiFileResponse(response.content[0].text);

    // 既存ファイルにマージ
    const merged = { ...existingFiles, ...updatedFiles };
    await this.saveToLocal(merged, projectId);

    logger.info('coder: feedback applied', { projectId, modifiedFiles: Object.keys(updatedFiles).length });
    return merged;
  }

  /**
   * ===FILE:...===END===形式のレスポンスをパースする
   * @param {string} text
   * @returns {FileMap}
   */
  parseMultiFileResponse(text) {
    const fileMap = {};
    const pattern = /===FILE:\s*(.+?)===\n([\s\S]*?)===END===/g;
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const filePath = match[1].trim();
      const content = match[2].trim();
      fileMap[filePath] = content;
    }

    return fileMap;
  }

  /**
   * FileMapをローカルディスクに保存する
   * @param {FileMap} fileMap
   * @param {string} projectId
   * @returns {Promise<string>} 保存先ディレクトリパス
   */
  async saveToLocal(fileMap, projectId) {
    const projectDir = path.join(OUTPUT_BASE, projectId);

    for (const [filePath, content] of Object.entries(fileMap)) {
      const fullPath = path.join(projectDir, filePath);
      const dir = path.dirname(fullPath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf8');
    }

    logger.info('coder: files saved to local', { projectId, dir: projectDir, fileCount: Object.keys(fileMap).length });
    return projectDir;
  }

  /**
   * ローカルのファイルを再帰的に読み込む
   * @param {string} dir
   * @param {string} base
   * @returns {FileMap}
   */
  readLocalFiles(dir, base = dir) {
    const result = {};
    if (!fs.existsSync(dir)) return result;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        Object.assign(result, this.readLocalFiles(fullPath, base));
      } else {
        const relativePath = path.relative(base, fullPath);
        result[relativePath] = fs.readFileSync(fullPath, 'utf8');
      }
    }
    return result;
  }
}

module.exports = Coder;
