// Git-трекер задач: работа с файлами .board/ (worktree ветки board) для CLI и локального сервера.
// Каждая карточка — отдельный файл cards/<id>.md (frontmatter + описание),
// чтобы правки трёх человек почти никогда не конфликтовали при merge.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCard, serializeCard, sortCards, makeCard, patchCard, renderReadme as readmeText } from './core.mjs';

export { memberName } from './core.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BOARD_DIR = join(ROOT, '.board');
export const CARDS_DIR = join(BOARD_DIR, 'cards');
const CONFIG_PATH = join(BOARD_DIR, 'config.json');

export function loadConfig() {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
}

export function loadCards() {
  if (!existsSync(CARDS_DIR)) return [];
  return sortCards(readdirSync(CARDS_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => parseCard(readFileSync(join(CARDS_DIR, f), 'utf8'), f.slice(0, -3))));
}

export function getCard(id) {
  const p = join(CARDS_DIR, `${sanitizeId(id)}.md`);
  return existsSync(p) ? parseCard(readFileSync(p, 'utf8'), id) : null;
}

function sanitizeId(id) {
  if (!/^[\w-]+$/.test(id)) throw new Error(`bad card id: ${id}`);
  return id;
}

function write(card) {
  mkdirSync(CARDS_DIR, { recursive: true });
  writeFileSync(join(CARDS_DIR, `${sanitizeId(card.id)}.md`), serializeCard(card));
  renderReadme();
  return card;
}

export function createCard(fields) {
  return write(makeCard(loadConfig(), loadCards(), fields));
}

export function updateCard(id, patch) {
  const card = getCard(id);
  if (!card) throw new Error(`card not found: ${id}`);
  return write(patchCard(loadConfig(), loadCards(), card, patch));
}

export function deleteCard(id) {
  const p = join(CARDS_DIR, `${sanitizeId(id)}.md`);
  if (existsSync(p)) unlinkSync(p);
  renderReadme();
}

// Ищет карточку по полному id, по суффиксу id или по части заголовка.
export function findCard(query) {
  const cards = loadCards();
  const q = query.toLowerCase();
  return cards.find(c => c.id === query)
    || cards.find(c => c.id.endsWith(q))
    || cards.find(c => c.title.toLowerCase().includes(q))
    || null;
}

export function renderReadme() {
  writeFileSync(join(BOARD_DIR, 'README.md'), readmeText(loadConfig(), loadCards()));
}
