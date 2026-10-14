# Bakes the tinted UI sprites: white sprites of the Layer Lab casual GUI pack (public/assets/ui/w-*.png)
# multiplied by a colour per role, the way Unity tints them -> public/assets/ui/t-<role>.png (used by src/skin.css).
# Change a colour here and rerun: python tools/tint-ui.py
# 9-sliced sprites also get their centre widened to CENTER px: the pack's sprites stretch a 1-2px strip, which some
# browsers sample badly (only the frame edges of the window showed up, the fill stayed transparent).
from pathlib import Path
from PIL import Image, ImageChops

UI = Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'ui'

ROLES = {
    # role: (white sprite, colour)
    'panel': ('w-popup', '#b77b45'),     # windows, inventory sheet, item card, stats window
    'pill': ('w-label', '#5c3a21'),      # labels and wells inside windows
    'btn': ('w-btn', '#d9822b'),         # regular button
    'primary': ('w-btn', '#ffc21a'),     # main action
    'danger': ('w-btn', '#f04848'),      # close / unequip / reset
    'info': ('w-chip', '#3d9df0'),       # "i" button of the stats panel
    'round': ('w-circle', '#5c3a21'),    # settings, hero rotation
    'hex': ('w-hex', '#d9822b'),         # inventory button
}

# flat plates: the plain rounded rect (BasicFrame_Round20) filled with a colour and outlined with a darker one
PLATES = {
    # role: (fill, outline)
    'empty': ('#5e3c22', '#462a16'),     # empty item slot
    'r0': ('#b8b0a4', '#7a7166'),        # item rarities: common .. mythic
    'r1': ('#4cc85a', '#2b8a3a'),
    'r2': ('#3d9df0', '#2163ad'),
    'r3': ('#a656ef', '#6c2fb0'),
    'r4': ('#ffb12c', '#c27812'),
    'r5': ('#e83a3a', '#9e1f24'),
    'tab': ('#e8a476', '#a8653a'),       # bag filter
    'tab-on': ('#ffd23f', '#c98a12'),    # selected bag filter
}
OUTLINE = 5  # px of the 66px plate (border-image-slice 25)

# border-image-slice of each 9-sliced sprite in src/skin.css: left, top, right, bottom (unchanged by the widening)
SLICE = {
    'w-popup': (28, 26, 28, 39),
    'w-btn': (31, 29, 31, 144),
    'w-square': (26, 26, 26, 27),
    'w-chip': (32, 30, 32, 46),
    'w-label': (19, 33, 19, 33),
    'w-round': (25, 25, 25, 25),
}
CENTER = 16


def widen(im, l, t, r, b):
    """Stretch the centre row/column of a 9-slice sprite to CENTER px; corners keep their size."""
    w, h = im.size
    cw, ch = max(CENTER, w - l - r), max(CENTER, h - t - b)
    # a sprite whose borders meet (no centre at all) repeats the last row/column of its top/left border
    xs = [(0, l, l), (min(l, w - r - 1), w - r, cw), (w - r, w, r)]
    ys = [(0, t, t), (min(t, h - b - 1), h - b, ch), (h - b, h, b)]
    out = Image.new('RGBA', (l + cw + r, t + ch + b))
    oy = 0
    for y0, y1, nh in ys:
        ox = 0
        for x0, x1, nw in xs:
            if nw and nh:
                out.paste(im.crop((x0, y0, x1, y1)).resize((nw, nh), Image.NEAREST), (ox, oy))
            ox += nw
        oy += nh
    return out


def tint(im, colour):
    out = ImageChops.multiply(im.convert('RGB'), Image.new('RGB', im.size, colour))
    out.putalpha(im.getchannel('A'))
    return out


def load(sprite):
    im = Image.open(UI / f'{sprite}.png').convert('RGBA')
    return widen(im, *SLICE[sprite]) if sprite in SLICE else im


for role, (sprite, colour) in ROLES.items():
    tint(load(sprite), colour).save(UI / f't-{role}.png', optimize=True)
    print(role, sprite, colour)

plate = load('w-round')
w, h = plate.size
inner = plate.resize((w - 2 * OUTLINE, h - 2 * OUTLINE), Image.LANCZOS)
for role, (fill, outline) in PLATES.items():
    im = tint(plate, outline)
    im.alpha_composite(tint(inner, fill), (OUTLINE, OUTLINE))
    im.save(UI / f't-{role}.png', optimize=True)
    print(role, 'plate', fill, outline)
