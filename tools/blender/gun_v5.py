"""gun_common v5: the v4 dwarven-rifle body (Art/Source/gun_src_v4.py, bell muzzle, hooked stock, 142 cm) rebuilt as round /
bevelled low-poly sections that follow the v4 mesh, plus a minimum of v3's detail pieces (lock plate + hammer + frizzen,
trigger guard, two barrel bands) and four cloth wraps fitted to the stock neck.

Gear space (like v3/v4): centimetres, Blender +Z long (muzzle +Z, exported glTF +Y), "up" is Blender -Y (glTF +Z), lock
side +X, wrist at the origin. Body numbers below were read off the v4 mesh (Blender coordinates, y down).

blender -b --factory-startup --python-exit-code 1 -P tools/blender/gun_v5.py -- [preview_dir]
Output: Art/Source/gun_common.blend, public/assets/models/gun_common.glb (+ PNG renders in preview_dir when given).
"""
import importlib.util
import math
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + ".py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


src = load("gun_src")   # render / export / vs_axe / scene helpers and the shared paths
g3 = load("gun")        # v3 Gun builder: loft, prism, box, solid, solid_multi
PARTS = g3.PARTS
PREVIEW_DIR = src.PREVIEW_DIR
SEG = 10


class Body(g3.Gun):
    def finish(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for n in PARTS:
            me.materials.append(src.material(n))
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob

    def ring(self, z, cy, r, seg=SEG):
        return [self.v((r * math.cos(2 * math.pi * (i + 0.5) / seg), cy + r * math.sin(2 * math.pi * (i + 0.5) / seg), z))
                for i in range(seg)]

    def rect(self, z, hw, y0, y1, ch):
        pts = [(hw - ch, y0), (hw, y0 + ch), (hw, y1 - ch), (hw - ch, y1), (-hw + ch, y1), (-hw, y1 - ch), (-hw, y0 + ch), (-hw + ch, y0)]
        return [self.v((x, y, z)) for x, y in pts]


# stock centre line: (z, y) of the section centre, half thickness along the line's normal, half width
PATH = [
    ((10.0, -0.5), 9.8, 7.0),
    ((2.0, 1.5), 7.8, 6.0),
    ((-8.0, 3.0), 6.6, 5.8),
    ((-16.0, 4.5), 6.5, 6.0),
    ((-23.0, 8.5), 7.0, 7.5),
    ((-27.5, 15.5), 7.8, 9.5),
    ((-28.8, 23.0), 7.3, 9.0),
    ((-29.6, 26.5), 6.3, 8.0),
]
NORM = [(0.78, 1), (1, 0.78), (1, -0.78), (0.78, -1), (-0.78, -1), (-1, -0.78), (-1, 0.78), (-0.78, 1)]


def tangent(i):
    a = PATH[max(i - 1, 0)][0]
    b = PATH[min(i + 1, len(PATH) - 1)][0]
    t = Vector((b[0] - a[0], b[1] - a[1])).normalized()
    return t


def at(s):
    """Interpolated (centre, normal, half, width) at path parameter s (ring i sits at s = i)."""
    i = max(0, min(len(PATH) - 2, int(math.floor(s))))
    f = s - i
    lerp = lambda a, b: a + (b - a) * f
    (p0, h0, w0), (p1, h1, w1) = PATH[i], PATH[i + 1]
    c = Vector((lerp(p0[0], p1[0]), lerp(p0[1], p1[1])))
    t = (tangent(i) * (1 - f) + tangent(i + 1) * f).normalized()
    return c, Vector((-t.y, t.x)), lerp(h0, h1), lerp(w0, w1)


def stock_ring(g, s, scale=1.0, add=0.0, tilt=0.0):
    out = []
    for xn, tn in NORM:
        c, n, half, w = at(max(0.0, min(len(PATH) - 1.001, s + tilt * tn)))
        p = c + n * tn * (half * scale + add)
        out.append(g.v((xn * (w * scale + add), p.y, p.x)))
    return out


def build():
    g = Body()

    # barrel: 10-sided, its centre sinks a little toward the muzzle like the source
    g.loft([g.ring(12, -3.2, 5.5), g.ring(44, -1.9, 5.5), g.ring(76, -0.6, 5.5)], "gun_steel")

    # bell muzzle: concave flare, hollow, with a bevelled rim and a dark bore
    outer = [(76, 5.5, -0.6), (82, 6.3, -0.4), (88, 7.7, -0.1), (94, 9.7, 0.2), (99.5, 11.7, 0.4), (104.2, 13.0, 0.5), (105.4, 12.0, 0.5)]
    bore = [(105.4, 10.8, 0.5), (99.5, 10.0, 0.4), (94, 8.0, 0.2), (88, 6.0, -0.1), (84, 4.4, -0.3)]
    O = [g.ring(z, cy, r) for z, r, cy in outer]
    B = [g.ring(z, cy, r) for z, r, cy in bore]
    steel, trim, dark = [], [], []
    for k, (r0, r1) in enumerate(zip(O, O[1:])):
        (trim if k == len(O) - 2 else steel).extend(g.bm.faces.new([r0[i], r0[(i + 1) % SEG], r1[(i + 1) % SEG], r1[i]]) for i in range(SEG))
    for r0, r1 in zip(B, B[1:]):
        dark.extend(g.bm.faces.new([r0[i], r0[(i + 1) % SEG], r1[(i + 1) % SEG], r1[i]]) for i in range(SEG))
    trim.extend(g.bm.faces.new([O[-1][i], O[-1][(i + 1) % SEG], B[0][(i + 1) % SEG], B[0][i]]) for i in range(SEG))
    steel.append(g.bm.faces.new(list(reversed(O[0]))))
    dark.append(g.bm.faces.new(B[-1]))
    g.solid_multi([(steel, "gun_steel"), (trim, "gun_trim"), (dark, "gun_bore")])

    # two steel bands on the barrel
    for zb in (30.0, 58.0):
        cy = -3.2 + (zb - 12) / 64 * 2.6
        g.loft([g.ring(zb - 1.6, cy, 6.3), g.ring(zb + 1.6, cy, 6.3)], "gun_trim")

    # forestock slab (bevelled), then the stock along its bent centre line: neck, bend, hooked butt
    g.loft([g.rect(76, 7.8, -1.0, 9.0, 2.2), g.rect(44, 7.8, -1.0, 8.4, 2.2), g.rect(8, 7.2, -1.0, 7.6, 2.2)], "gun_wood")
    g.loft([stock_ring(g, i) for i in range(7)], "gun_wood")
    # steel butt shoe: wraps the end of the stock, rounded at the back
    g.loft([stock_ring(g, 5.45, 1.04, 0.45), stock_ring(g, 6.0, 1.04, 0.45), stock_ring(g, 6.55, 1.0, 0.1)], "gun_steel")

    # lock plate and hammer on +X, frizzen and pan (v3 pieces, moved onto the v4 body)
    g.prism([(1.0, -3.6), (16.5, -3.2), (19.5, 0.8), (17.5, 5.8), (8.0, 6.4), (1.5, 3.2)], 6.9, 8.6, "gun_steel")
    g.prism([(2.0, 6.0), (5.6, 6.0), (6.3, 9.0), (8.8, 11.4), (8.2, 13.2), (4.8, 12.6), (3.0, 9.4)], 6.9, 9.0, "gun_trim")
    g.prism([(18.5, 4.0), (22.0, 4.0), (21.4, 10.0), (19.2, 10.0)], 6.4, 8.0, "gun_trim")
    g.box((5.8, 3.4, 15.5), (8.0, 5.2, 19.0), "gun_trim")

    # trigger guard (angular loop below the lock) and trigger
    outer_g = [(21.5, -6.4), (17.5, -21.0), (-1.0, -21.0), (-6.0, -10.2)]
    inner_g = [(19.0, -7.6), (15.8, -18.8), (1.0, -18.8), (-4.0, -10.4)]
    g.prism(outer_g + list(reversed(inner_g)), -1.1, 1.1, "gun_steel")
    g.prism([(6.0, -8.0), (9.8, -8.0), (7.0, -14.5)], -0.55, 0.55, "gun_trim")

    # four cloth wraps wound diagonally over the stock neck, fitted to the centre line and slightly bulged
    for n, s0 in enumerate((1.3, 1.75, 2.2, 2.65)):
        sc, ad = (1.05, 0.55) if n % 2 == 0 else (1.02, 0.25)
        rings = []
        for ds, bulge in ((-0.3, 0.0), (0.0, 0.18), (0.3, 0.0)):
            rings.append(stock_ring(g, s0 + ds, sc, ad + bulge, tilt=0.22))
        g.loft(rings, "gun_cloth")

    return g.finish("gun_common")


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    gun = build()
    zs = [v.co.z for v in gun.data.vertices]
    print("dims", tuple(round(x, 1) for x in gun.dimensions), "z", round(min(zs), 1), round(max(zs), 1),
          "tris", sum(len(p.vertices) - 2 for p in gun.data.polygons))
    src.export(gun)
    bpy.ops.wm.save_as_mainfile(filepath=src.BLEND)
    if PREVIEW_DIR:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        src.configure_scene()
        for m in gun.data.materials:
            m.use_backface_culling = True
        src.render(os.path.join(PREVIEW_DIR, "gun_side.png"), (1, 0, 0), 170, lit=True)
        src.render(os.path.join(PREVIEW_DIR, "gun_side_other.png"), (-1, 0, 0), 170, lit=True)
        src.render(os.path.join(PREVIEW_DIR, "gun_3q.png"), (1.2, -0.7, 0.55), 170, lit=True)
        src.vs_axe(gun, os.path.join(PREVIEW_DIR, "gun_vs_axe.png"))
        for m in gun.data.materials:
            m.use_backface_culling = False
        bpy.ops.wm.save_as_mainfile(filepath=src.BLEND)


if __name__ == "__main__":
    main()
