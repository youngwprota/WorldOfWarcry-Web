#!/usr/bin/env node
// Локальный сервер доски: npm run board → http://localhost:5199
// Читает/пишет карточки в .board/ (worktree ветки board) и синхронизирует их через git.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, loadConfig, loadCards, createCard, updateCard, deleteCard } from './lib.mjs';
import { ensureBoard, boardStatus, syncBoard } from './sync.mjs';

const PORT = Number(process.env.BOARD_PORT) || 5199;
// Тот же board.html, что собирается на GitHub Pages; на порту 5199 он работает с этим сервером.
const STATIC = {
  '/': [join(ROOT, 'board.html'), 'text/html; charset=utf-8'],
  '/tools/board/core.mjs': [join(ROOT, 'tools', 'board', 'core.mjs'), 'text/javascript; charset=utf-8'],
};

function gitUser() {
  try { return execFileSync('git', ['config', 'user.name'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; }
}

function readBody(req) {
  return new Promise((res, rej) => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => { try { res(data ? JSON.parse(data) : {}); } catch (e) { rej(e); } });
    req.on('error', rej);
  });
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (STATIC[p] && req.method === 'GET') return send(res, 200, readFileSync(STATIC[p][0], 'utf8'), STATIC[p][1]);
    if (p === '/api/board' && req.method === 'GET') {
      return send(res, 200, { config: loadConfig(), cards: loadCards(), me: gitUser(), status: boardStatus() });
    }
    if (p === '/api/cards' && req.method === 'POST') return send(res, 200, createCard(await readBody(req)));
    const m = p.match(/^\/api\/cards\/([\w-]+)$/);
    if (m && req.method === 'PUT') return send(res, 200, updateCard(m[1], await readBody(req)));
    if (m && req.method === 'DELETE') { deleteCard(m[1]); return send(res, 200, { ok: true }); }
    if (p === '/api/sync' && req.method === 'POST') return send(res, 200, syncBoard(gitUser()));
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

if (!ensureBoard()) { console.error('Не удалось подготовить .board/ (git worktree)'); process.exit(1); }
server.listen(PORT, '127.0.0.1', () => console.log(`Доска: http://localhost:${PORT}`));
