/**
 * shared/db.js
 * node-sqlite3-wasm（純粋WASM）を使用
 * → Windows・Mac・Linux 全環境でネイティブビルド不要
 * → better-sqlite3 と同様に完全同期API
 */
const path = require('path');
const fs   = require('fs');
const { Database } = require('node-sqlite3-wasm');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../db/projects.db');

let _db = null;

function getDb() {
  if (_db) return _db;
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  _db = new Database(DB_PATH);
  _db.run('PRAGMA foreign_keys = ON;');
  initSchema();
  return _db;
}

function initSchema() {
  _db.run(`CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    line_user_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    github_repo_url TEXT, github_pr_url TEXT, preview_url TEXT,
    plan_markdown TEXT, context_json TEXT, error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now')),
    updated_at DATETIME DEFAULT (datetime('now'))
  );`);
  _db.run(`CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT REFERENCES projects(id),
    line_user_id TEXT NOT NULL, direction TEXT NOT NULL,
    message_type TEXT NOT NULL, content TEXT NOT NULL,
    created_at DATETIME DEFAULT (datetime('now'))
  );`);
  _db.run(`CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    phase TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
    started_at DATETIME, finished_at DATETIME, error_detail TEXT
  );`);
  try {
    _db.run(`CREATE TRIGGER IF NOT EXISTS update_projects_ts
      AFTER UPDATE ON projects BEGIN
        UPDATE projects SET updated_at = datetime('now') WHERE id = NEW.id;
      END;`);
  } catch {}
}

// ── Projects ──────────────────────────────

function createProject({ lineUserId, description }) {
  const id = uuidv4().replace(/-/g, '').slice(0, 8);
  getDb().run('INSERT INTO projects (id, line_user_id, description) VALUES (?, ?, ?)', [id, lineUserId, description]);
  return getProject(id);
}

function getProject(id) {
  const row = getDb().get('SELECT * FROM projects WHERE id = ?', [id]);
  if (!row) return null;
  if (row.context_json) { try { row.context = JSON.parse(row.context_json); } catch { row.context = null; } }
  return row;
}

function updateStatus(id, status) {
  getDb().run('UPDATE projects SET status = ? WHERE id = ?', [status, id]);
}

function updateProjectFields(id, fields) {
  const allowed = ['title','status','github_repo_url','github_pr_url','preview_url','plan_markdown','error_message','retry_count'];
  const entries = Object.entries(fields).filter(([k]) => allowed.includes(k));
  if (!entries.length) return;
  getDb().run(
    `UPDATE projects SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...entries.map(([,v]) => v), id]
  );
}

function updateContext(id, context) {
  getDb().run('UPDATE projects SET context_json = ? WHERE id = ?', [JSON.stringify(context), id]);
}

function incrementRetry(id) {
  getDb().run('UPDATE projects SET retry_count = retry_count + 1 WHERE id = ?', [id]);
}

// ── Messages ──────────────────────────────

function saveMessage({ projectId, lineUserId, direction, messageType, content }) {
  getDb().run(
    'INSERT INTO messages (project_id, line_user_id, direction, message_type, content) VALUES (?, ?, ?, ?, ?)',
    [projectId || null, lineUserId, direction, messageType, content]
  );
}

// ── Jobs ──────────────────────────────────

function createJob({ projectId, phase }) {
  const db = getDb();
  db.run('INSERT INTO jobs (project_id, phase) VALUES (?, ?)', [projectId, phase]);
  const row = db.get('SELECT last_insert_rowid() as id');
  return row ? row.id : null;
}

function updateJobStatus(projectId, phase, status, errorDetail = null) {
  const timeField = status === 'running' ? 'started_at' : 'finished_at';
  getDb().run(
    `UPDATE jobs SET status = ?, ${timeField} = datetime('now'), error_detail = COALESCE(?, error_detail)
     WHERE project_id = ? AND phase = ? AND id = (SELECT id FROM jobs WHERE project_id = ? AND phase = ? ORDER BY id DESC LIMIT 1)`,
    [status, errorDetail, projectId, phase, projectId, phase]
  );
}

module.exports = { createProject, getProject, updateStatus, updateProjectFields, updateContext, incrementRetry, saveMessage, createJob, updateJobStatus };
