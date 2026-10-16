import bpy, numpy as np, sys, zlib, struct, os
src, dst = sys.argv[-2:]; S = 128
for f in sorted(os.listdir(src)):
    if not f.endswith('.png') or 'raw' in f: continue
    im = bpy.data.images.load(os.path.join(src, f)); im.colorspace_settings.name = 'Non-Color'
    p = np.array(im.pixels[:]).reshape(512, 512, 4)
    a = p[..., 3:]
    # premultiplied box-downsample so transparent pixels don't bleed dark
    pm = np.dstack([p[..., :3] * a, a]).reshape(S, 4, S, 4, 4).mean((1, 3))
    out = np.dstack([pm[..., :3] / np.maximum(pm[..., 3:], 1e-6), pm[..., 3:]])
    rows = (np.clip(out, 0, 1) * 255 + .5).astype(np.uint8)[::-1]
    raw = b''.join(b'\0' + x.tobytes() for x in rows)
    ch = lambda t, dd: struct.pack('>I', len(dd)) + t + dd + struct.pack('>I', zlib.crc32(t + dd))
    open(os.path.join(dst, f.replace('icon_', '')), 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', S, S, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))
