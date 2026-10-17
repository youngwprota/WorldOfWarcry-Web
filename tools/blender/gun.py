"""Common-rarity flintlock rifle ("gun"), built procedurally in the style of the per-quality gear GLBs.

Centimetres, long axis along Blender +Z (exported as glTF +Y), the stock's wrist (the grip) at the origin, butt shoe at
z = -32, muzzle at z = +110 (142 cm, like axe_uncommon). v1 (thin musket, 162 cm) is backed up in Art/Source/gun_v1.py. The sight side ("up") is Blender -Y, which is glTF +Z; the lock plate is on +X. Flat colour
materials (no textures, no emission): game assets.lambert() turns them into flat-shaded Lambert by material name, so the
names are unique to the gun: gun_wood, gun_steel, gun_trim, gun_cloth, gun_bore (dark muzzle bore). v3: 30% thicker (THICK), hollow muzzle, one stepped band.

blender -b --factory-startup --python-exit-code 1 -P tools/blender/gun.py -- [preview_dir]
Output: Art/Source/gun_common.blend, public/assets/models/gun_common.glb (+ PNG renders in preview_dir when given).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW_DIR = ARGS[0] if ARGS else None
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
GLB = os.path.join(REPO, "public", "assets", "models", "gun_common.glb")
BLEND = os.path.join(REPO, "Art", "Source", "gun_common.blend")

# display (sRGB) colours, like rarity_gear.py: dark-brown wood, plain grey-blue steel, dull greyish-brown cloth
COLORS = {
    "gun_wood": (0.30, 0.18, 0.09),
    "gun_steel": (0.38, 0.43, 0.51),
    "gun_trim": (0.64, 0.70, 0.78),
    "gun_cloth": (0.50, 0.45, 0.38),
    "gun_bore": (0.05, 0.035, 0.03),
}
PARTS = list(COLORS)


def lin(c):
    return tuple(x ** 2.2 for x in c)


def material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*lin(COLORS[name]), 1)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.8
    m.diffuse_color = (*lin(COLORS[name]), 1)
    return m


def P(x, up, z):
    """Gun space (x, height above the barrel axis, z along it) -> Blender (up is -Y)."""
    return (x, -up, z)


class Gun:
    def __init__(self):
        self.bm = bmesh.new()

    def v(self, co):
        return self.bm.verts.new(co)

    def solid(self, faces, part):
        """Orient one closed shell outward and tag its faces."""
        bmesh.ops.recalc_face_normals(self.bm, faces=faces)
        for f in faces:
            f.material_index = PARTS.index(part)

    def solid_multi(self, groups):
        """One closed shell whose faces carry different parts: [(faces, part), ...]."""
        bmesh.ops.recalc_face_normals(self.bm, faces=[f for fs, _ in groups for f in fs])
        for fs, part in groups:
            for f in fs:
                f.material_index = PARTS.index(part)

    def loft(self, rings, part):
        """Closed solid through equal-length closed rings (capped at both ends)."""
        faces = []
        for a, b in zip(rings, rings[1:]):
            n = len(a)
            for i in range(n):
                j = (i + 1) % n
                faces.append(self.bm.faces.new([a[i], a[j], b[j], b[i]]))
        faces.append(self.bm.faces.new(list(reversed(rings[0]))))
        faces.append(self.bm.faces.new(rings[-1]))
        self.solid(faces, part)

    def prism(self, poly, x0, x1, part):
        """A (z, up) polygon extruded between two x planes."""
        lo = [self.v(P(x0, u, z)) for z, u in poly]
        hi = [self.v(P(x1, u, z)) for z, u in poly]
        n = len(poly)
        faces = [self.bm.faces.new([lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]]) for i in range(n)]
        faces.append(self.bm.faces.new(list(reversed(lo))))
        faces.append(self.bm.faces.new(hi))
        self.solid(faces, part)

    def box(self, lo, hi, part):
        """Axis box in gun space: lo/hi are (x, up, z)."""
        (x0, u0, z0), (x1, u1, z1) = lo, hi
        v = [self.v(P(x, u, z)) for z in (z0, z1) for u in (u0, u1) for x in (x0, x1)]
        faces = [self.bm.faces.new([v[i] for i in q]) for q in
                 ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5))]
        self.solid(faces, part)

    def round_ring(self, z, r, seg=8, phase=0.5):
        return [self.v(P(r * math.cos(2 * math.pi * (i + phase) / seg), r * math.sin(2 * math.pi * (i + phase) / seg), z))
                for i in range(seg)]

    def chamfer_ring(self, z, top, bottom, w, ch):
        """Rectangle with chamfered corners, x in [-w, w], height between `bottom` and `top`."""
        pts = [(w - ch, top), (w, top - ch), (w, bottom + ch), (w - ch, bottom),
               (-w + ch, bottom), (-w, bottom + ch), (-w, top - ch), (-w + ch, top)]
        return [self.v(P(x, u, z)) for x, u in pts]

    def finish(self, name):
        for v in self.bm.verts:  # v3: every cross-section 30% thicker about the barrel axis, the length is kept
            v.co.x *= THICK
            v.co.y *= THICK
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for n in PARTS:
            me.materials.append(material(n))
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


STOCK = [  # z, top, bottom, half width: fore-end, lock, wrist, stock dropping ~21 degrees to a fish-tail butt
    (103, -0.8, -6.4, 2.9), (60, -0.8, -6.8, 3.1), (24, -0.8, -7.6, 3.3), (12, 0.5, -10.5, 3.6),
    (0, -1.8, -12.5, 3.4), (-10, -4.4, -14.3, 3.3), (-20, -8.3, -18.6, 3.4), (-27, -10.7, -21.2, 4.1),
    (-30, -12.1, -22.8, 4.4),
]
THICK = 1.3
CH = 1.0  # chamfer of the wood sections


def stock_at(z):
    """(top, bottom, half width) of the wood between sections (the loft is linear between them)."""
    for (z0, *a), (z1, *b) in zip(STOCK, STOCK[1:]):
        if z1 <= z <= z0:
            t = (z0 - z) / (z0 - z1)
            return tuple(x + (y - x) * t for x, y in zip(a, b))
    return STOCK[0][1:] if z > STOCK[0][0] else STOCK[-1][1:]


def chamfer_pts(top, bottom, w, ch):
    return [(w - ch, top), (w, top - ch), (w, bottom + ch), (w - ch, bottom),
            (-w + ch, bottom), (-w, bottom + ch), (-w, top - ch), (-w + ch, top)]


def build():
    g = Gun()
    R = 3.2  # barrel radius: thick, about half the wrist height
    Z_BREECH, Z_MUZZLE = 14.0, 110.0

    # barrel: uniform octagon, a chunky breech block at the lock
    Z_M0 = Z_MUZZLE - 8.2  # where the flare starts
    g.loft([g.round_ring(3, 4.0), g.round_ring(20, 4.0), g.round_ring(23, R), g.round_ring(Z_M0, R)], "gun_steel")

    # hollow octagonal muzzle: a short flared ring (~1.375x the barrel diameter, bevelled front edge) tapering out of the
    # barrel, with a deep open bore (rim ~15% of the ring radius) in the dark bore material
    RR = 1.375 * R
    outer = [g.round_ring(Z_M0, R), g.round_ring(Z_MUZZLE - 3.2, RR), g.round_ring(Z_MUZZLE - 0.7, RR), g.round_ring(Z_MUZZLE, RR * 0.9)]
    bore = [g.round_ring(Z_MUZZLE, RR * 0.85), g.round_ring(Z_MUZZLE - 3.2, RR * 0.8), g.round_ring(Z_M0, R - 0.65),
            g.round_ring(Z_MUZZLE - 14.0, R - 0.65)]
    steel, dark = [], []
    for rs, steel_ in ((outer, steel), (bore, dark)):
        for r0, r1 in zip(rs, rs[1:]):
            for i in range(8):
                j = (i + 1) % 8
                steel_.append(g.bm.faces.new([r0[i], r0[j], r1[j], r1[i]]))
    for i in range(8):
        j = (i + 1) % 8
        steel.append(g.bm.faces.new([outer[-1][i], outer[-1][j], bore[0][j], bore[0][i]]))
    steel.append(g.bm.faces.new(list(reversed(outer[0]))))
    dark.append(g.bm.faces.new(bore[-1]))
    g.solid_multi([(steel, "gun_steel"), (dark, "gun_bore")])

    # tall flat front sight blade right behind the ring, leaning slightly back; a low notched rear sight further back
    zs = Z_MUZZLE
    g.prism([(zs - 8.8, R - 0.8), (zs - 5.0, R - 0.8), (zs - 6.0, R + 4.2), (zs - 8.6, R + 4.2)], -0.7, 0.7, "gun_trim")
    zr = zs - 17.0
    g.prism([(zr, R - 0.8), (zr + 4.2, R - 0.8), (zr + 4.2, R + 1.5), (zr + 2.9, R + 1.5), (zr + 2.1, R + 0.6),
             (zr + 1.3, R + 1.5), (zr, R + 1.5)], -1.0, 1.0, "gun_trim")

    # ONE continuous flat raised band (gun_trim) spiralling 2.5 turns along the barrel: its centre jogs left and right
    # in steps, so both edges are stepped and angular (lightning-like); it narrows to a pointed tip near the muzzle
    z_a, z_b, turns, cells = 22.0, Z_MUZZLE - 13.0, 2.5, 11
    rings = []

    def band_ring(z, a, off, w):
        rb, rt = R - 0.4, R + 0.7
        return [g.v(P(rb * math.cos(a + off - w), rb * math.sin(a + off - w), z)),
                g.v(P(rt * math.cos(a + off - w * 0.85), rt * math.sin(a + off - w * 0.85), z)),
                g.v(P(rt * math.cos(a + off + w * 0.85), rt * math.sin(a + off + w * 0.85), z)),
                g.v(P(rb * math.cos(a + off + w), rb * math.sin(a + off + w), z))]

    for k in range(cells):
        off = 0.26 if k % 2 == 0 else -0.26
        w = 0.8
        for s in (k / cells + 0.002, (k + 1) / cells - 0.002):
            rings.append(band_ring(z_a + (z_b - z_a) * s, 2 * math.pi * turns * s + math.pi / 2, off, w))
    a_e = 2 * math.pi * turns + math.pi / 2
    tip = g.v(P((R + 0.7) * math.cos(a_e + 0.3), (R + 0.7) * math.sin(a_e + 0.3), z_b + 4.5))
    faces = []
    for r0, r1 in zip(rings, rings[1:]):
        for j in range(4):
            faces.append(g.bm.faces.new([r0[j], r0[(j + 1) % 4], r1[(j + 1) % 4], r1[j]]))
    for j in range(4):
        faces.append(g.bm.faces.new([rings[-1][j], rings[-1][(j + 1) % 4], tip]))
    faces.append(g.bm.faces.new(list(reversed(rings[0]))))
    g.solid(faces, "gun_trim")

    # dark wood: forestock slab under the barrel, lock, wrist and the short stock in one loft
    g.loft([[g.v(P(x, u, z)) for x, u in chamfer_pts(top, bot, w, CH)] for z, top, bot, w in STOCK], "gun_wood")

    # curved steel butt shoe: wraps the whole butt end and ~5 cm onto the top and bottom, back face rounded off
    shoe = []
    for z, m in ((-25.0, 0.45), (-30.0, 0.7), (-32.2, 0.0)):
        top, bot, w = stock_at(z if z >= -30 else -30)
        shoe.append([g.v(P(x, u, z)) for x, u in chamfer_pts(top + m, bot - m, w + m, CH + 0.4 + (0.7 if m == 0 else 0))])
    g.loft(shoe, "gun_steel")

    # lock: chunky plate on the +X side with two rivets, upright hammer, frizzen and pan; a plain plate on -X
    g.prism([(4.5, -6.0), (18.0, -5.2), (21.5, -1.0), (20.0, 3.4), (8.5, 3.8), (4.5, 1.5)], 3.0, 5.0, "gun_steel")
    g.prism([(5.5, -5.0), (17.0, -4.6), (19.0, -1.0), (17.5, 2.6), (8.5, 3.0), (5.5, 1.0)], -4.4, -3.2, "gun_steel")
    for zr in (8.5, 15.5):
        g.box((5.0, -2.2, zr - 0.9), (5.8, -0.6, zr + 0.9), "gun_trim")
    g.prism([(3.5, 3.0), (6.4, 3.0), (6.8, 5.0), (8.6, 6.4), (8.0, 7.6), (5.2, 7.2), (3.8, 5.2)], 3.8, 5.8, "gun_trim")
    g.prism([(19.0, 2.0), (23.0, 2.0), (22.4, 7.0), (20.0, 7.0)], 3.6, 5.2, "gun_trim")
    g.box((3.4, 1.4, 17.0), (5.0, 3.0, 21.0), "gun_trim")

    # big angular trigger guard (pentagon with the stock) hanging ~1.2 barrel diameters below the wrist, and the trigger
    outer = [(20.5, -7.8), (17.0, -20.5), (0.0, -20.5), (-7.0, -14.0)]
    inner = [(18.0, -9.0), (15.0, -18.2), (1.2, -18.2), (-5.0, -13.4)]
    g.prism(outer + list(reversed(inner)), -1.0, 1.0, "gun_steel")
    g.prism([(6.0, -11.0), (9.5, -11.0), (6.8, -17.5)], -0.5, 0.5, "gun_trim")

    # wide cloth strips wound diagonally round the wrist, overlapping, from the lock to the middle of the stock
    tilt = 0.6
    for n, z0 in enumerate((1.0, -3.2, -7.4, -11.6)):
        rings = []
        for dz in (-2.6, 2.6):
            ring = []
            top, bot, w = stock_at(z0 + dz)
            for x, u in chamfer_pts(top, bot, w, CH):
                rel = (u - (top + bot) / 2) * tilt
                t2, b2, w2 = stock_at(z0 + dz + rel)
                m = 0.35 if n % 2 else 0.9
                ring.append(g.v(P(x * (w2 + m) / w if w else x, u + (m if u > (top + bot) / 2 else -m), z0 + dz + rel)))
            rings.append(ring)
        g.loft(rings, "gun_cloth")

    return g.finish("gun_common")


def look_at_matrix(eye, target, up):
    f = (target - eye).normalized()
    r = f.cross(up).normalized()
    u = r.cross(f)
    m = Matrix(((r.x, u.x, -f.x, eye.x), (r.y, u.y, -f.y, eye.y), (r.z, u.z, -f.z, eye.z), (0, 0, 0, 1)))
    return m


def render(path, direction, ortho_scale, ctr=(0, 0, 39), res=(1600, 700)):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.55, 0.57, 0.62, 1)
    bg.inputs["Strength"].default_value = 0.9
    scene.world = world
    ctr = Vector(ctr)
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho_scale
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    d = Vector(direction).normalized()
    up = Vector((0, -1, 0))
    cam.matrix_world = look_at_matrix(ctr + d * 400, ctr, up)
    cam_data.clip_end = 2000
    scene.camera = cam
    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 3.0
    sun = bpy.data.objects.new("sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(55), math.radians(15), math.radians(-35))
    sun2_data = bpy.data.lights.new("fill", "SUN")
    sun2_data.energy = 1.2
    sun2 = bpy.data.objects.new("fill", sun2_data)
    scene.collection.objects.link(sun2)
    sun2.rotation_euler = (math.radians(120), math.radians(-20), math.radians(140))
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in (cam, sun, sun2):
        bpy.data.objects.remove(o, do_unlink=True)


def export(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=GLB, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                              export_image_format="NONE", export_materials="EXPORT", export_vertex_color="NONE",
                              export_normals=True, export_animations=False)
    print("wrote", GLB, os.path.getsize(GLB))


def vs_axe(gun, path):
    """Gun and axe_uncommon at the same scale, grips aligned, the axe below (up in the render is -Y)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(REPO, "public", "assets", "models", "axe_uncommon.glb"))
    axe = [o for o in bpy.data.objects if o not in before]
    for o in axe:
        if o.parent is None:
            o.location.y += 34
    gun.location.y = -48
    render(path, (1, 0, 0), 200, ctr=(0, 0, 39), res=(1600, 1000))
    gun.location.y = 0
    for o in axe:
        bpy.data.objects.remove(o, do_unlink=True)


def main():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    ob = build()
    print("dims (blender x,y,z cm)", tuple(round(x, 1) for x in ob.dimensions), "tris", sum(len(p.vertices) - 2 for p in ob.data.polygons))
    os.makedirs(os.path.dirname(BLEND), exist_ok=True)
    export(ob)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    if PREVIEW_DIR:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        render(os.path.join(PREVIEW_DIR, "gun_side.png"), (1, 0, 0), 170)
        render(os.path.join(PREVIEW_DIR, "gun_side_other.png"), (-1, 0, 0), 170)
        render(os.path.join(PREVIEW_DIR, "gun_3q.png"), (1.2, -0.7, 0.55), 170)
        render(os.path.join(PREVIEW_DIR, "gun_muzzle.png"), (1.0, -0.3, 0.8), 42, ctr=(0, -2, 98), res=(1000, 800))
        vs_axe(ob, os.path.join(PREVIEW_DIR, "gun_vs_axe.png"))
        bpy.ops.wm.save_as_mainfile(filepath=BLEND)


if __name__ == "__main__":
    main()
