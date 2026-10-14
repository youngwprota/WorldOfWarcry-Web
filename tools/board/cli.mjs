#!/usr/bin/env node
// CLI для доски: node tools/board/cli.mjs <команда> ...
import { loadConfig, loadCards, createCard, updateCard, deleteCard, findCard, memberName, renderReadme } from './lib.mjs';
import { ensureBoard, syncBoard } from './sync.mjs';
import { execFileSync } from 'node:child_process';

const HELP = `Использование: npm run task -- <команда> [аргументы]

  list [--who <участник>] [--col <колонка>]   показать доску
  show <id|часть названия>                    подробности карточки
  add "<название>" [--col c] [--who m] [--prio high|med|low] [--labels a,b] [--body "текст"]
  move <id> <колонка>                         переместить карточку
  assign <id> <участник|->                    назначить исполнителя ("-" — снять)
  edit <id> [--title t] [--prio p] [--labels a,b] [--body "текст"]
  done <id>                                   переместить в последнюю колонку
  rm <id>                                     удалить карточку
  render                                      пересобрать README доски
  sync                                        commit + pull + push ветки board (код не трогает)`;

function parseArgs(argv) {
  const pos = [], opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[i + 1] ?? '', i++;
    else pos.push(argv[i]);
  }
  return { pos, opts };
}

function resolveColumn(config, q) {
  if (!q) return undefined;
  const l = q.toLowerCase();
  const col = config.columns.find(c => c.id === l || c.name.toLowerCase() === l || c.name.toLowerCase().startsWith(l));
  if (!col) throw new Error(`нет колонки "${q}". Есть: ${config.columns.map(c => c.id).join(', ')}`);
  return col.id;
}

function resolveMember(config, q) {
  if (q === undefined) return undefined;
  if (q === '-' || q === '') return '';
  const l = q.toLowerCase();
  const m = config.members.find(m => m.id === l || m.name.toLowerCase().startsWith(l) || (m.git || []).some(g => g.toLowerCase() === l));
  if (!m) throw new Error(`нет участника "${q}". Есть: ${config.members.map(m => m.id).join(', ')}`);
  return m.id;
}

function mustFind(q) {
  const c = q && findCard(q);
  if (!c) throw new Error(`карточка не найдена: ${q}`);
  return c;
}

function line(config, c) {
  const who = c.assignee ? ` @${memberName(config, c.assignee)}` : '';
  const prio = c.priority ? ` [${c.priority}]` : '';
  const labels = c.labels.length ? ` {${c.labels.join(', ')}}` : '';
  return `  ${c.id}  ${c.title}${prio}${who}${labels}`;
}

const [cmd, ...rest] = process.argv.slice(2);
const { pos, opts } = parseArgs(rest);
if (!ensureBoard()) { console.error('Не удалось подготовить .board/ (git worktree)'); process.exit(1); }
const config = loadConfig();

try {
  switch (cmd) {
    case 'list': case 'ls': case undefined: {
      const who = resolveMember(config, opts.who);
      const colFilter = resolveColumn(config, opts.col);
      const cards = loadCards().filter(c => (who === undefined || c.assignee === who) && (!colFilter || c.column === colFilter));
      for (const col of config.columns) {
        if (colFilter && col.id !== colFilter) continue;
        const list = cards.filter(c => c.column === col.id);
        console.log(`\n■ ${col.name} (${list.length})`);
        for (const c of list) console.log(line(config, c));
      }
      const orphans = cards.filter(c => !config.columns.some(col => col.id === c.column));
      if (orphans.length) { console.log('\n■ ? неизвестная колонка'); orphans.forEach(c => console.log(line(config, c))); }
      break;
    }
    case 'show': {
      const c = mustFind(pos[0]);
      console.log(`${c.title}\n  id: ${c.id}\n  колонка: ${c.column}\n  исполнитель: ${memberName(config, c.assignee)}\n  приоритет: ${c.priority || '—'}\n  метки: ${c.labels.join(', ') || '—'}\n  создана: ${c.created}  обновлена: ${c.updated}\n\n${c.body}`);
      break;
    }
    case 'add': {
      if (!pos[0]) throw new Error('нужно название');
      const c = createCard({
        title: pos[0],
        column: resolveColumn(config, opts.col),
        assignee: resolveMember(config, opts.who) || '',
        priority: opts.prio || '',
        labels: opts.labels ? opts.labels.split(',').map(s => s.trim()).filter(Boolean) : [],
        body: opts.body || '',
      });
      console.log(`создана ${c.id} в "${c.column}"`);
      break;
    }
    case 'move': {
      const c = mustFind(pos[0]);
      updateCard(c.id, { column: resolveColumn(config, pos[1]) });
      console.log(`${c.id} → ${pos[1]}`);
      break;
    }
    case 'done': {
      const c = mustFind(pos[0]);
      updateCard(c.id, { column: config.columns.at(-1).id });
      console.log(`${c.id} → ${config.columns.at(-1).name}`);
      break;
    }
    case 'assign': {
      const c = mustFind(pos[0]);
      const who = resolveMember(config, pos[1] ?? '-');
      updateCard(c.id, { assignee: who });
      console.log(`${c.id} → @${memberName(config, who)}`);
      break;
    }
    case 'edit': {
      const c = mustFind(pos[0]);
      const patch = {};
      if (opts.title !== undefined) patch.title = opts.title;
      if (opts.prio !== undefined) patch.priority = opts.prio;
      if (opts.labels !== undefined) patch.labels = opts.labels.split(',').map(s => s.trim()).filter(Boolean);
      if (opts.body !== undefined) patch.body = opts.body;
      if (opts.col !== undefined) patch.column = resolveColumn(config, opts.col);
      if (opts.who !== undefined) patch.assignee = resolveMember(config, opts.who);
      updateCard(c.id, patch);
      console.log(`обновлена ${c.id}`);
      break;
    }
    case 'rm': {
      const c = mustFind(pos[0]);
      deleteCard(c.id);
      console.log(`удалена ${c.id} (${c.title})`);
      break;
    }
    case 'sync': {
      let user = '';
      try { user = execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim(); } catch {}
      const r = syncBoard(user);
      console.log(r.log.join('\n\n'));
      if (!r.ok) process.exit(1);
      break;
    }
    case 'render':
      renderReadme();
      console.log('README доски обновлён');
      break;
    default:
      console.log(HELP);
  }
} catch (e) {
  console.error(`Ошибка: ${e.message}`);
  process.exit(1);
}
