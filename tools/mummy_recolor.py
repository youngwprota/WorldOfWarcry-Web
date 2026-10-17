"""Mummy recolour of the undead palette atlas (1024^2, 2 rows x 16 swatch columns of vertical gradients)."""
import sys
from PIL import Image

SRC, DST = sys.argv[1], sys.argv[2]
GRAD_H = 462  # rows below carry the baked labels: leave them alone

def hexc(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

# (row, col) -> (top, mid, bottom); anything not listed (IRIS, GLOW*, GOLD, WOOD, labels) is kept as is
TARGET = {
    (0, 0): ('b58d6a', '634a37', '221812'),   # SKIN: tauren dried brown hide
    (0, 1): ('f3ecd4', 'beb094', '4a4034'),   # SKIN SHADE (exposed bone): pale bone
    (0, 5): ('fbf0c6', 'af9993', '4a4244'),   # HORNS: tauren ivory
    (0, 6): ('faf0c7', 'b19b95', '4a4244'),   # TEETH: tauren ivory
    (0, 7): ('52453d', '2b241f', '0e0b09'),   # EYES: tauren dark sockets (IRIS stays green)
    (0, 9): ('cdb080', '94794f', '3b2d20'),   # HAIR: the wrappings, linen bandage
    (0, 10): ('d8cbb0', 'a89878', '4a4034'),  # HAIR2
    (0, 11): ('ad8f68', '6a5440', '2c221a'),  # CLOTH PRIME: tauren tan leather
    (0, 12): ('a95d47', '53302f', '241516'),  # CLOTH SEC: tauren rust leather accent
    (0, 13): ('8a6a48', '4a3826', '1c140e'),  # CLOTH TER: dark wrap
    (0, 14): ('6a4a3a', '3a281f', '170f0c'),  # CUST1: tauren dark brown
    (0, 15): ('b0694a', '5c3624', '20120c'),  # CUST2: tauren rust
    (1, 0): ('8a7a68', '4d4036', '1b1613'),   # METAL: tarnished bronze
    (1, 2): ('eae0c4', 'a39a80', '3f392e'),   # SILVER: bone
    (1, 14): ('f3ead2', 'cbbd9f', '5a5040'),  # WHITE: warm
    (1, 15): ('342c26', '1d1814', '0c0a08'),  # BLACK: tauren
}


img = Image.open(SRC).convert('RGB')
px = img.load()
lum = lambda c: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
lerp = lambda a, b, k: tuple(a[i] + (b[i] - a[i]) * k for i in range(3))
for (r, c), stops in TARGET.items():
    x0, y0 = c * 64, r * 512
    ref = [px[x0 + 32, y0 + y] for y in range(GRAD_H)]
    lt, lm, lb = lum(ref[2]), lum(ref[GRAD_H // 2]), lum(ref[GRAD_H - 6])
    t, m, b = (hexc(s) for s in stops)
    lut = []
    for y in range(GRAD_H):
        L = lum(ref[y])
        u = 0.5 * (lt - L) / max(lt - lm, 1e-3) if L >= lm else 0.5 + 0.5 * (lm - L) / max(lm - lb, 1e-3)
        u = min(max(u, 0), 1)
        col = lerp(t, m, u / 0.5) if u <= 0.5 else lerp(m, b, (u - 0.5) / 0.5)
        lut.append(tuple(int(v + 0.5) for v in col))
    for y in range(GRAD_H):
        for x in range(x0, x0 + 64):
            px[x, y0 + y] = lut[y]
img.save(DST)
print('saved', DST)
