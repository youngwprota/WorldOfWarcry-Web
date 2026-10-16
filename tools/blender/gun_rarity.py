"""Rarity variants of the v5 gun (tools/blender/gun_v5.py): gun_{uncommon,rare,epic,legendary,mythic}.glb.

Same body, 142 cm, orientation and origin as gun_common.glb (which this script never writes). Cumulative per tier:
  uncommon  accent-metal barrel bands + butt shoe, a small glowing gem on the lock plate
  rare      + raised stock/forestock inlay ribbons in accent metal (zig-zag stepped, hooked curls) + rivets
  epic      + spiral of light blade spikes along the barrel, blade fins on the butt shoe and the bell rim
  legendary + bigger/more spikes, a crown of blades round the bell mouth, gold hammer/guard/inlay, stronger gem
  mythic    dark red/black metal, red glowing gem and bore, floating crystals (gem material, like the mythic shields)

Palette and glow follow tools/blender/rarity_gear.py: ACCENT/GEM/STEEL/GOLD values, emission = Principled "Emission Color"
(linear of the gem colour) + "Emission Strength" (GEM strength), which the glTF exporter writes as emissiveFactor +
KHR_materials_emissive_strength; assets.loadGear's lambert() copies emissive/emissiveIntensity, so no `_glow` suffix is
needed (that suffix is only for vertex-colour glow on armour). Material names are per tier (`gun_<tier>_<role>`) because
the gear material cache is keyed by name.

blender -b --factory-startup --python-exit-code 1 -P tools/blender/gun_rarity.py -- [preview_dir]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gun_v5 as v5  # noqa: E402  (loads gun_src and gun as helpers)

src, g3 = v5.src, v5.g3
ROLES = ["gun_wood", "gun_steel", "gun_trim", "gun_cloth", "gun_bore", "gun_accent", "gun_gem"]
g3.PARTS[:] = ROLES  # Gun.solid() resolves part names through this list
PREVIEW_DIR = src.PREVIEW_DIR
MODELS = os.path.join(src.REPO, "public", "assets", "models")
TIERS = ["uncommon", "rare", "epic", "legendary", "mythic"]

PALETTE = {  # sRGB display colours
    "uncommon": dict(wood=(0.29, 0.18, 0.09), steel=(0.46, 0.51, 0.58), trim=(0.62, 0.68, 0.76), cloth=(0.46, 0.46, 0.37),
                     accent=(0.35, 0.60, 0.38), gem=((0.15, 0.85, 0.20), 1.2)),
    "rare": dict(wood=(0.26, 0.17, 0.10), steel=(0.46, 0.52, 0.62), trim=(0.64, 0.70, 0.80), cloth=(0.42, 0.44, 0.46),
                 accent=(0.35, 0.50, 0.85), gem=((0.10, 0.40, 1.00), 1.6)),
    "epic": dict(wood=(0.22, 0.14, 0.12), steel=(0.46, 0.50, 0.62), trim=(0.70, 0.74, 0.86), cloth=(0.42, 0.38, 0.48),
                 accent=(0.42, 0.22, 0.70), gem=((0.60, 0.15, 1.00), 2.0)),
    "legendary": dict(wood=(0.27, 0.15, 0.06), steel=(0.50, 0.53, 0.60), trim=(0.82, 0.78, 0.66), cloth=(0.55, 0.46, 0.30),
                      accent=(1.00, 0.70, 0.20), gem=((1.00, 0.72, 0.12), 2.4)),
    "mythic": dict(wood=(0.09, 0.05, 0.05), steel=(0.12, 0.12, 0.15), trim=(0.35, 0.40, 0.49), cloth=(0.17, 0.10, 0.11),
                   accent=(0.30, 0.03, 0.05), gem=((1.00, 0.06, 0.08), 3.0)),
}
BORE = (0.05, 0.035, 0.03)


def make_material(tier, role):
    pal = PALETTE[tier]
    key = role.replace("gun_", "")
    m = bpy.data.materials.new(f"gun_{tier}_{key}")
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    color = BORE if key == "bore" else (pal["gem"][0] if key == "gem" else pal[key])
    bsdf.inputs["Base Color"].default_value = (*src.lin(color), 1)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.4 if key in ("accent", "trim") else (0.15 if key == "gem" else 0.8)
    if key == "gem":
        bsdf.inputs["Emission Color"].default_value = (*src.lin(pal["gem"][0]), 1)
        bsdf.inputs["Emission Strength"].default_value = pal["gem"][1]
    m.diffuse_color = (*src.lin(color), 1)
    return m


class TierBody(v5.Body):
    tier = "uncommon"

    def finish(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for role in ROLES:
            me.materials.append(make_material(self.tier, role))
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob

    def fin(self, origin, T, O, poly, thick, part):
        """Flat blade: a (t, o) polygon in the plane spanned by T and O, `thick` wide along T x O."""
        L = T.cross(O).normalized()
        lo = [self.v(Vector(origin) + T * t + O * o - L * thick / 2) for t, o in poly]
        hi = [self.v(Vector(origin) + T * t + O * o + L * thick / 2) for t, o in poly]
        n = len(poly)
        faces = [self.bm.faces.new([lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]]) for i in range(n)]
        faces.append(self.bm.faces.new(list(reversed(lo))))
        faces.append(self.bm.faces.new(hi))
        self.solid(faces, part)

    def gem(self, at, r, depth, part="gun_gem", seg=6):
        """Faceted cabochon on the +X face of the lock plate: ring in the YZ plane, tip pointing +X."""
        ring = [self.v((at[0], at[1] + r * math.sin(2 * math.pi * i / seg), at[2] + r * math.cos(2 * math.pi * i / seg))) for i in range(seg)]
        tip = self.v((at[0] + depth, at[1], at[2]))
        back = self.v((at[0] - 0.3, at[1], at[2]))
        faces = [self.bm.faces.new([tip, ring[(i + 1) % seg], ring[i]]) for i in range(seg)]
        faces += [self.bm.faces.new([back, ring[i], ring[(i + 1) % seg]]) for i in range(seg)]
        self.solid(faces, part)

    def crystal(self, c, h, r, tilt, part="gun_gem"):
        axis = Vector((math.sin(tilt), 0, math.cos(tilt)))
        side = Vector((math.cos(tilt), 0, -math.sin(tilt)))
        c = Vector(c)
        ring = [self.v(c + r * (math.cos(a) * side + math.sin(a) * Vector((0, 1, 0)))) for a in (0, math.pi / 2, math.pi, 1.5 * math.pi)]
        top, bot = self.v(c + axis * h), self.v(c - axis * h * 0.6)
        faces = [self.bm.faces.new([top, ring[(i + 1) % 4], ring[i]]) for i in range(4)]
        faces += [self.bm.faces.new([bot, ring[i], ring[(i + 1) % 4]]) for i in range(4)]
        self.solid(faces, part)

    def ribbon(self, pts, widths, side, part, lift=0.9):
        """Raised flat ribbon along a polyline of surface points (3D, on the side face, outward = +-X)."""
        O = Vector((side, 0, 0))
        n = len(pts)
        rings = []
        for k in range(n):
            a = (pts[k] - pts[max(k - 1, 0)]).normalized() if k > 0 else None
            b = (pts[min(k + 1, n - 1)] - pts[k]).normalized() if k < n - 1 else None
            T = ((a + b) if a and b else (a or b)).normalized()
            miter = 1.0
            if a and b:
                miter = min(1.8, 1.0 / max(0.55, math.sqrt(max(0.0, (1 + a.dot(b)) / 2))))
            Lv = O.cross(T).normalized() * widths[k] * 0.5 * miter * 1.5
            p = pts[k]
            rings.append([self.v(p - Lv - O * 0.3), self.v(p - Lv * 0.7 + O * lift), self.v(p + Lv * 0.7 + O * lift), self.v(p + Lv - O * 0.3)])
        self.loft(rings, part)


def stock_surf(s, tn, side, lift=0.0):
    c, nrm, half, w = v5.at(s)
    p = c + nrm * (tn * half)
    return Vector((side * (w + lift), p.y, p.x))


FORE = [(76, 7.8, -1.0, 9.0), (44, 7.8, -1.0, 8.4), (8, 7.2, -1.0, 7.6)]


def fore_surf(z, v, side):
    """Forestock side face; v = 0 top .. 1 bottom."""
    for (z0, hw0, a0, b0), (z1, hw1, a1, b1) in zip(FORE, FORE[1:]):
        if z1 <= z <= z0:
            t = (z0 - z) / (z0 - z1)
            hw, a, b = hw0 + (hw1 - hw0) * t, a0 + (a1 - a0) * t, b0 + (b1 - b0) * t
            return Vector((side * hw, a + (b - a) * v, z))
    return Vector((side * 7.8, -1.0 + 10.0 * v, z))


def spiral(c, r0, r1, turns, steps, a0=0.0):
    out = []
    for i in range(steps + 1):
        t = i / steps
        a = a0 + 2 * math.pi * turns * t
        r = r0 + (r1 - r0) * t
        out.append((c[0] + r * math.cos(a), c[1] + r * math.sin(a)))
    return out


def barrel_cy(z):
    return -3.2 + (z - 12) / 64 * 2.6 if z <= 76 else -0.6


def build_tier(tier):
    k = TIERS.index(tier)  # 0 uncommon .. 4 mythic
    g = TierBody()
    g.tier = tier
    accent_bands = "gun_accent"
    bore_part = "gun_gem" if tier == "mythic" else "gun_bore"
    hammer_part = "gun_accent" if k >= 3 else "gun_trim"
    guard_part = "gun_accent" if k >= 3 else "gun_steel"

    # ---- v5 body ------------------------------------------------------------------------------------------------
    g.loft([g.ring(12, -3.2, 5.5), g.ring(44, -1.9, 5.5), g.ring(76, -0.6, 5.5)], "gun_steel")
    outer = [(76, 5.5, -0.6), (82, 6.3, -0.4), (88, 7.7, -0.1), (94, 9.7, 0.2), (99.5, 11.7, 0.4), (104.2, 13.0, 0.5), (105.4, 12.0, 0.5)]
    bore = [(105.4, 10.8, 0.5), (99.5, 10.0, 0.4), (94, 8.0, 0.2), (88, 6.0, -0.1), (84, 4.4, -0.3)]
    O = [g.ring(z, cy, r) for z, r, cy in outer]
    B = [g.ring(z, cy, r) for z, r, cy in bore]
    S = v5.SEG
    steel, trim, dark = [], [], []
    for i2, (r0, r1) in enumerate(zip(O, O[1:])):
        (trim if i2 == len(O) - 2 else steel).extend(g.bm.faces.new([r0[i], r0[(i + 1) % S], r1[(i + 1) % S], r1[i]]) for i in range(S))
    for r0, r1 in zip(B, B[1:]):
        dark.extend(g.bm.faces.new([r0[i], r0[(i + 1) % S], r1[(i + 1) % S], r1[i]]) for i in range(S))
    trim.extend(g.bm.faces.new([O[-1][i], O[-1][(i + 1) % S], B[0][(i + 1) % S], B[0][i]]) for i in range(S))
    steel.append(g.bm.faces.new(list(reversed(O[0]))))
    dark.append(g.bm.faces.new(B[-1]))
    g.solid_multi([(steel, "gun_steel"), (trim, "gun_trim"), (dark, bore_part)])

    for zb in (30.0, 58.0):
        cy = barrel_cy(zb)
        g.loft([g.ring(zb - 1.6, cy, 6.3), g.ring(zb + 1.6, cy, 6.3)], accent_bands)

    g.loft([g.rect(z, hw, a, b, 2.2) for z, hw, a, b in FORE], "gun_wood")
    g.loft([v5.stock_ring(g, i) for i in range(7)], "gun_wood")
    g.loft([v5.stock_ring(g, 5.45, 1.04, 0.45), v5.stock_ring(g, 6.0, 1.04, 0.45), v5.stock_ring(g, 6.55, 1.0, 0.1)], "gun_accent")

    g.prism([(1.0, -3.6), (16.5, -3.2), (19.5, 0.8), (17.5, 5.8), (8.0, 6.4), (1.5, 3.2)], 6.9, 8.6, "gun_steel")
    g.prism([(2.0, 6.0), (5.6, 6.0), (6.3, 9.0), (8.8, 11.4), (8.2, 13.2), (4.8, 12.6), (3.0, 9.4)], 6.9, 9.0, hammer_part)
    g.prism([(18.5, 4.0), (22.0, 4.0), (21.4, 10.0), (19.2, 10.0)], 6.4, 8.0, "gun_trim")
    g.box((5.8, 3.4, 15.5), (8.0, 5.2, 19.0), "gun_trim")

    outer_g = [(21.5, -6.4), (17.5, -21.0), (-1.0, -21.0), (-6.0, -10.2)]
    inner_g = [(19.0, -7.6), (15.8, -18.8), (1.0, -18.8), (-4.0, -10.4)]
    g.prism(outer_g + list(reversed(inner_g)), -1.1, 1.1, guard_part)
    g.prism([(6.0, -8.0), (9.8, -8.0), (7.0, -14.5)], -0.55, 0.55, "gun_trim")

    for n, s0 in enumerate((1.3, 1.75, 2.2, 2.65)):
        sc, ad = (1.05, 0.55) if n % 2 == 0 else (1.02, 0.25)
        g.loft([v5.stock_ring(g, s0 + ds, sc, ad + bulge, tilt=0.22) for ds, bulge in ((-0.3, 0.0), (0.0, 0.18), (0.3, 0.0))], "gun_cloth")

    # ---- uncommon+: gem on the lock plate -----------------------------------------------------------------------
    gem_r = (1.5, 1.8, 2.1, 2.6, 2.6)[k]
    g.gem((8.6, -1.6, 12.5), gem_r, 0.5 + gem_r * 0.4)

    inlay = "gun_gem" if tier == "mythic" else "gun_accent"
    # ---- rare+: inlay ribbons on stock and forestock, rivets ----------------------------------------------------
    if k >= 1:
        zig = [(0.55, 0.55), (1.0, 0.62), (1.15, 0.30), (1.7, 0.42), (1.9, 0.05), (2.5, 0.22), (2.7, -0.18), (3.3, 0.0),
               (3.6, -0.35), (4.1, -0.2), (4.5, -0.5), (5.0, -0.1), (5.4, -0.5)]
        zw = [1.5, 1.7, 1.7, 1.8, 1.8, 1.8, 1.8, 1.8, 1.7, 1.6, 1.5, 1.2, 0.5]
        curl = [(3.7, 0.78), (4.2, 0.68)] + [(0.0, 0.0)] * 0
        sp = spiral((4.75, 0.45), 0.34, 0.09, 1.35, 7, a0=-1.2)
        curl_pts = [(3.7, 0.8), (4.2, 0.74)] + sp
        curl_w = [1.5, 1.5] + [1.4 - 0.9 * i / 7 for i in range(8)]
        neck = spiral((1.55, -0.45), 0.3, 0.08, 1.2, 6, a0=0.5)
        neck_w = [1.4 - 0.8 * i / 6 for i in range(7)]
        fore_pts = [(14, 6.4), (22, 5.0), (26, 6.4), (36, 4.7), (42, 6.0), (52, 4.2), (58, 5.6), (66, 4.0)]
        fore_w = [1.5, 1.7, 1.7, 1.8, 1.8, 1.8, 1.7, 1.4]
        hook = spiral((69.5, 5.2), 2.0, 0.6, 1.3, 7, a0=-1.0)
        fore_pts2 = fore_pts + [(66.8, 4.4)] + [(a, b) for a, b in hook]
        fore_w2 = fore_w + [1.3] + [1.3 - 0.8 * i / 7 for i in range(8)]
        for side in (1, -1):
            g.ribbon([stock_surf(s, tn, side) for s, tn in zig], zw, side, inlay)
            g.ribbon([stock_surf(s, tn, side) for s, tn in curl_pts], curl_w, side, inlay)
            g.ribbon([stock_surf(s, tn, side) for s, tn in neck], neck_w, side, inlay)
            g.ribbon([fore_surf(z, (y + 1.0) / 10.0, side) for z, y in fore_pts2], fore_w2, side, inlay)
        for zr, up in ((5.5, -1.3), (17.5, -1.3), (11.0, 4.6)):
            g.box((8.6, -up - 0.8, zr - 0.8), (9.5, -up + 0.8, zr + 0.8), "gun_accent")

    # ---- epic+: blade spikes spiralling along the barrel, fins on the butt shoe and the bell rim -----------------
    if k >= 2:
        n_sp, L, H = ((6, 8.5, 6.0), (9, 10.0, 8.0), (11, 11.0, 9.0))[min(k - 2, 2)]
        for i in range(n_sp):
            t = i / (n_sp - 1)
            z = 22 + 46 * t
            a = -math.pi / 2 + 2 * math.pi * 2.5 * t
            o = Vector((math.cos(a), math.sin(a), 0))
            size = 1.0 if (k == 2 or i % 2 == 0) else 0.75
            org = Vector((0, barrel_cy(z), z)) + o * 4.6
            poly = [(-0.5 * L * size, -0.8), (0.5 * L * size, -0.8), (0.25 * L * size, 0.45 * H * size),
                    (0.8 * L * size, H * size), (-0.1 * L * size, 0.6 * H * size)]
            g.fin(org, Vector((0, 0, 1)), o, poly, 1.9, "gun_trim" if k < 4 else "gun_accent")
        # blades on the heel of the butt shoe, sweeping back and down
        c, nrm, half, w = v5.at(6.0)
        tg = v5.tangent(6)
        Tv = Vector((0, tg.y, tg.x)).normalized()
        Nv = Vector((0, nrm.y, nrm.x)).normalized()
        for xs in (5.0, -5.0):
            org = Vector((xs, c.y, c.x)) + Nv * half * 1.04
            g.fin(org, Tv, Nv, [(-3.0, -0.6), (3.5, -0.6), (1.5, 1.0), (7.0 + k, 2.0 + 0.2 * k), (-2.5, 1.6)], 1.6, "gun_accent")
        # fins around the bell rim
        fs = 0.8 + 0.1 * (k - 2)
        for i in range(S):
            a = 2 * math.pi * (i + 0.5) / S
            o = Vector((math.cos(a), math.sin(a), 0))
            org = Vector((0, 0.5, 102.2)) + o * 11.6
            g.fin(org, Vector((0, 0, 1)), o, [(-3.0 * fs, -0.8), (1.2 * fs, -0.8), (3.2 * fs, 3.4 * fs), (-0.5 * fs, 2.2 * fs)], 1.4, "gun_accent")

    # ---- legendary+: crown of blades rising round the bell mouth ------------------------------------------------
    if k >= 3:
        cs = 1.0 if k == 3 else 1.2
        for i in range(S):
            a = 2 * math.pi * i / S
            o = Vector((math.cos(a), math.sin(a), 0))
            org = Vector((0, 0.5, 102.4)) + o * 11.0
            g.fin(org, Vector((0, 0, 1)), o, [(-3.8 * cs, -0.8), (1.0 * cs, -0.8), (3.0 * cs, 7.2 * cs), (-1.2 * cs, 4.2 * cs)], 1.7, "gun_accent")

    # ---- floating diamond crystals (gem material): legendary two, mythic five small + five big ------------------
    if tier == "legendary":
        for c, h, r, tilt in (((17, -16, 84), 6.0, 2.2, 0.3), ((-18, -10, 40), 5.5, 2.0, -0.3)):
            g.crystal(c, h, r, tilt)
    if k >= 4:
        for c, h, r, tilt in (((17, -12, 92), 5.5, 1.9, 0.3), ((-18, -4, 66), 5.0, 1.8, -0.35), ((13, -22, 30), 4.6, 1.7, 0.25),
                              ((-15, -18, -6), 4.8, 1.8, -0.2), ((20, 4, 96), 4.2, 1.5, 0.4)):
            g.crystal(c, h, r, tilt)
        for c, h, r, tilt in (((-23, -22, 98), 10.5, 4.0, 0.25), ((25, -6, 58), 11.5, 4.4, -0.3), ((-26, 4, 22), 9.5, 3.8, 0.35),
                              ((8, -36, 70), 10.0, 4.0, -0.2), ((23, 12, -8), 9.5, 3.8, 0.3)):
            g.crystal(c, h, r, tilt)

    return g.finish(f"gun_{tier}")


def export_tier(ob, tier):
    path = os.path.join(MODELS, f"gun_{tier}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                              export_image_format="NONE", export_materials="EXPORT", export_vertex_color="NONE",
                              export_normals=True, export_animations=False)
    return path


def main():
    out = {}
    built = {}
    for tier in TIERS:
        for o in list(bpy.data.objects):
            bpy.data.objects.remove(o, do_unlink=True)
        ob = build_tier(tier)
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        zs = [v.co.z for v in ob.data.vertices]
        path = export_tier(ob, tier)
        print(f"{tier}: tris {tris} dims {tuple(round(x, 1) for x in ob.dimensions)} z {min(zs):.1f}..{max(zs):.1f} "
              f"mats {[m.name for m in ob.data.materials]} -> {os.path.getsize(path)} B")
        out[tier] = tris
        if PREVIEW_DIR:
            os.makedirs(PREVIEW_DIR, exist_ok=True)
            src.configure_scene()
            for m in ob.data.materials:
                m.use_backface_culling = True
            src.render(os.path.join(PREVIEW_DIR, f"gun_{tier}_3q.png"), (1.2, -0.7, 0.55), 190, ctr=(0, -2, 38), lit=True)
            for m in ob.data.materials:
                m.use_backface_culling = False
        built[tier] = ob
    if PREVIEW_DIR:
        lineup(built)


def lineup(built):
    """All six tiers (common imported from its GLB) in a 2 x 3 grid, side view."""
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    objs = []
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, "gun_common.glb"))
    objs.append([o for o in bpy.data.objects if o not in before])
    for tier in TIERS:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(MODELS, f"gun_{tier}.glb"))
        objs.append([o for o in bpy.data.objects if o not in before])
    for i, group in enumerate(objs):
        col, row = divmod(i, 3)
        for o in group:
            if o.parent is None:
                o.location = (0, 62 * row, 190 * col)
    src.configure_scene()
    src.render(os.path.join(PREVIEW_DIR, "gun_tiers.png"), (1, 0, 0), 400, ctr=(0, 62, 130), res=(2000, 1000), lit=True)


if __name__ == "__main__":
    main()
