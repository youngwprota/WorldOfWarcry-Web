# Recovers the region class (skin/fin/...) and the shading value t of every texel of the current painted murloc skin
# by matching it to the faction ramps that repaint.py used (v4: Art/Source archive human_murloc_v4_yellowfins).
import os, sys, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import *
R = {'skin': ('f0bf86', 'c98451', '6a3a22'), 'fin': ('7594b4', '415684', '1b243c'),
     'yellow': ('fbe76f', 'eda950', '8a5a1c'), 'gold': ('f0d952', 'af7e3b', '48351b'),
     'cloth': ('7594b4', '415684', '1b243c'), 'leather': ('a8754f', '6b4632', '2e1d17'),
     'metal': ('a9c2c4', '69857d', '24333c'), 'dark': ('2a1c1c', '160e10', '080506')}
K = ['skin', 'yellow', 'gold', 'cloth', 'leather', 'dark']  # 'fin' == 'cloth' stops, 'metal' is armour only
def classify(img):
    T = np.linspace(0, 1, 33, dtype=np.float32)
    best = np.full(img.shape[:2], 9e9, np.float32); cls = np.zeros(img.shape[:2], np.int8); tt = np.zeros(img.shape[:2], np.float32)
    for ci, k in enumerate(K):
        curve = ramp(R[k], T)
        for ti, c in zip(T, curve):
            d = ((img - c) ** 2).sum(-1)
            m = d < best; best[m] = d[m]; cls[m] = ci; tt[m] = ti
    return cls, tt, best
if __name__ == '__main__':
    src, out = sys.argv[sys.argv.index('--') + 1:][:2]
    img = read_png(src); cls, tt, err = classify(img)
    vis = np.array([hx(c) for c in ('d09060', 'ffee40', 'ffffff', '2040ff', '60ff60', '000000')])[cls] * (0.4 + 0.6 * tt)[..., None]
    write_png(out, vis); print('err mean', err.mean(), [int((cls == i).sum()) for i in range(len(K))])
    np.savez_compressed(out.replace('.png', '.npz'), cls=cls, t=tt)
