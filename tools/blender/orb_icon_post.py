"""Mage orb icons: tools/orbicons.html (npm run dev, open /tools/orbicons.html) renders each orb with its magic
(src/orbfx.ts) at 1536px; save window.icons to PNGs, then:
blender -b --factory-startup -P tools/blender/orb_icon_post.py -- <png_dir> public/assets/ui   (ink outline, 128px)"""
import bpy, numpy as np, sys, os, zlib, struct
src, dst = sys.argv[sys.argv.index('--') + 1:][:2]
N, S = 1536, 128
for f in sorted(os.listdir(src)):
    if not f.endswith('.png'): continue
    im = bpy.data.images.load(os.path.join(src, f)); im.colorspace_settings.name = 'Non-Color'
    px = np.array(im.pixels[:]).reshape(N, N, 4)
    a = px[..., 3]
    m = a > 0.35  # the outline hugs the solid part, not the faint halo
    # opening: drop the small motes from the outline mask (they glow without an ink rim)
    def morph(x, r, grow):
        xp = np.pad(x, r, constant_values=not grow); out = x.copy()
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= r * r:
                    sh = xp[r + dy:r + dy + N, r + dx:r + dx + N]
                    out = (out | sh) if grow else (out & sh)
        return out
    m = morph(morph(m, 9, False), 9, True)
    R = 15
    mp = np.pad(m, R); d = m.copy()
    for dy in range(-R, R + 1):
        for dx in range(-R, R + 1):
            if dx * dx + dy * dy <= R * R: d |= mp[R + dy:R + dy + N, R + dx:R + dx + N]
    rgb = np.clip((px[..., :3] - 0.5) * 1.1 + 0.5, 0, 1)
    o = (d & ~m).astype(float)
    # the halo stays on top of the outline, softly
    A = a + o * (1 - a)
    rgb = rgb * (a / np.maximum(A, 1e-6))[..., None]
    res = np.dstack([rgb * A[..., None], A]).reshape(S, N // S, S, N // S, 4).mean((1, 3))
    res[..., :3] /= np.maximum(res[..., 3:], 1e-6)
    rows = (np.clip(res, 0, 1) * 255 + .5).astype(np.uint8)[::-1]
    raw = b''.join(b'\0' + x.tobytes() for x in rows)
    ch = lambda t, dd: struct.pack('>I', len(dd)) + t + dd + struct.pack('>I', zlib.crc32(t + dd))
    open(os.path.join(dst, f), 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', S, S, 8, 6, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))
    print('icon', f)
