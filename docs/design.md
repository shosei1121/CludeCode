# 全体設計書

## システム概要

LINEから案件を送信するだけで、Claude Codeが自動的にプロジェクト計画・コード生成・GitHubへのPR作成まで一貫して処理し、進捗をLINEで受け取ることができるフリーランス業務の自動化基盤。

---

## アーキテクチャ図

```
あなたのLINE
    │
    │ POST /webhook/line（HTTPS）
    ▼
GCP Compute Engine e2-micro（Ubuntu 22.04）
    │
    ├── [nginx]              ← HTTPS終端・リバースプロキシ
    │       ↓
    ├── [webhook-receiver]   ← LINE受信・キュー登録
    │       ↓ DBポーリング
    ├── [claude-runner]      ← Claude Code実行・GitHub操作
    │
    └── [SQLite DB]          ← 案件状態・コンテキスト管理
              ↓
         GitHub API（リポジトリ作成・コミット・PR）
              ↓
         LINE Push API（進捗通知）→ あなたのLINE
```

---

## 処理ステップ

| ステップ | 処理内容 | 通知タイミング |
|----------|----------|----------------|
| ① | LINEから案件内容を送信 | — |
| ② | Webhookが受信・DBに登録 | 受付完了メッセージ |
| ③ | Claude APIがプロジェクト計画を生成 | 計画書をLINE送信 |
| ④ | Claude APIがコードを生成 | 進捗50%でLINE通知 |
| ⑤ | GitHubにリポジトリ作成・コミット・PR作成 | PR URLをLINE送信 |
| ⑥ | プレビューURLを生成・公開 | プレビューURLをLINE送信 |
| ⑦ | LINEからフィードバック送信 | — |
| ⑧ | 修正コードを追加コミット | 修正完了をLINE通知 |

---

## コンテナ構成

| コンテナ名 | ベースイメージ | 役割 | 公開ポート |
|------------|----------------|------|------------|
| nginx | nginx:alpine | リバースプロキシ・プレビュー配信 | 80 |
| webhook-receiver | node:20-alpine | LINE Webhook受信・ジョブキュー | 内部3000 |
| claude-runner | node:20 | Claude API実行・GitHub操作 | 内部3001 |

---

## Dockerボリューム

| ボリューム名 | マウント先 | 用途 |
|-------------|------------|------|
| db_data | /app/db | SQLiteファイルの永続化 |
| projects_data | /app/projects | 生成コードの保存 |
| previews_data | /app/previews / /usr/share/nginx/previews | プレビュー用静的ファイル |

---

## 月額コスト

| 項目 | 費用 | 備考 |
|------|------|------|
| GCP e2-micro | 無料 | Always Free枠（月730時間） |
| GCP 静的IP | 約550円 | LINE Webhook向き先の固定に必要 |
| ドメイン | 約100円 | 任意 |
| Anthropic API | 従量課金 | claude-sonnet-4-5: $3/MTok |
| LINE Messaging API | 無料 | 月200通まで |
| **合計固定費** | **約650円/月〜** | API使用量除く |

---

## セキュリティ方針

- LINE署名検証（HMAC-SHA256）で正規リクエストのみ処理
- `LINE_USER_ID` で自分以外のユーザーからのメッセージを無視
- `.env` ファイルで全シークレットを管理（`.gitignore` で除外）
- SSHは鍵認証のみ（GCPのファイアウォールで22番ポートを制限）
- プレビューサーバーは静的ファイルのみ配信（スクリプト実行なし）
