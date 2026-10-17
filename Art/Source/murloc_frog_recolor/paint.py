# blender -b --factory-startup -P paint.py -- <orig skin png> <posmap.npz> <out dir>
# Paints the two frog skins (same UVs as the murloc body texture) from the 3D position map of the body mesh:
# region classes + shading t come from the existing painted texture (classify.py), frog colours/patterns from 3D position/normal/bones.
import os, sys, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
from classify import classify
ORIG, POSMAP, OUT = sys.argv[sys.argv.index('--') + 1:][:3]
N = 1024
img = read_png(ORIG); cls, t, _ = classify(img); t = t.astype(np.float32)
D = np.load(POSMAP); pos = D['pos']; valid = D['cover'] > 0
n = D['nor'] / np.maximum(np.linalg.norm(D['nor'], axis=-1, keepdims=True), 1e-6)
cw = D['cw']; cwn = cw / np.maximum(cw.sum(-1, keepdims=True), 1e-4)
yy, xx = np.mgrid[0:N, 0:N]
V = valid

def fld(a, r=2): return nblur(a.astype(np.float32), V, r)
x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
sx = np.where(x >= 0, 1.0, -1.0)
dd = n[..., 1] * 0.6 + n[..., 2] * 0.8              # >0 faces up/back (dorsal), <0 faces down/front (ventral)
inner = -n[..., 0] * sx                              # >0 faces the body centre line
lat = np.abs(n[..., 0])
head, torso, arm, hand, leg, foot, tail, jaw = [fld(cwn[..., i]) for i in range(8)]
dd, inner, lat, zf = fld(dd), fld(inner), fld(lat), fld(z)
nz = fld(n[..., 2])
P = np.stack([np.abs(x), y, z], -1)[V]

EYE_C, EYE_R = (328, 440), 96
ed = np.hypot(xx + 0.5 - EYE_C[0], yy + 0.5 - EYE_C[1])
eye_w = (1 - smooth(EYE_R - 4, EYE_R, ed)).astype(np.float32)
fin_raw = ((cls == 1) & (ed > EYE_R + 2)).astype(np.float32)
fin_w = nblur(fin_raw, np.ones((N, N), bool), 2, 1)
dark_w = nblur((cls == 5).astype(np.float32), np.ones((N, N), bool), 1, 1)
tt = np.clip(0.5 + (np.where(cls == 4, t * 0.78, t) - 0.5) * 1.35, 0, 1).astype(np.float32)        # old leather wrist bands: a bit darker band on the skin

# fin tips: distance (3D) of every fin texel to the nearest body-skin texel
body = V & (fin_raw < 0.5) & (eye_w < 0.5)
S = pos[body][::37]; fi = np.argwhere(V & (fin_raw > 0.5)); Fp = pos[fi[:, 0], fi[:, 1]]
fd = np.zeros(len(Fp), np.float32)
for a in range(0, len(Fp), 3000):
    c = Fp[a:a + 3000]; fd[a:a + 3000] = np.sqrt(((c[:, None, :] - S[None, :, :]) ** 2).sum(-1).min(1))
tipd = np.zeros((N, N), np.float32); tipd[fi[:, 0], fi[:, 1]] = fd / max(np.percentile(fd, 97), 1e-4)
tipd = nblur(tipd, V & (fin_raw > 0.5), 2, 1)
print('fin texels', len(fi), 'tip dist p97', np.percentile(fd, 97))

def mix(a, b, w): return a + (b - a) * w[..., None]
def vn(f, seed, scale=1.0):
    o = np.zeros((N, N), np.float32); o[V] = vnoise(P, f, seed); return o

def eye_tree():
    dx, dy = xx + 0.5 - EYE_C[0], yy + 0.5 - EYE_C[1]; r = np.hypot(dx, dy) / EYE_R
    ax, ay = -0.575, 0.819                                    # slit axis of the original eye
    al = dx * ax + dy * ay; pe = dx * ay - dy * ax
    iris = ramp(('ff5a36', 'e0201a', '8a0a10'), 1 - smooth(0.0, 1.0, r) * 0.9)
    ring = ramp(('ff9a2a', 'ff7a1e', 'b04a10'), np.full((N, N), 0.6, np.float32))
    c = mix(iris, ring, smooth(0.18, 0.5, r) * 0.0 + (1 - smooth(0.0, 0.45, r)) * 0.55)
    c = mix(c, hx('5a0710') * np.ones((N, N, 3), np.float32), smooth(0.82, 0.96, r))
    slit = 1 - smooth(0.7, 1.0, np.sqrt((al / 56) ** 2 + (pe / 11) ** 2))
    c = mix(c, hx('050204') * np.ones((N, N, 3), np.float32), slit)
    hl = 1 - smooth(0.6, 1.0, np.hypot(dx + 38, dy + 40) / 11)
    return mix(c, np.ones((N, N, 3), np.float32), hl * 0.9)

