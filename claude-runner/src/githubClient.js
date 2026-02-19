const { Octokit } = require('@octokit/rest');
const logger = require('../../shared/logger');

/**
 * GitHub APIを操作するクライアントクラス
 * リポジトリ作成・コミット・PR作成を担当
 */
class GitHubClient {
  constructor() {
    this.octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    this.username = process.env.GITHUB_USERNAME;
  }

  /**
   * プライベートリポジトリを作成する
   * @param {string} repoName - リポジトリ名
   * @param {string} description - 説明
   * @returns {Promise<{ repoName: string, repoUrl: string, cloneUrl: string }>}
   */
  async createRepo(repoName, description = '') {
    logger.info('github: creating repo', { repoName });

    // 同名リポジトリが存在する場合はサフィックスを付ける
    const finalName = await this.resolveRepoName(repoName);

    const { data } = await this.octokit.repos.createForAuthenticatedUser({
      name: finalName,
      description,
      private: true,
      auto_init: true, // READMEで初期化（mainブランチを自動作成）
    });

    logger.info('github: repo created', { repoName: finalName, url: data.html_url });
    return {
      repoName: finalName,
      repoUrl: data.html_url,
      cloneUrl: data.clone_url,
    };
  }

  /**
   * 複数ファイルを一括コミットする
   * @param {string} repoName
   * @param {FileMap} fileMap - { "src/index.js": "コード", ... }
   * @param {string} branch - コミット先ブランチ
   * @param {string} commitMessage
   * @returns {Promise<string[]>} コミットしたファイルパス一覧
   */
  async commitFiles(repoName, fileMap, branch = 'main', commitMessage = 'feat: add generated code') {
    logger.info('github: committing files', { repoName, fileCount: Object.keys(fileMap).length, branch });

    const committed = [];

    for (const [filePath, content] of Object.entries(fileMap)) {
      const encoded = Buffer.from(content).toString('base64');

      // 既存ファイルのSHAを取得（ファイル更新時に必要）
      let sha;
      try {
        const { data } = await this.octokit.repos.getContent({
          owner: this.username,
          repo: repoName,
          path: filePath,
          ref: branch,
        });
        sha = data.sha;
      } catch {
        // ファイルが存在しない場合はshaなし（新規作成）
      }

      await this.octokit.repos.createOrUpdateFileContents({
        owner: this.username,
        repo: repoName,
        path: filePath,
        message: `${commitMessage}: ${filePath}`,
        content: encoded,
        branch,
        ...(sha ? { sha } : {}),
      });

      committed.push(filePath);
    }

    logger.info('github: files committed', { repoName, branch, count: committed.length });
    return committed;
  }

  /**
   * mainブランチから新しいブランチを作成する
   * @param {string} repoName
   * @param {string} branchName
   */
  async createBranch(repoName, branchName) {
    logger.info('github: creating branch', { repoName, branchName });

    // mainブランチのSHAを取得
    const { data: ref } = await this.octokit.git.getRef({
      owner: this.username,
      repo: repoName,
      ref: 'heads/main',
    });

    await this.octokit.git.createRef({
      owner: this.username,
      repo: repoName,
      ref: `refs/heads/${branchName}`,
      sha: ref.object.sha,
    });

    logger.info('github: branch created', { repoName, branchName });
  }

  /**
   * PRを作成する
   * @param {string} repoName
   * @param {string} headBranch - PR元ブランチ
   * @param {string} title
   * @param {string} body
   * @returns {Promise<string>} PR URL
   */
  async createPR(repoName, headBranch, title, body = '') {
    logger.info('github: creating PR', { repoName, headBranch, title });

    const { data } = await this.octokit.pulls.create({
      owner: this.username,
      repo: repoName,
      title,
      head: headBranch,
      base: 'main',
      body: body || `## 自動生成PR\n\n${title}`,
    });

    logger.info('github: PR created', { prUrl: data.html_url });
    return data.html_url;
  }

  /**
   * 新規ファイル群を新ブランチにコミットしてPRを作成する（ワンステップ）
   * @param {string} repoName
   * @param {FileMap} fileMap
   * @param {string} projectTitle
   * @param {string} projectId
   * @returns {Promise<{ prUrl: string, branch: string }>}
   */
  async commitAndPR(repoName, fileMap, projectTitle, projectId) {
    const branchName = `feat/project-${projectId}`;

    await this.createBranch(repoName, branchName);
    await this.commitFiles(repoName, fileMap, branchName, `feat: initial implementation`);
    const prUrl = await this.createPR(
      repoName,
      branchName,
      `[自動生成] ${projectTitle}`,
      `## 概要\n${projectTitle}\n\n案件ID: #${projectId}`
    );

    return { prUrl, branch: branchName };
  }

  /**
   * フィードバック反映後のコードを追加コミットする
   * @param {string} repoName
   * @param {string} branch
   * @param {FileMap} fileMap
   * @param {string} feedback
   * @returns {Promise<void>}
   */
  async commitFeedback(repoName, branch, fileMap, feedback) {
    const message = `fix: apply feedback - ${feedback.slice(0, 50)}`;
    await this.commitFiles(repoName, fileMap, branch, message);
    logger.info('github: feedback committed', { repoName, branch });
  }

  /**
   * リポジトリ名の重複を避けてユニークな名前を返す
   * @param {string} name
   * @returns {Promise<string>}
   * @private
   */
  async resolveRepoName(name) {
    try {
      await this.octokit.repos.get({ owner: this.username, repo: name });
      // 存在する場合はタイムスタンプを付ける
      const suffix = Date.now().toString().slice(-6);
      return `${name}-${suffix}`;
    } catch {
      // 存在しない場合はそのまま使用
      return name;
    }
  }
}

module.exports = GitHubClient;
