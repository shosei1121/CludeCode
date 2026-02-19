# フリーランス案件自動処理システム

LINEから案件を送るだけで、Claude Codeが自動的にプロジェクト計画・コード生成・GitHub PR作成まで処理し、進捗をLINEで受け取れるシステムです。

## システム概要

```
あなたのLINE
    ↓ 【案件】メッセージを送信
webhook-receiver（Express）
    ↓ 案件をキューに登録
claude-runner（Claude Code SDK）
    ↓ 計画 → コード生成 → GitHub PR → プレビュー
あなたのLINE
    ↓ 各フェーズの完了通知を受信
```

## 月額コスト

| 項目 | 費用 |
|------|------|
| GCP e2-micro | 無料（Always Free枠） |
| GCP 静的IP | 約550円 |
| ドメイン | 約100円（任意） |
| Anthropic API | 従量課金 |
| **合計固定費** | **約650円/月〜** |

---

## ディレクトリ構成

```
freelance-auto-system/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── nginx/
│   └── conf.d/
│       └── default.conf
├── shared/
│   ├── db.js              # SQLite操作（全コンテナ共通）
│   └── logger.js          # 構造化ログ
├── webhook-receiver/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.js        # Expressサーバー・エントリポイント
│       ├── lineHandler.js  # LINE署名検証・メッセージ種別判定
│       ├── lineNotifier.js # LINE Push/Reply送信
│       └── jobQueue.js     # FIFO非同期ジョブキュー
└── claude-runner/
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── runner.js         # フェーズ制御オーケストレーター
        ├── planner.js        # Claude APIでプロジェクト計画書生成
        ├── coder.js          # コード生成・FB差分適用
        ├── githubClient.js   # リポジトリ作成・コミット・PR作成
        └── previewManager.js # 静的ファイルプレビュー配置
```

---

## セットアップ

### 1. リポジトリをクローン

```bash
git clone https://github.com/あなたのユーザー名/freelance-auto-system.git
cd freelance-auto-system
```

### 2. 環境変数を設定

```bash
cp .env.example .env
# .env を編集して各APIキーを入力
```

### 3. Dockerコンテナを起動

```bash
docker-compose up --build -d
docker-compose ps  # 全コンテナがUpであることを確認
```

### 4. ngrokでLINE Webhookをローカル公開

```bash
ngrok http 80
# 表示されたHTTPS URLをLINE DevelopersのWebhook URLに設定
```

---

## LINEの使い方

### 新規案件を依頼する

```
【案件】ECサイトのカート機能を作ってほしい。React + TypeScript。
```

### フィードバックを送る

```
【FB #a1b2c3d4】ボタンの色を青にして、モバイル対応も追加してほしい
```

### 案件の状態を確認する

```
【状態】 #a1b2c3d4
```

---

## 処理フロー

1. `【案件】` を受信 → 受付通知を返信
2. Claude APIでプロジェクト計画書を生成 → LINEに送信
3. コードを自動生成（進捗50%でLINE通知）
4. GitHubにリポジトリ作成 → コミット → PR作成 → PR URLをLINEに送信
5. HTMLファイルがあればプレビューURLをLINEに送信
6. `【FB #ID】` を受信 → 修正コードを追加コミット → 完了通知

---

## 関連ドキュメント

- [全体設計書](./docs/design.md)
- [プログラム設計書](./docs/program-design.md)
- [API仕様書](./docs/api.md)
- [DB設計書](./docs/database.md)
- [デプロイ手順書](./docs/deploy.md)
- [トラブルシューティング](./docs/troubleshooting.md)

---

## 技術スタック

| カテゴリ | 技術 |
|----------|------|
| サーバー | GCP Compute Engine e2-micro |
| コンテナ | Docker / docker-compose |
| AI | Anthropic Claude API (claude-sonnet-4-5) |
| メッセージング | LINE Messaging API |
| バージョン管理 | GitHub API (Octokit) |
| DB | SQLite (better-sqlite3) |
| Webサーバー | Nginx |
| 言語 | Node.js v20 |
