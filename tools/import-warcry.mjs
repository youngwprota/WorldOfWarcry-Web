// Copies party-class models (hunter, …) out of the newer Unity project (Warcry) and converts its
// shared albedo atlases to PNG (macOS `sips`). Files are renamed so they don't clash with the old kit.
// Usage: WARCRY_ART=/path/to/Assets/_Project/Art node tools/import-warcry.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART = process.env.WARCRY_ART ?? '/Users/gr/Desktop/Warcry/Assets/_Project/Art';
const OUT = join(ROOT, 'public/assets');
const C = 'Characters';

/** source → name in public/assets/models */
const models = {
  [`${C}/Humans/Models/archer.fbx`]: 'human_archer',
  [`${C}/Humans/Models/bow.fbx`]: 'bow_human_archer',
  [`${C}/Humans/Models/arrow.fbx`]: 'arrow_human_archer',
  [`${C}/Orcs/Models/orc_archer.fbx`]: 'orc_archer',
  [`${C}/Orcs/Models/bow_orc_archer.fbx`]: 'bow_orc_archer',
  [`${C}/Orcs/Models/arrow_orc_archer.fbx`]: 'arrow_orc_archer',
};

const textures = {
  [`${C}/Humans/Textures/human_albedo.tga`]: 'human_albedo',
  [`${C}/Orcs/Textures/orc_albedo.tga`]: 'orc_albedo',
};

mkdirSync(join(OUT, 'models'), { recursive: true });
mkdirSync(join(OUT, 'textures'), { recursive: true });

let missing = 0;
for (const [rel, name] of Object.entries(models)) {
  const src = join(ART, rel);
  if (!existsSync(src)) { console.warn('missing', rel); missing++; continue; }
  copyFileSync(src, join(OUT, 'models', `${name}.fbx`));
}
for (const [rel, name] of Object.entries(textures)) {
  const src = join(ART, rel);
  if (!existsSync(src)) { console.warn('missing', rel); missing++; continue; }
  execFileSync('sips', ['-s', 'format', 'png', '-Z', '1024', src, '--out', join(OUT, 'textures', `${name}.png`)], { stdio: 'ignore' });
}
console.log(`models: ${Object.keys(models).length}, textures: ${Object.keys(textures).length}, missing: ${missing}`);
