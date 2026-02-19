# トラブルシューティング

## よくある問題

### LINEを送ってもReplyが来ない

**確認手順**

```bash
# 1. コンテナが起動しているか確認
docker compose ps

# 2. webhook-receiverのログを確認
docker compose logs -f webhook-receiver

# 3. ngrokが起動しているか確認（ローカル開発時）
# ngrokのターミナルにリクエストが届いているか確認

# 4. LINE DevelopersのWebhook URLを確認
# https://developers.line.biz でWebhook URLが最新か確認
```

**よくある原因**

| 原因 | 対処 |
|------|------|
| ngrokが未起動 | `ngrok http 80` を再実行 |
| ngrokのURLが変わった | LINE DevelopersのWebhook URLを更新 |
| LINE_CHANNEL_SECRETが間違い | `.env` を確認してコンテナ再起動 |
| LINE_USER_IDが間違い | `log` に `invalid user` が出ていないか確認 |

---

### docker compose up でエラーが出る

```bash
# エラーの詳細を確認
docker compose up --build 2>&1 | head -50

# よくあるエラー①: package.jsonが存在しない
cd webhook-receiver && npm init -y && cd ..
cd claude-runner && npm init -y && cd ..

# よくあるエラー②: ポート80が使用中
sudo lsof -i :80
# 使用中のプロセスを停止してから再実行

# よくあるエラー③: .envファイルが存在しない
cp .env.example .env
```

---

### Anthropic APIエラー 401

```bash
# APIキーを確認
docker compose exec claude-runner printenv ANTHROPIC_API_KEY

# .envを確認
cat .env | grep ANTHROPIC

# コンテナを再起動
docker compose restart claude-runner
```

> `sk-ant-` で始まるキーが正しく設定されているか確認してください。
> console.anthropic.com でクレジット残高も確認してください。

---

### GitHubへのPush失敗

```bash
# Claude-runnerのログを確認
docker compose logs claude-runner | grep -i github

# よくある原因
# 1. GITHUB_TOKEN の権限不足 → GitHubでrepo権限を付与して再発行
# 2. GITHUB_TOKENの期限切れ → GitHubで新しいトークンを発行
# 3. GITHUB_USERNAMEが間違い → .envを確認
```

---

### コンテナが即座に停止する

```bash
# 終了コードを確認
docker compose ps -a

# ログを確認
docker compose logs webhook-receiver
docker compose logs claude-runner

# よくある原因: src/index.js や src/runner.js が存在しない
ls webhook-receiver/src/
ls claude-runner/src/
```

---

### SQLiteのエラー

```bash
# DBファイルの権限確認
docker compose exec webhook-receiver ls -la /app/db/

# DBを直接確認
docker compose exec webhook-receiver sh -c "sqlite3 /app/db/projects.db '.tables'"

# 全案件を確認
docker compose exec webhook-receiver sh -c \
  "sqlite3 /app/db/projects.db 'SELECT id, status, title FROM projects;'"

# DBを初期化（開発時のみ）
docker compose down -v  # ボリュームごと削除
docker compose up -d
```

---

## ログの見方

### 構造化ログのフォーマット

```json
{
  "ts": "2026-02-19T10:00:00.000Z",
  "level": "info",
  "msg": "job started",
  "projectId": "a1b2c3d4",
  "type": "new_project"
}
```

### ログレベル

| レベル | 用途 |
|-------|------|
| debug | 詳細なデバッグ情報 |
| info | 通常の処理ログ |
| warn | 警告（リトライなど） |
| error | エラー発生時 |

### ログレベルを変更する

```bash
# .envのLOG_LEVELを変更
LOG_LEVEL=debug

# コンテナを再起動
docker compose restart
```

---

## 手動でステータスをリセットする

案件がエラー状態で止まった場合：

```bash
# SQLiteで直接更新
docker compose exec webhook-receiver sh -c \
  "sqlite3 /app/db/projects.db \
  \"UPDATE projects SET status='queued', error_message=NULL WHERE id='a1b2c3d4';\""

# claude-runnerが次のポーリングで再処理する（最大3秒後）
```
