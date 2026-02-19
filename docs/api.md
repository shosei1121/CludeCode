# API仕様書

## webhook-receiver エンドポイント

### POST /webhook/line

LINE Webhookの受信口。

**リクエスト**

| 項目 | 内容 |
|------|------|
| Content-Type | application/json |
| X-Line-Signature | HMAC-SHA256署名（必須） |

```json
{
  "events": [
    {
      "type": "message",
      "replyToken": "xxx",
      "source": { "userId": "Uxxxx", "type": "user" },
      "message": { "type": "text", "text": "【案件】内容" }
    }
  ]
}
```

**レスポンス**

```json
{ "status": "ok" }
```

> 常に200を返す。処理は非同期で行う（LINEの5秒タイムアウト対策）。

---

### GET /health

ヘルスチェック。

**レスポンス**

```json
{
  "status": "ok",
  "queue": {
    "isRunning": false,
    "queueLength": 0,
    "pending": []
  }
}
```

---

## LINE Messaging API

### Push Message（非同期通知）

```
POST https://api.line.me/v2/bot/message/push
Authorization: Bearer {LINE_CHANNEL_ACCESS_TOKEN}

{
  "to": "{LINE_USER_ID}",
  "messages": [{ "type": "text", "text": "通知内容" }]
}
```

### Reply Message（Webhook受信時の即時返信）

```
POST https://api.line.me/v2/bot/message/reply
Authorization: Bearer {LINE_CHANNEL_ACCESS_TOKEN}

{
  "replyToken": "{replyToken}",
  "messages": [{ "type": "text", "text": "返信内容" }]
}
```

### 通知一覧

| タイミング | 方法 | メッセージ例 |
|-----------|------|-------------|
| 案件受付 | reply | `✅ 案件 #a1b2c3d4 を受け付けました。計画立案中…` |
| 計画完了 | push | `📋 案件 #a1b2c3d4 の計画書が完成しました。\n{計画書}` |
| コード生成50% | push | `⚙️ 案件 #a1b2c3d4 コード生成中... 50%` |
| PR作成完了 | push | `🔀 案件 #a1b2c3d4 のコードが完成しました！\nPR: {URL}` |
| プレビュー公開 | push | `👀 案件 #a1b2c3d4 のプレビューを公開しました。\nURL: {URL}` |
| FB受付 | reply | `🔧 案件 #a1b2c3d4 のフィードバックを受け付けました。修正中…` |
| FB完了 | push | `✅ 案件 #a1b2c3d4 の修正が完了しました。\nPR: {URL}` |
| エラー発生 | push | `❌ 案件 #a1b2c3d4 でエラーが発生しました。\n{詳細}` |

---

## GitHub API（Octokit）

### 使用メソッド一覧

| 操作 | メソッド | タイミング |
|------|---------|-----------|
| リポジトリ作成 | `repos.createForAuthenticatedUser` | Phase: github（初回） |
| ブランチ作成 | `git.createRef` | PR作成前 |
| ファイルコミット | `repos.createOrUpdateFileContents` | コード生成後 |
| PR作成 | `pulls.create` | コミット完了後 |
| 既存ファイルSHA取得 | `repos.getContent` | ファイル更新時 |

### リポジトリ命名規則

```
{plan.repoName}          # 例: todo-app
{plan.repoName}-{6桁timestamp}  # 重複時: todo-app-123456
```

### ブランチ命名規則

```
feat/project-{projectId}  # 例: feat/project-a1b2c3d4
```
