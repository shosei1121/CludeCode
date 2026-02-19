#!/usr/bin/env node
try { require('dotenv').config(); } catch {}

const path = require('path');
const fs   = require('fs');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../db/projects.db');

if (!fs.existsSync(DB_PATH)) {
  console.error(`❌ DBファイルが見つかりません: ${DB_PATH}`);
  console.error('   docker-compose up でサーバーを起動してから実行してください。');
  process.exit(1);
}

const { Database } = require('node-sqlite3-wasm');
const db = new Database(DB_PATH);

const [,, projectId] = process.argv;
const STATUS_ICONS = {
  pending:'⏳', queued:'🔜', planning:'📋', coding:'⚙️', github:'🔀',
  previewing:'👀', pr_created:'✅', awaiting_feedback:'💬',
  awaiting_processing:'🔧', completed:'🎉', error:'❌',
};

if (projectId) {
  const project = db.get('SELECT * FROM projects WHERE id = ?', [projectId]);
  if (!project) { console.error(`❌ 案件 #${projectId} が見つかりません`); process.exit(1); }
  const icon = STATUS_ICONS[project.status] || '❓';
  console.log(`\n${'─'.repeat(60)}\n${icon} 案件 #${project.id}\n${'─'.repeat(60)}`);
  console.log(`タイトル   : ${project.title || '（未設定）'}`);
  console.log(`ステータス : ${project.status}`);
  console.log(`説明       : ${project.description}`);
  console.log(`作成日時   : ${project.created_at}`);
  if (project.github_pr_url)  console.log(`PR URL     : ${project.github_pr_url}`);
  if (project.preview_url)    console.log(`プレビュー : ${project.preview_url}`);
  if (project.error_message)  console.log(`エラー     : ${project.error_message}`);
  if (project.context_json) {
    try { const ctx = JSON.parse(project.context_json); console.log(`\nコンテキスト:\n  リポジトリ名: ${ctx.repoName}\n  ブランチ    : ${ctx.branch}`); } catch {}
  }
  const msgs = db.all('SELECT * FROM messages WHERE project_id = ? ORDER BY created_at', [projectId]);
  if (msgs.length) {
    console.log(`\nメッセージ履歴 (${msgs.length}件):`);
    msgs.forEach(m => console.log(`  ${m.created_at} ${m.direction==='inbound'?'→':'←'} [${m.message_type}] ${String(m.content).slice(0,60)}`));
  }
} else {
  const projects = db.all('SELECT * FROM projects ORDER BY created_at DESC LIMIT 20');
  console.log('\n📦 案件一覧 (最新20件)\n');
  console.log('ID'.padEnd(12) + 'ステータス'.padEnd(22) + 'タイトル'.padEnd(30) + '更新日時');
  console.log('─'.repeat(90));
  if (!projects.length) {
    console.log('（案件なし）');
  } else {
    projects.forEach(p => {
      const icon = STATUS_ICONS[p.status] || '❓';
      console.log(String(p.id).padEnd(12) + `${icon} ${p.status}`.padEnd(22) + (p.title||p.description).slice(0,28).padEnd(30) + p.updated_at);
    });
  }
  const err = db.get("SELECT COUNT(*) as c FROM projects WHERE status = 'error'");
  if (err && err.c > 0) console.log(`\n⚠️  エラー状態の案件が ${err.c} 件あります。\n詳細: node tests/e2e/check-db.js <projectId>`);
}
console.log('');
db.close();
