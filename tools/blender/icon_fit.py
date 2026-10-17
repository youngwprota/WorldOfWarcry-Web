"""Pet icons: blender -b --factory-startup -P icon_fit.py -- <dir of icon_render.py 512px PNGs> public/assets/ui
Rendered with: icon_render.py -- <creature>.glb pet_<id>.png 1.15 0 0 -35 (the bounds there miss skinned models, so this crops and centres)."""
# crop each 512px icon to its alpha bounds, centre it square with a margin, box-resize to 128 px
import bpy, numpy as np, sys, os, zlib, struct
src, dst = sys.argv[-2:]; S = 128
for f in sorted(os.listdir(src)):
    if not f.endswith('.png') or 'raw' in f: continue
    im = bpy.data.images.load(os.path.join(src, f)); im.colorspace_settings.name = 'Non-Color'
    w, h = im.size
    p = np.array(im.pixels[:]).reshape(h, w, 4)
    ys, xs = np.nonzero(p[..., 3] > 0.02)
    side = int(max(ys.max() - ys.min(), xs.max() - xs.min()) * 1.06) + 1
    side = (side + S - 1) // S * S
    c = np.zeros((side, side, 4))
    cy, cx = (ys.min() + ys.max()) // 2, (xs.min() + xs.max()) // 2
    for y in range(side):
        sy = cy - side // 2 + y
        if 0 <= sy < h:
            x0 = cx - side // 2
            a, b = max(0, x0), min(w, x0 + side)
            c[y, a - x0:b - x0] = p[sy, a:b]
    k = side // S
    a = c[..., 3:]
    pm = np.dstack([c[..., :3] * a, a]).reshape(S, k, S, k, 4).mean((1, 3))
    out = np.dstack([pm[..., :3] / np.maximum(pm[..., 3:], 1e-6), pm[..., 3:]])
    rows = (np.clip(out, 0, 1) * 255 + .5).astype(np.uint8)[::-1]
    raw = b''.join(b'\0' + x.tobytes() for x in rows)
    ch = lambda t, dd: struct.pack('>I', len(dd)) + t + dd + struct.pack('>I', zlib.crc32(t + dd))
    open(os.path.join(dst, f), 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', S, S, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))
