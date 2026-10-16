// Tiny procedural SFX (no audio assets in the project yet).
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
export let muted = false;
const lastPlay = new Map<string, number>();

export function unlockAudio() {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  ctx = new AudioContext();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}

export function setMuted(m: boolean) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.35;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0) {
  if (!ctx || !master) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, freq: number, q = 1) {
  if (!ctx || !master || !noiseBuf) return;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur);
}

/** Rate-limited so 20 simultaneous hits do not clip. */
function gate(key: string, ms: number) {
  const now = performance.now();
  if ((lastPlay.get(key) ?? 0) + ms > now) return false;
  lastPlay.set(key, now);
  return true;
}

export const sfx = {
  swing() { if (gate('swing', 60)) noise(0.12, 0.25, 1800, 0.8); },
  hit(strong = false) {
    if (!gate('hit', 40)) return;
    noise(0.1, 0.5, strong ? 500 : 900, 1.2);
    tone(strong ? 120 : 180, 0.12, 'square', 0.12, 0.5);
  },
  resist() { if (gate('hit', 40)) tone(700, 0.08, 'triangle', 0.15, 0.9); },
  break() { if (gate('break', 50)) { noise(0.25, 0.45, 400, 0.7); tone(90, 0.2, 'sawtooth', 0.1, 0.5); } },
  orb() { if (gate('orb', 35)) tone(660 + Math.random() * 300, 0.12, 'sine', 0.18, 1.6); },
  coin() { if (gate('coin', 35)) { tone(1320, 0.06, 'square', 0.06); tone(1760, 0.1, 'square', 0.06, 1, 0.05); } },
  hurt() { if (gate('hurt', 120)) { noise(0.15, 0.4, 300, 1); tone(140, 0.2, 'sawtooth', 0.12, 0.6); } },
  die() { tone(220, 0.8, 'sawtooth', 0.2, 0.25); },
  slam() { noise(0.5, 0.7, 150, 0.6); tone(60, 0.5, 'sine', 0.4, 0.5); },
  telegraph() { tone(300, 0.3, 'triangle', 0.12, 1.5); },
  levelUp() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'triangle', 0.18, 1, i * 0.09)); },
  combo() { noise(0.35, 0.6, 700, 0.5); [330, 494, 659].forEach((f, i) => tone(f, 0.22, 'sawtooth', 0.1, 1.2, i * 0.05)); },
  click() { tone(900, 0.05, 'square', 0.06); },
  /** Gacha forge: hammer on the anvil, brighter ring for a higher rarity stage. */
  anvil(stage: number) {
    noise(0.18, 0.55, 2400, 0.9);
    tone(1400 + stage * 260, 0.5 + stage * 0.15, 'triangle', 0.14, 0.98);
    tone(2100 + stage * 390, 0.35, 'sine', 0.08, 0.99);
    tone(110, 0.18, 'square', 0.12, 0.5);
  },
  reveal(rarity: number) {
    const base = [392, 440, 523, 587][rarity];
    [1, 1.25, 1.5, 2].slice(0, 2 + Math.min(rarity, 2)).forEach((k, i) => tone(base * k, 0.4 + rarity * 0.25, 'triangle', 0.16, 1, i * 0.08));
    if (rarity >= 3) { noise(0.8, 0.5, 500, 0.4); tone(65, 1, 'sine', 0.35, 0.6); }
  },
  barrier() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.5, 'sine', 0.2, 1, i * 0.12)); },
  /** Location clear bar went up: a soft chime, higher the fuller the bar (p = 0..1). */
  clearTick(p: number) {
    if (!gate('clear', 80)) return;
    const f = 520 * 2 ** (p * 1.2);
    tone(f, 0.16, 'sine', 0.13, 1.02);
    tone(f * 1.5, 0.22, 'triangle', 0.05, 1, 0.04);
  },
  /** The whole location is cleared: a bright fanfare. */
  cleared() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.3, 'triangle', 0.16, 1, i * 0.08));
    [1046, 1568].forEach((f, i) => tone(f, 0.9, 'sine', 0.08, 1, 0.42 + i * 0.05));
    noise(0.6, 0.12, 6000, 0.7);
  },
};
