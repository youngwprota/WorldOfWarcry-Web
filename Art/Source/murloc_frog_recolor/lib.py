# Small numpy helpers shared by the frog paint scripts (run inside Blender's Python: numpy is bundled, PIL is not).
import numpy as np, zlib, struct, bpy

def read_png(path):
    im = bpy.data.images.load(path); im.colorspace_settings.name = 'Non-Color'
    w, h = im.size; a = np.array(im.pixels[:], np.float32).reshape(h, w, 4)[::-1, :, :3]  # top-down rows
    bpy.data.images.remove(im); return a

def write_png(path, rgb):
    a = (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8); h, w, _ = a.shape
    raw = b''.join(b'\0' + a[y].tobytes() for y in range(h))
    def ch(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 6)) + ch(b'IEND', b''))

def box(a, r):
    """Separable box blur, edge-clamped."""
    if r <= 0: return a
    k = 2 * r + 1; out = a
    for ax in (0, 1):
        p = np.pad(out, [(r, r) if i == ax else (0, 0) for i in range(out.ndim)], mode='edge')
        c = np.cumsum(p, axis=ax, dtype=np.float64)
        z = np.zeros_like(np.take(c, [0], axis=ax))
        c = np.concatenate([z, c], axis=ax)
        n = out.shape[ax]
        out = ((np.take(c, range(k, k + n), axis=ax) - np.take(c, range(0, n), axis=ax)) / k).astype(np.float32)
    return out

def nblur(a, mask, r, passes=2):
    """Blur that ignores texels outside the mask (normalised convolution)."""
    m = mask.astype(np.float32); num = a * (m[..., None] if a.ndim == 3 else m)
    den = m
    for _ in range(passes): num = box(num, r); den = box(den, r)
    return num / np.maximum(den, 1e-4)[..., None] if a.ndim == 3 else num / np.maximum(den, 1e-4)

def dilate(img, mask, iters=24):
    img = img.copy(); m = mask.copy()
    for _ in range(iters):
        mf = m.astype(np.float32)
        num = box(img * mf[..., None], 1) * 9; den = box(mf, 1) * 9
        new = (den > 0) & ~m
        img[new] = (num[new] / den[new][:, None]); m = m | new
    return img

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def hx(s): return np.array([int(s[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32)

def ramp(stops, t):
    """stops = (top, mid, bottom) colours; t 0..1 (1 = lit)."""
    top, mid, bot = [hx(s) for s in stops]; t = t[..., None]
    return np.where(t > 0.5, mid + (top - mid) * ((t - 0.5) * 2), bot + (mid - bot) * (t * 2))

def hash3(ix, iy, iz, seed):
    h = (ix.astype(np.int64) * 73856093) ^ (iy.astype(np.int64) * 19349663) ^ (iz.astype(np.int64) * 83492791) ^ (seed * 2654435761)
    h = (h ^ (h >> 13)) * 1274126177 & 0xffffffff
    h = (h ^ (h >> 16)) & 0xffffffff
    return h.astype(np.float64) / 4294967295.0

def vnoise(P, f, seed=1):
    """Smooth value noise 0..1 on (N,3) points."""
    p = P * f; i = np.floor(p); u = p - i; u = u * u * (3 - 2 * u); out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out = out + w * hash3(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out.astype(np.float32)

def worley_spots(P, cell, seed, p_on, r_lo, r_hi, wob=0.0):
    """Irregular blotches: one candidate spot per 3D cell (present with probability p_on, per-point array),
    radius r_lo..r_hi (fraction of cell, skewed to small). Returns max over neighbours of 1 - d/r (spot where > 0)."""
    Q = P * (1.0 / cell); i = np.floor(Q); best = np.full(len(P), -9.0, np.float32)
    if wob:
        Q = Q + (np.stack([vnoise(P, 14, seed + 5), vnoise(P, 14, seed + 6), vnoise(P, 14, seed + 7)], 1) - 0.5) * wob
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                cx, cy, cz = i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz
                px = cx + hash3(cx, cy, cz, seed); py = cy + hash3(cx, cy, cz, seed + 1); pz = cz + hash3(cx, cy, cz, seed + 2)
                on = hash3(cx, cy, cz, seed + 3) < p_on
                r = r_lo + (r_hi - r_lo) * hash3(cx, cy, cz, seed + 4) ** 2
                d = np.sqrt((Q[:, 0] - px) ** 2 + (Q[:, 1] - py) ** 2 + (Q[:, 2] - pz) ** 2)
                v = np.where(on, 1 - d / r, -9.0).astype(np.float32)
                best = np.maximum(best, v)
    return best
