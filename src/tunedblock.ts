// The tuner's block at the end of src/config.ts. No imports: vite.config.ts (the dev server's write endpoint) loads it too.
/**
 * config.ts text with `sets` written into its `// <tuned>` … `// </tuned>` block: lines already there are kept unless
 * a set replaces them, one assignment per line (`MOBS.death.hp = 21400;`). `manual` (when given) is the whole list of
 * hand-set knobs: their lines are written with `TUNE_MANUAL.push('…');`, every other line loses that mark (the number
 * stays, the tuner may change it again). The CLI (--write) and the dev server use it.
 */
export function writeTuned(src: string, sets: Record<string, number>, manual?: Record<string, number>): string {
  const m = /\/\/ <tuned>\r?\n([\s\S]*?)\/\/ <\/tuned>/.exec(src);
  if (!m) throw new Error('в config.ts нет блока // <tuned> … // </tuned>');
  const lines = new Map<string, string>();
  const hand = new Set<string>();
  for (const l of m[1].split(/\r?\n/)) {
    const x = /^\s*([\w.]+)\s*=\s*([^;]+);/.exec(l);
    if (!x) continue;
    lines.set(x[1], x[2].trim());
    if (l.includes('TUNE_MANUAL.push')) hand.add(x[1]);
  }
  for (const [p, v] of Object.entries(sets)) lines.set(p, String(v));
  if (manual) {
    hand.clear();
    for (const [p, v] of Object.entries(manual)) { lines.set(p, String(v)); hand.add(p); }
  }
  const nl = src.includes('\r\n') ? '\r\n' : '\n';
  const body = [...lines.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([p, v]) => `${p} = ${v};${hand.has(p) ? ` TUNE_MANUAL.push('${p}');` : ''}${nl}`).join('');
  return src.slice(0, m.index) + `// <tuned>${nl}${body}// </tuned>` + src.slice(m.index + m[0].length);
}
