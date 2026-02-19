# ローカル動作テスト手順書

## テストの種類

| 種類 | 場所 | 目的 |
|------|------|------|
| 単体テスト | `tests/unit/` | 個別クラス・関数の動作確認 |
| 統合テスト | `tests/integration/` | WebhookからDB保存までの一連の動作確認 |
| E2Eテスト | `tests/e2e/` | 実際のDockerコンテナへのリクエスト送信 |

---

## STEP 1：依存パッケージをインストール

```bash
# webhook-receiver の依存パッケージ
cd webhook-receiver && npm install && cd ..

# claude-runner の依存パッケージ
cd claude-runner && npm install && cd ..
```

または一括インストール：

```bash
npm run install:all
```

---

## STEP 2：単体テストを実行

Dockerなしでローカルから直接実行できます。

```bash
# 全単体テストを実行
npm run test:unit

# 個別に実行
node tests/unit/lineHandler.test.js
node tests/unit/jobQueue.test.js
node tests/unit/db.test.js
```

### 期待される出力

```
■ LineHandler 単体テスト

【verify()】
  ✓ 正しい署名はtrueを返す
  ✓ 不正な署名はfalseを返す
  ✓ 空の署名はfalseを返す
...
✅ LineHandler テストすべてパス

■ JobQueue 単体テスト
...
✅ JobQueue テストすべてパス

■ Database 単体テスト
...
✅ Database テストすべてパス
```

---

## STEP 3：Dockerコンテナを起動

```bash
# .envを設定（まだの場合）
cp .env.example .env
# .envを編集してAPIキーを入力

# コンテナをビルド・起動
docker-compose up --build -d

# 起動確認（全コンテナがUpであることを確認）
docker-compose ps
```

---

## STEP 4：統合テストを実行

コンテナ起動後に実行します。

```bash
npm run test:integration
```

> 統合テストはLINE API・Claude API・GitHub APIには接続しません（モックを使用）。

---

## STEP 5：E2Eテスト（Webhookシミュレーター）

実際のコンテナに対してLINEのWebhookリクエストを送信してテストします。

### ヘルスチェック

```bash
npm run simulate:health
# または
node tests/e2e/line-simulate.js health
```

### 新規案件を送信

```bash
node tests/e2e/line-simulate.js new "ReactでTodoアプリを作って"
```

### フィードバックを送信

```bash
node tests/e2e/line-simulate.js fb a1b2c3d4 "ボタンを青にして"
```

### 状態確認

```bash
node tests/e2e/line-simulate.js status a1b2c3d4
```

---

## STEP 6：DBの状態を確認

```bash
# 全案件一覧を表示
node tests/e2e/check-db.js

# 特定案件の詳細を表示
node tests/e2e/check-db.js a1b2c3d4
```

または Docker経由で直接SQLiteを確認：

```bash
docker-compose exec webhook-receiver sh -c \
  "sqlite3 /app/db/projects.db 'SELECT id, status, title FROM projects ORDER BY created_at DESC;'"
```

---

## STEP 7：ログを確認

```bash
# 全コンテナのログをリアルタイムで確認
docker-compose logs -f

# 特定コンテナのみ
docker-compose logs -f webhook-receiver
docker-compose logs -f claude-runner

# エラーのみ表示
docker-compose logs claude-runner | grep '"level":"error"'
```

---

## テスト観点チェックリスト

### 単体テスト
- [ ] `lineHandler.test.js` がすべてパス
- [ ] `jobQueue.test.js` がすべてパス
- [ ] `db.test.js` がすべてパス

### E2Eテスト
- [ ] `/health` が200を返す
- [ ] 不正な署名で401が返る
- [ ] `【案件】` メッセージでDBにレコードが作成される
- [ ] `【FB #ID】` メッセージでmessagesテーブルにFBが保存される
- [ ] 別ユーザーからのメッセージが無視される
- [ ] ログにエラーが出ていない

### Claude API・GitHub API連携テスト（APIキー設定後）
- [ ] 計画書がLINEに送信される
- [ ] コードが生成されてローカルに保存される
- [ ] GitHubにリポジトリが作成される
- [ ] PRが作成されてURLがLINEに届く
- [ ] HTMLが含まれる場合にプレビューURLがLINEに届く
- [ ] FBを送信して修正コードがコミットされる

---

## よくある問題

| 症状 | 対処 |
|------|------|
| `Cannot find module 'better-sqlite3'` | `cd webhook-receiver && npm install` |
| `ECONNREFUSED localhost:3000` | `docker-compose up` でコンテナを起動 |
| テスト用DBが残る | `rm tests/tmp/*.db` で削除 |
| 単体テストでエラー | `node tests/unit/lineHandler.test.js` で個別に実行してログを確認 |
