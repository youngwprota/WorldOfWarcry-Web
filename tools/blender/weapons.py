"""New hero weapons (docs/features/new-weapons), built procedurally so the art is reproducible.
Low-poly flat-shaded meshes UV-mapped onto the gradient columns of the Bitgem atlas proto_human_RTS_color.png,
so they share its hand-painted palette (the game assigns that texture by name, see textureFor in src/assets.ts).
Geometry is in centimetres, long axis along Blender +Z (exported as +Y), grip near the bottom - like the Bitgem weapons.

PYTHONPATH=<numpy for py3.12> blender -b --python-use-system-env --factory-startup --python-exit-code 1 -P tools/blender/weapons.py -- [preview_dir]
Output: public/assets/models/<name>.fbx for every builder in BUILDERS (+ <name>.png renders in preview_dir when given).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW_DIR = ARGS[0] if ARGS else None
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
MODELS = os.path.join(REPO, "public", "assets", "models")
ATLAS = os.path.join(REPO, "public", "assets", "textures", "proto_human_RTS_color.png")

# Atlas gradient columns: u at the column centre, v from dark to light.
PALETTE = {
    "steel": (0.031, 0.17, 0.45),
    "dark_steel": (0.031, 0.10, 0.36),
    "gold": (0.094, 0.18, 0.45),
    "wood": (0.406, 0.62, 0.92),
    "leather": (0.281, 0.62, 0.90),
    "red": (0.594, 0.16, 0.45),
    "bone": (0.469, 0.70, 0.96),
}
PARTS = list(PALETTE)


class Builder:
    """One mesh: every vertex carries a shade 0..1 (position along its palette gradient), every face a part."""

    def __init__(self):
        self.bm = bmesh.new()
        self.shade = self.bm.verts.layers.float.new("shade")

    def vert(self, co, shade):
        v = self.bm.verts.new(co)
        v[self.shade] = shade
        return v

    def face(self, verts, part):
        f = self.bm.faces.new(verts)
        f.material_index = PARTS.index(part)
        return f

    def loft(self, rings, part, cap_start=True, cap_end=True):
        """Faces between consecutive rings (lists of verts with equal length, closed loops)."""
        for a, b in zip(rings, rings[1:]):
            n = len(a)
            for i in range(n):
                j = (i + 1) % n
                quad = [a[i], a[j], b[j], b[i]]
                if len(set(quad)) >= 3:
                    self.face(list(dict.fromkeys(quad)), part)
        if cap_start and len(set(rings[0])) > 2:
            self.face(list(reversed(rings[0])), part)
        if cap_end and len(set(rings[-1])) > 2:
            self.face(rings[-1], part)

    def cylinder(self, z0, z1, r0, r1, part, seg=8, shade=(0.2, 0.8), center=(0, 0)):
        rings = []
        for z, r, s in ((z0, r0, shade[0]), (z1, r1, shade[1])):
            ring = []
            for i in range(seg):
                a = 2 * math.pi * (i + 0.5) / seg
                # the side facing +X/+Y is lit: brighter shade there
                lit = 0.5 + 0.5 * math.cos(a - 0.8)
                ring.append(self.vert((center[0] + r * math.cos(a), center[1] + r * math.sin(a), z), s * (0.6 + 0.4 * lit)))
            rings.append(ring)
        self.loft(rings, part)

    def box(self, lo, hi, part, shade=0.6):
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        v = [self.vert((x, y, z), shade * (0.75 + 0.25 * (z - z0) / max(1e-6, z1 - z0)))
             for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
        for q in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
            self.face([v[i] for i in q], part)

    def finish(self, name):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        uv = bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            u, v0, v1 = PALETTE[PARTS[f.material_index]]
            f.material_index = 0
            for loop in f.loops:
                s = max(0.0, min(1.0, loop.vert[self.shade]))
                loop[uv].uv = (u, v0 + (v1 - v0) * s)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        me.materials.append(atlas_material())
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(name, me)
        bpy.context.collection.objects.link(ob)
        return ob


_MAT = None


def atlas_material():
    global _MAT
    if _MAT is None:
        m = bpy.data.materials.new("proto_human_rts")
        m.use_nodes = True
        nt = m.node_tree
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(ATLAS)
        tex.interpolation = "Closest"
        nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
        _MAT = m
    return _MAT


def dagger():
    """Long hunter's dagger: leaf blade with a centre ridge, gold guard with a red stone, wrapped grip."""
    b = Builder()
    # blade: diamond cross-section lofted along Z, widest a little above the guard
    rings = []
    z0, z1 = 13.0, 66.0
    steps = 7
    for k in range(steps + 1):
        t = k / steps
        z = z0 + (z1 - z0) * t
        w = 5.2 * (1 - t) ** 0.55 * (1 + 0.35 * math.sin(math.pi * min(1.0, t * 2)))
        th = 1.3 * (1 - t) + 0.05
        edge = 0.95  # sharp edges catch the light
        ridge = 0.45 + 0.35 * t
        rings.append([b.vert((-w, 0, z), edge), b.vert((0, th, z), ridge), b.vert((w, 0, z), edge), b.vert((0, -th, z), ridge * 0.7)])
    tip = b.vert((0, 0, z1 + 4), 1.0)
    rings[-1] = [tip] * 4
    b.loft(rings, "steel", cap_start=True, cap_end=False)
    # guard: a bar with drooping ends and a stone in the middle
    b.box((-9.5, -1.8, 10.5), (9.5, 1.8, 13.5), "gold", 0.75)
    b.box((-11.5, -1.6, 8.5), (-8.5, 1.6, 12.0), "gold", 0.55)
    b.box((8.5, -1.6, 8.5), (11.5, 1.6, 12.0), "gold", 0.55)
    b.box((-1.6, -2.4, 10.3), (1.6, 2.4, 13.7), "red", 0.85)
    # grip: leather wrap with ridges, gold pommel
    for i in range(4):
        z = -10 + i * 5
        b.cylinder(z, z + 4.2, 2.3, 2.5, "leather", seg=8, shade=(0.3, 0.9))
        b.cylinder(z + 4.2, z + 5, 2.6, 2.6, "leather", seg=8, shade=(0.15, 0.3))
    b.cylinder(-15, -10, 2.0, 3.2, "gold", seg=8, shade=(0.4, 0.8))
    b.cylinder(-17, -15, 1.0, 2.0, "gold", seg=8, shade=(0.6, 0.9))
    return b.finish("dagger")


