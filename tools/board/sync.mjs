// Доска живёт в отдельной ветке `board` (только карточки), подключённой как git worktree в .board/.
// Синхронизация работает только внутри .board/ — код и текущая ветка разработчика не затрагиваются.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, BOARD_DIR, renderReadme } from './lib.mjs';

const BRANCH = 'board';

function git(cwd, ...args) {
  try {
    const out = execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { ok: true, out: out.trim() };
  } catch (e) {
    return { ok: false, out: ((e.stdout || '') + (e.stderr || '') || e.message).trim() };
  }
}

// Создаёт .board/: берёт ветку board с origin, а если её ещё нет — пустую orphan-ветку.
export function ensureBoard(log = []) {
  if (existsSync(join(BOARD_DIR, '.git'))) return true;
  git(ROOT, 'worktree', 'prune');
  git(ROOT, 'fetch', 'origin', BRANCH);
  const remote = git(ROOT, 'rev-parse', '--verify', '--quiet', `origin/${BRANCH}`).ok;
  const local = git(ROOT, 'rev-parse', '--verify', '--quiet', BRANCH).ok;
  let r;
  if (local) r = git(ROOT, 'worktree', 'add', '.board', BRANCH);
  else if (remote) r = git(ROOT, 'worktree', 'add', '--track', '-b', BRANCH, '.board', `origin/${BRANCH}`);
  else r = git(ROOT, 'worktree', 'add', '--orphan', '-b', BRANCH, '.board');
  log.push(`$ git worktree add .board\n${r.out}`);
  if (!r.ok) return false;
  if (!remote && !local) {
    mkdirSync(join(BOARD_DIR, 'cards'), { recursive: true });
    writeFileSync(join(BOARD_DIR, '.gitattributes'), '* text eol=lf\nREADME.md merge=union\n');
  }
  return true;
}

export function boardStatus() {
  const st = git(BOARD_DIR, 'status', '--porcelain');
  const ahead = git(BOARD_DIR, 'rev-list', '--count', '@{u}..HEAD');
  return {
    branch: BRANCH,
    dirty: st.out ? st.out.split('\n').length : 0,
    unpushed: ahead.ok ? Number(ahead.out) : null, // null — ветка ещё не опубликована
  };
}

export function syncBoard(user) {
  const log = [];
  const step = (...args) => { const r = git(BOARD_DIR, ...args); log.push(`$ git ${args.join(' ')}\n${r.out}`); return r; };
  if (!ensureBoard(log)) return { ok: false, log };

  const commit = () => {
    step('add', '-A');
    if (!git(BOARD_DIR, 'diff', '--cached', '--quiet').ok) {
      return step('commit', '-m', `board: обновление (${user || 'unknown'})`).ok;
    }
    return true;
  };
  if (!commit()) return { ok: false, log };

  const hasUpstream = git(BOARD_DIR, 'rev-parse', '--abbrev-ref', '@{u}').ok;
  const remoteExists = git(BOARD_DIR, 'ls-remote', '--exit-code', '--heads', 'origin', BRANCH).ok;
  if (remoteExists) {
    if (!hasUpstream) step('branch', `--set-upstream-to=origin/${BRANCH}`);
    const pull = step('pull', '--rebase', 'origin', BRANCH);
    if (!pull.ok) {
      step('rebase', '--abort');
      log.push('Конфликт при слиянии карточек — изменения не потеряны, разберитесь вручную в .board/ или попросите Claude.');
      return { ok: false, log };
    }
    // README собирается через merge=union и после rebase может содержать дубли — пересобираем.
    renderReadme();
    if (!commit()) return { ok: false, log };
  }
  const push = step('push', '-u', 'origin', BRANCH);
  return { ok: push.ok, log };
}