def eye_dart():
    dx, dy = xx + 0.5 - EYE_C[0], yy + 0.5 - EYE_C[1]; r = np.hypot(dx, dy) / EYE_R
    c = ramp(('0a0e1c', '020308', '000001'), 1 - smooth(0.2, 1.0, r))
    hl = 1 - smooth(0.55, 1.0, np.hypot(dx + 36, dy + 40) / 15)
    hl2 = 1 - smooth(0.5, 1.0, np.hypot(dx - 30, dy - 34) / 6)
    return mix(c, np.ones((N, N, 3), np.float32), np.clip(hl * 0.9 + hl2 * 0.5, 0, 1))

def spots(dens, seed, scale=1.0):
    dens = dens[V]
    big = worley_spots(P, 0.11 * scale, seed, dens, 0.14, 0.42, 0.45)
    dots = worley_spots(P, 0.045 * scale, seed + 40, dens * 1.1, 0.2, 0.55, 0.6)
    s = np.zeros((N, N), np.float32); s[V] = np.maximum(smooth(0.0, 0.14, big), smooth(0.0, 0.2, dots)); return s

def finish(col, eye):
    col = mix(col, np.full((N, N, 3), 0.03, np.float32) + 0.03 * tt[..., None], dark_w)
    col = mix(col, eye, eye_w)
    col = dilate(col, V | (eye_w > 0.5) | (fin_raw > 0.5))
    return col

def tree():
    green = ramp(('a4f7c6', '3bdc9f', '0c7366'), tt)
    cream = ramp(('fffaea', 'f1e3c0', 'a99a7c'), tt)
    blue = ramp(('6cb0ff', '2a6fe6', '10338f'), tt)
    orange = ramp(('ffc04c', 'ff8512', 'b4430a'), tt)
    belly = torso * smooth(0.0, 0.5, -dd)
    jawc = jaw + head * smooth(0.1, 0.5, -nz) * 0.9
    limb_in = (arm + leg + hand * 0.5) * smooth(-0.05, 0.35, inner)
    cream_w = np.clip(belly + jawc + limb_in, 0, 1)
    flank = torso * smooth(0.3, 0.65, lat) * (1 - belly)
    thigh = leg * smooth(0.22, 0.42, zf) * smooth(-0.1, 0.3, inner)
    blue_w = np.clip(flank * 1.4 + thigh * 1.2, 0, 1)
    orange_w = smooth(0.4, 0.85, np.clip(hand + foot, 0, 1))
    col = mix(green, cream, cream_w)
    col = mix(col, blue, blue_w * (1 - 0.0))
    ph = np.zeros((N, N), np.float32); ph[V] = P[:, 1] * 17 + P[:, 2] * 2.5 + (vnoise(P, 9, 3) - 0.5) * 1.4
    fr = ph - np.floor(ph)
    stripe = (1 - smooth(0.06, 0.15, np.abs(fr - 0.5))) * smooth(0.55, 0.9, blue_w)
    col = mix(col, cream, stripe)
    col = mix(col, orange, orange_w)
    fin = mix(green, orange, smooth(0.55, 0.85, tipd))
    col = mix(col, fin, fin_w)
    return finish(col, eye_tree())

def dart():
    azure = ramp(('c6f0ff', '5db8ff', '2468cc'), tt)
    cobalt = ramp(('4f7cf2', '2149c4', '0c2478'), tt)
    navy = ramp(('3a5cd0', '172f98', '08104e'), tt)
    dorsal = smooth(-0.15, 0.4, dd) * np.clip(head + torso + tail + arm * 0.7, 0, 1) * (1 - jaw)
    low = np.clip(leg + foot + hand * 0.8 + arm * 0.6 + jaw * 0.8 + smooth(0.0, 0.5, -dd) * torso, 0, 1) * (1 - dorsal)
    col = mix(cobalt, azure, dorsal)
    col = mix(col, navy, low * 0.95)
    dens = np.clip(0.95 * dorsal + 0.30 * leg + 0.22 * arm + 0.12 * (hand + foot) + 0.28 * (jaw + tail) + 0.3 * head + 0.12, 0, 1)
    sp = spots(dens, 11)
    ink = (np.array([0.035, 0.035, 0.08], np.float32) + 0.05 * tt[..., None])
    col = mix(col, ink, sp)
    hl = smooth(0.82, 1.0, tt) * 0.45 * (1 - sp)
    col = mix(col, np.broadcast_to(np.array([0.85, 0.96, 1.0], np.float32), col.shape), hl)
    fin = mix(cobalt, navy, 0.3 * np.ones((N, N), np.float32))
    fsp = spots(np.full((N, N), 0.55, np.float32), 31, 0.8)
    fin = mix(fin, ink, fsp)
    col = mix(col, fin, fin_w)
    return finish(col, eye_dart())

for name, fn in (('dartfrog', dart), ('treefrog', tree)):
    write_png(os.path.join(OUT, f'skin_{name}.png'), fn()); print('wrote', name)