def reaper():
    """Reaper's war scythe: long dark shaft with iron bands, a big curved blade with a back spike and a bone grip."""
    b = Builder()
    # shaft (slightly thinner towards the top), iron bands, butt spike
    b.cylinder(-18, 196, 3.4, 2.9, "wood", seg=8, shade=(0.15, 0.7))
    for z0 in (30, 108, 182):
        b.cylinder(z0, z0 + 5, 3.9, 3.9, "dark_steel", seg=8, shade=(0.4, 0.7))
    b.cylinder(-30, -18, 0.4, 3.6, "dark_steel", seg=8, shade=(0.3, 0.6))
    # bone-wrapped lower grip
    b.cylinder(0, 26, 3.8, 3.8, "bone", seg=8, shade=(0.2, 0.8))
    # blade socket at the top
    b.box((-5, -4, 184), (5, 4, 200), "dark_steel", 0.5)
    b.cylinder(200, 208, 3.0, 0.3, "dark_steel", seg=6, shade=(0.4, 0.9))
    # blade: spine from the socket out along -X, curving down to the tip; sharp edge below the spine
    rings = []
    steps = 10
    for k in range(steps + 1):
        t = k / steps
        x = -4 - 112 * t
        zs = 196 + 14 * math.sin(math.pi * t * 0.7) - 52 * t ** 2.2
        w = 22 * (1 - t) ** 0.75 + 0.5  # blade width below the spine
        th = 1.6 * (1 - t) + 0.15
        # the blade leans back a little as it curves, like a crescent
        ex = x + 6 * t
        rings.append([
            b.vert((x, th, zs), 0.35),
            b.vert((ex, 0.2, zs - w), 0.95),
            b.vert((x, -th, zs), 0.25),
        ])
    tip = b.vert((-4 - 112 - 6, 0, 196 + 14 * math.sin(math.pi * 0.7) - 52 - 6), 1.0)
    rings[-1] = [tip] * 3
    b.loft(rings, "dark_steel", cap_start=True, cap_end=False)
    # back spike on the other side of the socket
    sp = [b.vert((5, 1.2, 198), 0.4), b.vert((5, 0, 189), 0.8), b.vert((5, -1.2, 198), 0.3)]
    st = b.vert((24, 0, 202), 1.0)
    b.loft([sp, [st] * 3], "dark_steel", cap_start=True, cap_end=False)
    return b.finish("reaper")


