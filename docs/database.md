# DB設計書（SQLite）

## テーブル一覧

| テーブル名 | 用途 |
|-----------|------|
| projects | 案件のメインテーブル（状態・URL・コンテキスト管理） |
| messages | LINE送受信ログ |
| jobs | ジョブキューの状態管理 |

---

## projectsテーブル

| カラム名 | 型 | 制約 | 説明 |
|---------|-----|------|------|
| id | TEXT | PRIMARY KEY | 案件ID（UUID短縮形） |
| line_user_id | TEXT | NOT NULL | 送信者のLINEユーザーID |
| title | TEXT | NOT NULL DEFAULT '' | 案件タイトル（Claude生成） |
| description | TEXT | NOT NULL | 案件内容（LINEから受信） |
| status | TEXT | NOT NULL DEFAULT 'pending' | ステータス（下記参照） |
| github_repo_url | TEXT | NULL | 作成したGitHubリポジトリURL |
| github_pr_url | TEXT | NULL | 作成したPRのURL |
| preview_url | TEXT | NULL | プレビューURL |
| plan_markdown | TEXT | NULL | 生成されたプロジェクト計画（Markdown） |
| context_json | TEXT | NULL | Claude Codeに渡す累積コンテキスト（JSON） |
| error_message | TEXT | NULL | エラー発生時のメッセージ |
| retry_count | INTEGER | DEFAULT 0 | リトライ回数 |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | 作成日時 |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | 更新日時（トリガーで自動更新） |

### statusの値一覧

```
pending             → 受付待ち
queued              → ジョブキュー待機中
planning            → 計画立案中（Planner実行中）
coding              → コード生成中（Coder実行中）
github              → GitHub操作中
previewing          → プレビュー生成中
awaiting_feedback   → PR作成完了・フィードバック待ち
awaiting_processing → FB受信・処理待ち
completed           → 全作業完了
error               → エラー発生
```

### context_jsonの構造

```json
{
  "repoName": "todo-app",
  "branch": "feat/project-a1b2c3d4",
  "planMarkdown": "# プロジェクト計画書\n..."
}
```

---

## messagesテーブル

| カラム名 | 型 | 制約 | 説明 |
|---------|-----|------|------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | メッセージID |
| project_id | TEXT | FOREIGN KEY（NULLあり） | 紐付く案件ID |
| line_user_id | TEXT | NOT NULL | LINEユーザーID |
| direction | TEXT | NOT NULL | `inbound`（受信）/ `outbound`（送信） |
| message_type | TEXT | NOT NULL | `new_project` / `feedback` / `status_check` / `other` |
| content | TEXT | NOT NULL | メッセージ本文 |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | 日時 |

---

## jobsテーブル

| カラム名 | 型 | 制約 | 説明 |
|---------|-----|------|------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | ジョブID |
| project_id | TEXT | NOT NULL FOREIGN KEY | 対象案件ID |
| phase | TEXT | NOT NULL | `plan` / `code` / `github` / `preview` / `feedback` |
| status | TEXT | NOT NULL DEFAULT 'queued' | `queued` / `running` / `done` / `failed` |
| started_at | DATETIME | NULL | 処理開始日時 |
| finished_at | DATETIME | NULL | 処理完了日時 |
| error_detail | TEXT | NULL | 失敗時の詳細 |

---

## DDL

```sql
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  github_repo_url TEXT,
  github_pr_url TEXT,
  preview_url TEXT,
  plan_markdown TEXT,
  context_json TEXT,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT REFERENCES projects(id),
  line_user_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  phase TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  started_at DATETIME,
  finished_at DATETIME,
  error_detail TEXT
);

CREATE TRIGGER IF NOT EXISTS update_projects_timestamp
AFTER UPDATE ON projects
BEGIN
  UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
```

---

## よく使うクエリ

```sql
-- 未処理の案件を取得
SELECT * FROM projects WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1;

-- 特定案件の全メッセージを取得
SELECT * FROM messages WHERE project_id = 'a1b2c3d4' ORDER BY created_at;

-- エラー案件を一覧表示
SELECT id, title, error_message, updated_at FROM projects WHERE status = 'error';

-- 最新のFBメッセージを取得
SELECT content FROM messages
WHERE project_id = 'a1b2c3d4' AND message_type = 'feedback'
ORDER BY created_at DESC LIMIT 1;
```
