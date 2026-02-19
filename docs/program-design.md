# プログラム設計書

## クラス・モジュール一覧

| ファイルパス | クラス/モジュール | 責務 |
|-------------|-----------------|------|
| `shared/db.js` | Database | SQLite CRUD操作 |
| `shared/logger.js` | Logger | 構造化ログ出力（JSON形式） |
| `webhook-receiver/src/index.js` | App | Expressサーバー・ルーティング |
| `webhook-receiver/src/lineHandler.js` | LineHandler | LINE署名検証・メッセージ種別判定 |
| `webhook-receiver/src/lineNotifier.js` | LineNotifier | LINE Push/Reply API送信 |
| `webhook-receiver/src/jobQueue.js` | JobQueue | FIFO非同期ジョブキュー |
| `claude-runner/src/runner.js` | Runner | フェーズ制御オーケストレーター |
| `claude-runner/src/planner.js` | Planner | Claude APIでプロジェクト計画書生成 |
| `claude-runner/src/coder.js` | Coder | コード生成・FB差分適用 |
| `claude-runner/src/githubClient.js` | GitHubClient | リポジトリ作成・コミット・PR作成 |
| `claude-runner/src/previewManager.js` | PreviewManager | プレビュー用静的ファイル配置 |

---

## コンポーネント関係図

```
LINE
 │
 ▼
index.js（Express）
 ├── LineHandler.verify()       # 署名検証
 ├── LineHandler.parse()        # メッセージ種別判定
 ├── LineNotifier.reply()       # 即時返信
 └── JobQueue.enqueue()         # キュー登録
         │
         │ DBポーリング（3秒）
         ▼
runner.js
 ├── Planner.generate()         # Phase 1: 計画
 ├── Coder.generate()           # Phase 2: コード生成
 ├── GitHubClient.commitAndPR() # Phase 3: GitHub
 ├── PreviewManager.deploy()    # Phase 4: プレビュー
 └── LineNotifier.push()        # 各フェーズ完了通知
```

---

## データフロー：新規案件

```
LINE → POST /webhook/line
  └─ LineHandler.verify(rawBody, signature)
  └─ LineHandler.parse(events) → [{ type: 'new_project', ... }]
  └─ db.createProject({ lineUserId, description })
  └─ JobQueue.enqueue(job)
  └─ LineNotifier.reply(replyToken, '受付完了')
  └─ res.status(200).json({ status: 'ok' })   ← 5秒以内に返却

[非同期: runner.js ポーリング検知]
  └─ db.updateStatus(id, 'planning')
  └─ Planner.generate(description, id)         ← Claude API
  └─ LineNotifier.push(userId, plan)
  └─ db.updateStatus(id, 'coding')
  └─ Coder.generate(plan, onProgress)          ← Claude API
  └─ GitHubClient.createRepo(repoName)         ← GitHub API
  └─ GitHubClient.commitAndPR(repo, fileMap)   ← GitHub API
  └─ LineNotifier.push(userId, prUrl)
  └─ PreviewManager.deploy(id, fileMap)
  └─ db.updateStatus(id, 'awaiting_feedback')
```

---

## データフロー：フィードバック

```
LINE → POST /webhook/line
  └─ 【FB #a1b2c3d4】修正内容
  └─ LineHandler.detectType() → 'feedback'
  └─ LineHandler.extractProjectId() → 'a1b2c3d4'
  └─ db.saveMessage({ type: 'feedback', content: '修正内容' })
  └─ JobQueue.enqueue({ type: 'feedback', projectId })
  └─ LineNotifier.reply(replyToken, 'FB受付')

[非同期: runner.js]
  └─ Coder.applyFeedback(id, feedback, planMarkdown) ← Claude API
  └─ GitHubClient.commitFeedback(repo, branch, files)
  └─ PreviewManager.deploy(id, updatedFiles)
  └─ LineNotifier.push(userId, '修正完了 ' + prUrl)
```

---

## LineHandler

### `verify(rawBody, signature)`
```
rawBody: string  ← 生のリクエストボディ
signature: string ← X-Line-Signatureヘッダー値

HMAC-SHA256(rawBody, LINE_CHANNEL_SECRET) === signature
```

### `detectType(text)`
```
'【案件】...'  → 'new_project'
'【FB #...'   → 'feedback'
'【状態】...'  → 'status_check'
それ以外       → 'other'（無視）
```

---

## JobQueue

```
enqueue(job)
  └─ queue.push(job)
  └─ isRunning === false → _process()

_process()
  └─ queue.shift() → job
  └─ job.execute()
      ├─ 成功 → emit('complete', job) → _process()（次へ）
      └─ 失敗 → emit('error', { job, err }) → _process()（次へ）
```

特徴：
- 同時実行は常に1件（直列処理）
- エラーが出ても次のジョブは継続
- EventEmitter継承でエラー・完了をindex.jsが受信

---

## エラーハンドリング

| エラー種別 | 対処 | リトライ |
|-----------|------|---------|
| Claude API 429 | 指数バックオフ（1s → 2s → 4s） | 最大3回 |
| Claude API 500 | 30秒後に再試行 | 最大3回 |
| GitHub 401 | リトライなし・LINEにエラー通知 | なし |
| GitHub 422（重複リポジトリ名） | 名前にタイムスタンプ付与して再試行 | 1回 |
| ネットワークタイムアウト | 10秒後に再試行 | 最大3回 |
| uncaughtException | DBをerrorに更新・LINE通知 | なし |

```js
// withRetry() 実装（runner.js）
async function withRetry(fn, maxRetry = 3) {
  for (let i = 0; i < maxRetry; i++) {
    try { return await fn(); }
    catch (err) {
      await sleep(Math.pow(2, i) * 1000);  // 1s, 2s, 4s
    }
  }
  throw lastErr;
}
```

---

## 案件ステータス遷移

```
pending
  └─ queued            ← JobQueue登録時
      └─ planning       ← Planner実行中
          └─ coding     ← Coder実行中
              └─ github ← GitHubClient実行中
                  └─ previewing       ← PreviewManager実行中
                      └─ awaiting_feedback  ← PR作成完了・FB待ち
                          └─ awaiting_processing ← FB受信・処理待ち
                              └─ coding ... （ループ）
                          └─ completed  ← 全作業完了

任意のフェーズ → error  ← エラー発生時
```