def blade_loft(b, pts, part="steel", spine=0.35, edge=0.95):
    """Single-edged blade along a list of (x, z, width, thickness): spine at (x, z), edge `width` towards +X."""
    rings = []
    for x, z, w, th in pts:
        rings.append([b.vert((x, th, z), spine), b.vert((x + w, 0.15, z), edge), b.vert((x, -th, z), spine * 0.7)])
    x, z, _, _ = pts[-1]
    rings.append([b.vert((x + 1.5, 0, z + 4), 1.0)] * 3)
    b.loft(rings, part, cap_start=True, cap_end=False)


def nagamaki():
    """Nagamaki: a long wrapped grip as long as the slightly curved single-edged blade, round guard."""
    b = Builder()
    for i in range(10):
        z = -40 + i * 9
        b.cylinder(z, z + 7.5, 2.6, 2.6, "leather", seg=6, shade=(0.3, 0.9))
        b.cylinder(z + 7.5, z + 9, 2.9, 2.9, "red", seg=6, shade=(0.3, 0.6))
    b.cylinder(-46, -40, 3.2, 3.0, "gold", seg=8, shade=(0.4, 0.9))
    b.cylinder(50, 53, 7.5, 7.5, "gold", seg=10, shade=(0.4, 0.8))
    b.cylinder(53, 58, 3.0, 2.8, "gold", seg=6, shade=(0.6, 0.9))
    pts = []
    for k in range(9):
        t = k / 8
        pts.append((-2.6 + 9 * t ** 2, 58 + 92 * t, 5.5 - 1.5 * t, 1.1 * (1 - t) + 0.25))
    blade_loft(b, pts)
    return b.finish("nagamaki")


def scythe():
    """Throwing scythe: a short shaft with a crescent blade at each end (spins like a wheel when thrown)."""
    b = Builder()
    b.cylinder(-10, 60, 2.6, 2.6, "wood", seg=8, shade=(0.2, 0.7))
    b.cylinder(18, 32, 3.0, 3.0, "leather", seg=8, shade=(0.3, 0.9))
    for z0 in (-12, 58):
        b.cylinder(z0, z0 + 4, 3.4, 3.4, "dark_steel", seg=8, shade=(0.4, 0.7))
    for end, sign in ((60, 1), (-10, -1)):
        rings = []
        for k in range(9):
            t = k / 8
            a = math.pi * 0.85 * t
            r = 26
            x = sign * (r * math.sin(a))
            z = end + sign * (r * (1 - math.cos(a)) * 0.9) - sign * 4
            w = 9 * (1 - t) ** 0.7 + 0.4
            th = 1.2 * (1 - t) + 0.15
            rings.append([b.vert((x, th, z), 0.35), b.vert((x * (1 + w / r), 0.15, z + sign * w * 0.3), 0.95), b.vert((x, -th, z), 0.25)])
        rings.append([rings[-1][1]] * 3)
        b.loft(rings, "dark_steel", cap_start=True, cap_end=False)
    return b.finish("scythe")


