const fs = require('fs');
const path = require('path');
const logger = require('../../shared/logger');

const PREVIEW_BASE = process.env.PREVIEW_BASE || '/app/previews';
const BASE_URL = process.env.BASE_URL || 'http://localhost';

/**
 * 生成したコードをプレビューサーバーに配置してURLを返すクラス
 */
class PreviewManager {
  /**
   * FileMapのうち静的ファイル（HTML/CSS/JS）をプレビューディレクトリに配置する
   * @param {string} projectId
   * @param {FileMap} fileMap
   * @returns {Promise<string | null>} プレビューURL（HTMLがない場合はnull）
   */
  async deploy(projectId, fileMap) {
    logger.info('preview: deploying', { projectId });

    const previewDir = path.join(PREVIEW_BASE, projectId);
    fs.mkdirSync(previewDir, { recursive: true });

    const staticExts = ['.html', '.css', '.js', '.json', '.png', '.jpg', '.svg', '.ico'];
    let hasHtml = false;
    let entryFile = null;

    for (const [filePath, content] of Object.entries(fileMap)) {
      const ext = path.extname(filePath).toLowerCase();
      if (!staticExts.includes(ext)) continue;

      const destPath = path.join(previewDir, filePath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.writeFileSync(destPath, content, 'utf8');

      // index.htmlを優先的にエントリとして扱う
      if (path.basename(filePath) === 'index.html') {
        entryFile = filePath;
        hasHtml = true;
      } else if (ext === '.html' && !entryFile) {
        entryFile = filePath;
        hasHtml = true;
      }
    }

    if (!hasHtml) {
      logger.info('preview: no HTML files found, skipping preview', { projectId });
      return null;
    }

    const previewUrl = `${BASE_URL}/previews/${projectId}/${entryFile}`;
    logger.info('preview: deployed', { projectId, url: previewUrl });
    return previewUrl;
  }

  /**
   * プレビューを削除する（案件完了後のクリーンアップ用）
   * @param {string} projectId
   */
  cleanup(projectId) {
    const previewDir = path.join(PREVIEW_BASE, projectId);
    if (fs.existsSync(previewDir)) {
      fs.rmSync(previewDir, { recursive: true, force: true });
      logger.info('preview: cleaned up', { projectId });
    }
  }
}

module.exports = PreviewManager;
