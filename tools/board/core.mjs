// Общая логика доски без зависимостей от Node: используется и CLI/сервером, и страницей board.html на Pages.

const FIELDS = ['id', 'title', 'column', 'assignee', 'priority', 'labels', 'order', 'created', 'updated'];

export function parseCard(text, fileId) {
  const card = { id: fileId, title: '', column: '', assignee: '', priority: '', labels: [], order: 0, created: '', updated: '', body: '' };
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) { card.body = text; return card; }
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim();
    if (key === 'labels') card.labels = val ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
    else if (key === 'order') card.order = Number(val) || 0;
    else card[key] = val;
  }
  card.id = fileId;
  card.body = m[2].replace(/^\n+/, '').replace(/\s+$/, '');
  return card;
}

export function serializeCard(card) {
  const lines = FIELDS.map(k => {
    let v = card[k];
    if (k === 'labels') v = (v || []).join(', ');
    if (v === undefined || v === null) v = '';
    return `${k}: ${String(v).replace(/\n/g, ' ')}`;
  });
  return `---\n${lines.join('\n')}\n---\n\n${(card.body || '').trim()}\n`;
}

export function sortCards(cards) {
  return cards.sort((a, b) => a.order - b.order || a.created.localeCompare(b.created));
}

export function now() {
  return new Date().toISOString().slice(0, 16).replace('T', ' ');
}

export function newId() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rnd = [...crypto.getRandomValues(new Uint8Array(2))].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${ymd}-${rnd}`;
}

export function memberName(config, id) {
  return config.members.find(m => m.id === id)?.name || id || '—';
}

function lastOrder(cards, column) {
  const inCol = cards.filter(c => c.column === column);
  return inCol.length ? Math.max(...inCol.map(c => c.order)) + 1 : 1;
}

// Колонка участника (Гриша/Леша/Даша) сама назначает исполнителя.
function applyRules(config, card) {
  const col = config.columns.find(c => c.id === card.column);
  if (col?.member) card.assignee = col.member;
  card.updated = now();
  return card;
}

export function makeCard(config, cards, fields) {
  const column = fields.column || config.columns[0].id;
  return applyRules(config, {
    id: newId(), title: '', assignee: '', priority: '', labels: [], body: '',
    ...fields,
    column,
    order: fields.order ?? lastOrder(cards, column),
    created: now(),
  });
}

export function patchCard(config, cards, card, patch) {
  patch = { ...patch };
  if (patch.column && patch.column !== card.column && patch.order === undefined) patch.order = lastOrder(cards, patch.column);
  return applyRules(config, { ...card, ...patch, id: card.id, created: card.created });
}

// README.md ветки board — снимок доски, чтобы её было видно прямо на GitHub.
export function renderReadme(config, cards) {
  const out = [`# ${config.title}`, '', '> Автогенерация из `cards/`. Интерактивная доска — на GitHub Pages (`board.html`) или `npm run board` локально.', ''];
  for (const col of config.columns) {
    const list = cards.filter(c => c.column === col.id);
    out.push(`## ${col.name} (${list.length})`, '');
    if (!list.length) out.push('_пусто_', '');
    for (const c of list) {
      const meta = [
        c.assignee && `@${memberName(config, c.assignee)}`,
        c.priority && `приоритет: ${c.priority}`,
        ...c.labels.map(l => `\`${l}\``),
      ].filter(Boolean).join(' · ');
      out.push(`- [${c.title || '(без названия)'}](cards/${c.id}.md)${meta ? ` — ${meta}` : ''}`);
    }
    if (list.length) out.push('');
  }
  return out.join('\n');
}