def shield():
    """Round buckler: wooden planks in a steel rim, a steel boss in the middle; handle along +Z under it."""
    b = Builder()
    # the disc faces +Y; its centre is 25 cm above the grip so the attach code finds the grip at the bottom
    seg = 14
    c = 25
    rings = []
    for r, y, sh in ((0.1, 5.5, 0.95), (6, 5.2, 0.85), (7, 3.2, 0.6)):
        rings.append([b.vert((r * math.cos(2 * math.pi * i / seg), y, c + r * math.sin(2 * math.pi * i / seg)), sh) for i in range(seg)])
    b.loft(rings, "dark_steel", cap_start=False, cap_end=False)
    disc = [[b.vert((r * math.cos(2 * math.pi * i / seg), y, c + r * math.sin(2 * math.pi * i / seg)), sh) for i in range(seg)]
            for r, y, sh in ((7, 3.2, 0.5), (24, 2.2, 0.85), (24, -1.5, 0.3), (7, -1.5, 0.2))]
    b.loft(disc, "wood", cap_start=False, cap_end=False)
    rim = [[b.vert((r * math.cos(2 * math.pi * i / seg), y, c + r * math.sin(2 * math.pi * i / seg)), sh) for i in range(seg)]
           for r, y, sh in ((23.5, 3.0, 0.9), (27, 2.6, 0.95), (27, -2.2, 0.4), (23.5, -2.2, 0.3))]
    b.loft(rim, "steel", cap_start=False, cap_end=False)
    # inner handle (the grip point at the bottom), plus a strap bar
    b.box((-1.6, -6.5, 0), (1.6, -2.2, 26), "leather", 0.6)
    return b.finish("shield")


def pan():
    """Frying pan: long handle at the bottom, a round shallow pan on top."""
    b = Builder()
    b.cylinder(-8, 30, 2.0, 2.4, "wood", seg=6, shade=(0.2, 0.8))
    b.cylinder(-11, -8, 2.6, 2.6, "dark_steel", seg=6, shade=(0.3, 0.6))
    b.box((-1.4, -1.2, 30), (1.4, 1.2, 40), "dark_steel", 0.5)
    seg = 14
    c = 58
    pan_rings = [[b.vert((r * math.cos(2 * math.pi * i / seg), y, c + r * math.sin(2 * math.pi * i / seg)), sh) for i in range(seg)]
                 for r, y, sh in ((0.1, 2.0, 0.55), (17, 2.0, 0.5), (19, 6.0, 0.75), (20, 6.0, 0.95), (18.2, 0.5, 0.3), (0.1, 0.5, 0.25))]
    b.loft(pan_rings, "dark_steel", cap_start=False, cap_end=False)
    return b.finish("pan")


def hidden_blade():
    """Assassin's hidden blade: a leather bracer with a narrow blade sliding out of it."""
    b = Builder()
    b.cylinder(-6, 18, 3.6, 4.4, "leather", seg=8, shade=(0.3, 0.9))
    for z in (-6, 6, 16):
        b.cylinder(z, z + 2, 4.6, 4.6, "gold", seg=8, shade=(0.4, 0.8))
    b.box((-1.2, -1.2, 18), (1.2, 1.2, 22), "dark_steel", 0.5)
    rings = []
    for k in range(6):
        t = k / 5
        z = 22 + 34 * t
        w = 1.8 * (1 - t * 0.4)
        th = 0.7
        rings.append([b.vert((-w, 0, z), 0.95), b.vert((0, th, z), 0.5), b.vert((w, 0, z), 0.95), b.vert((0, -th, z), 0.35)])
    rings.append([b.vert((0, 0, 62), 1.0)] * 4)
    b.loft(rings, "steel", cap_start=True, cap_end=False)
    return b.finish("hidden_blade")


def sickle():
    """Sickle: a short wooden handle and a hooked crescent blade."""
    b = Builder()
    b.cylinder(-8, 18, 2.2, 2.4, "wood", seg=6, shade=(0.2, 0.8))
    b.cylinder(18, 21, 2.7, 2.7, "dark_steel", seg=6, shade=(0.4, 0.7))
    rings = []
    for k in range(10):
        t = k / 9
        a = math.pi * 1.25 * t
        r = 15
        x = r * math.sin(a) - 0.0
        z = 21 + r * (1 - math.cos(a)) * 1.05
        w = 4.5 * (1 - t) ** 0.6 + 0.3
        th = 0.9 * (1 - t) + 0.15
        nx, nz = -math.sin(a), math.cos(a) - 1  # towards the inside of the hook
        ln = math.hypot(nx, nz) or 1
        rings.append([b.vert((x, th, z), 0.35), b.vert((x - w * math.sin(a), 0.15, z - w * math.cos(a) * 0.3 + w * 0.2), 0.95), b.vert((x, -th, z), 0.25)])
    rings.append([rings[-1][1]] * 3)
    b.loft(rings, "steel", cap_start=True, cap_end=False)
    return b.finish("sickle")


def kitchen_knife():
    """Kitchen chef's knife: riveted wooden handle, a wide blade with a straight spine."""
    b = Builder()
    b.box((-1.6, -1.1, -8), (1.6, 1.1, 14), "wood", 0.7)
    for z in (-3, 4, 11):
        b.box((-0.9, -1.25, z - 0.8), (0.9, 1.25, z + 0.8), "steel", 0.95)
    b.box((-2.2, -1.2, 14), (2.2, 1.2, 16), "steel", 0.6)
    pts = [(-1.8, 16 + 30 * t, 7.5 * (1 - t ** 3) + 0.6, 0.6 * (1 - t) + 0.15) for t in (k / 6 for k in range(7))]
    blade_loft(b, pts)
    return b.finish("kitchen_knife")


BUILDERS = {"dagger": dagger, "reaper": reaper, "nagamaki": nagamaki, "scythe": scythe, "shield": shield, "pan": pan,
            "hidden_blade": hidden_blade, "sickle": sickle, "kitchen_knife": kitchen_knife}


def export(ob, name):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    path = os.path.join(MODELS, name + ".fbx")
    bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={"MESH"}, apply_unit_scale=False,
                             global_scale=0.01, axis_forward="-Z", axis_up="Y", mesh_smooth_type="FACE",
                             bake_space_transform=True, path_mode="STRIP")
    print("wrote", path)


def preview(ob, name):
    scene = bpy.context.scene
    for o in scene.objects:
        o.hide_render = o is not ob and o.type == "MESH"
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = scene.render.resolution_y = 512
    scene.render.film_transparent = False
    world = scene.world or bpy.data.worlds.new("w")
    scene.world = world
    bbox = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    center = sum(bbox, Vector()) / 8
    size = max((max(v[i] for v in bbox) - min(v[i] for v in bbox)) for i in range(3))
    cam_data = bpy.data.cameras.get("cam") or bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = size * 1.15
    cam_data.clip_end = 10000
    cam = bpy.data.objects.get("cam") or bpy.data.objects.new("cam", cam_data)
    if cam.name not in scene.collection.objects:
        scene.collection.objects.link(cam)
    cam.location = center + Vector((size * 0.6, -size * 2, size * 0.25))
    cam.rotation_euler = (center - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.filepath = os.path.join(PREVIEW_DIR, name + ".png")
    bpy.ops.render.render(write_still=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
# `-- dir name1 name2`: only those builders
ONLY = ARGS[1:] or list(BUILDERS)
built = {}
for name in ONLY:
    built[name] = BUILDERS[name]()
    # every model alone at the origin for its preview
for name, ob in built.items():
    export(ob, name)
if PREVIEW_DIR:
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    for name, ob in built.items():
        preview(ob, name)
