"""Lion upgrade (pet and zoo creature wild_lion): keeps the skeleton and the clips, adds fur on top of the low-poly body:
a full layered mane, a face ruff, a chin beard, a chest mane, elbow tufts and a fluffy tail tuft. Every tuft is
skinned like the skin under its root (weights copied from the nearest body vertex), so it follows every clip.

blender -b --factory-startup --python-exit-code 1 -P tools/blender/lion_upgrade.py -- [out.glb]
Input: Art/Source/wild_lion_base.glb (the untouched model). Output: public/assets/models/wild_lion.glb by default.
Space: Blender world of the imported GLB (Z up, the lion faces -Y, metres at scale 1).
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
SRC = os.path.join(REPO, "Art", "Source", "wild_lion_base.glb")
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS else os.path.join(REPO, "public", "assets", "models", "wild_lion.glb")
TAU = 2 * math.pi
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
rnd = random.Random(7)

# fur colours (linear): root -> tip. Dark chocolate mane with copper tips, a golden face ruff
MANE = ((0.03, 0.01, 0.004), (0.22, 0.07, 0.015))
MANE_OUT = ((0.05, 0.017, 0.005), (0.42, 0.16, 0.03))
RUFF = ((0.25, 0.1, 0.02), (0.7, 0.4, 0.1))
TAIL = ((0.025, 0.008, 0.003), (0.16, 0.05, 0.012))


class Fur:
    def __init__(self):
        self.v, self.c, self.f, self.root = [], [], [], []

    def tuft(self, root, d, length, width, cols, bend=None, thin=0.5, sides=4, rings=3, anchor=None):
        """A pointed, slightly flattened tuft from `root` along `d`, curving toward `bend`; colour root -> tip.
        `anchor`: where to read the skin weights (default the root)."""
        d = Vector(d).normalized()
        bend = Vector(bend) if bend is not None else -Z
        side = d.cross(bend if bend.length > 1e-6 else Z)
        if side.length < 1e-4:
            side = d.cross(X)
        side.normalize()
        up = side.cross(d).normalized()
        base = len(self.v)
        prev = None
        for i in range(rings + 1):
            t = i / rings
            # centre line: straight out, then curling toward `bend`
            q = Vector(root) + d * length * t + bend * length * 0.35 * t * t
            r = width * (1 - t) ** 0.85 * (1.15 - 0.15 * t)
            ring = []
            for j in range(sides):
                a = TAU * j / sides
                ring.append(len(self.v))
                self.v.append(q + (side * math.cos(a) + up * math.sin(a) * thin) * r)
                k = t ** 0.8
                self.c.append(tuple(cols[0][n] + (cols[1][n] - cols[0][n]) * k for n in range(3)))
            if prev:
                for j in range(sides):
                    jj = (j + 1) % sides
                    self.f.append((prev[j], prev[jj], ring[jj], ring[j]))
            prev = ring
        # root cap (hidden in the body) and the tip
        self.f.append(tuple(reversed(prev)))
        first = list(range(base, base + sides))
        self.f.append(tuple(first))
        self.root.append((base, len(self.v), Vector(anchor if anchor is not None else root)))


def body_bvh(body):
    dg = bpy.context.evaluated_depsgraph_get()
    e = body.evaluated_get(dg)
    m = e.to_mesh()
    verts = [body.matrix_world @ v.co for v in m.vertices]
    polys = [list(p.vertices) for p in m.polygons]
    e.to_mesh_clear()
    kd = KDTree(len(verts))
    for i, v in enumerate(verts):
        kd.insert(v, i)
    kd.balance()
    return BVHTree.FromPolygons(verts, polys), kd, verts


def surface(bvh, centre, d, reach=3.0):
    """Outermost body point from `centre` along direction `d` (cast back in from far out)."""
    d = Vector(d).normalized()
    hit = bvh.ray_cast(Vector(centre) + d * reach, -d, reach)[0]
    return hit


def jit(a):
    return (rnd.random() * 2 - 1) * a


def build_fur(bvh, bones):
    fur = Fur()
    head = bones["bone_Head"]
    # mane axis: from just behind the face back over the neck to the shoulders
    A0, A1 = Vector((head.x, -0.98, 1.22)), Vector((head.x, -0.34, 1.12))

    def axis(s):
        return A0.lerp(A1, s)

    # three layers of the mane: inner dark and dense, outer longer with lighter tips
    for layer, (ns, nphi, ln, wd, cols, push) in enumerate((
            (5, 14, 0.30, 0.17, MANE, 0.00),
            (4, 12, 0.38, 0.18, MANE_OUT, 0.05),
            (3, 10, 0.44, 0.17, MANE_OUT, 0.10))):
        for i in range(ns):
            s = (i + 0.5 * (layer % 2)) / (ns - 0.5)
            s = min(1.0, s)
            for j in range(nphi):
                phi = TAU * (j + 0.5 * (i % 2)) / nphi + jit(0.08)
                D = (X * math.sin(phi) + Z * math.cos(phi)).normalized()
                lower = max(0.0, -math.cos(phi))  # 1 = under the neck (chest)
                hit = surface(bvh, axis(s) + Y * jit(0.03), D)
                if hit is None:
                    continue
                root = hit + D * push - D * 0.04
                # outward, swept back along the body, heavier at the bottom
                d = D * (1.0 - 0.3 * lower) + Y * (0.45 + 0.9 * s) - Z * (0.15 + 0.6 * lower)
                L = ln * (0.85 + 0.3 * rnd.random()) * (1.0 + 0.25 * math.cos(phi) * (1 - s)) * (1.0 - 0.35 * s * s)
                fur.tuft(root, d, L, wd * (0.85 + 0.3 * rnd.random()), cols, bend=(-Z * 0.7 + Y * 0.6).normalized())

    # face ruff: a frame of lighter tufts around the face, pointing out and a bit forward
    for j in range(18):
        phi = TAU * j / 18 + jit(0.05)
        D = (X * math.sin(phi) + Z * math.cos(phi)).normalized()
        if math.cos(phi) < -0.55:
            continue  # the chin: the beard goes there
        hit = surface(bvh, Vector((head.x, -1.05, 1.18)), D)
        if hit is None:
            continue
        d = D - Y * 0.25 - Z * 0.1
        fur.tuft(hit - D * 0.03, d, 0.2 + 0.08 * rnd.random(), 0.1, RUFF, bend=(-Z + Y * 0.5).normalized())

    # chin beard: hangs under the jaw, follows the jaw bone
    jaw = bones["bone_Jaw"]
    for i in range(5):
        a = (i - 2) * 0.3
        root = Vector((jaw.x + math.sin(a) * 0.12, -1.08 + abs(a) * 0.08, 0.86))
        d = (-Z + Y * 0.35 + X * math.sin(a) * 0.4).normalized()
        fur.tuft(root, d, 0.24 + 0.06 * rnd.random(), 0.09, RUFF, bend=Y)

    # chest mane: long tufts hanging between the forelegs
    for i in range(9):
        x = head.x + jit(0.2)
        y = -0.85 + rnd.random() * 0.35
        hit = surface(bvh, Vector((x, y, 0.95)), -Z)
        if hit is None:
            continue
        d = (-Z + Y * 0.25 + X * jit(0.3)).normalized()
        fur.tuft(hit + Z * 0.05, d, 0.2 + 0.08 * rnd.random(), 0.13, MANE_OUT, bend=Y)

    # elbow tufts on the forelegs
    for side in ("L", "R"):
        e = bones["bone_elbow_" + side]
        sgn = 1 if side == "L" else -1
        for i in range(3):
            root = e + X * sgn * 0.09 + Y * (0.06 + 0.02 * i) - Z * (0.05 + 0.04 * i)
            d = (Y * 1.0 - Z * 0.6 + X * sgn * 0.3).normalized()
            fur.tuft(root, d, 0.13 + 0.04 * rnd.random(), 0.05, MANE, bend=-Z)

    # tail tuft: a fluffy brush around the tip, pointing on along the tail
    t0, t1 = bones["bone_27"], bones["bone_30"]
    tip = Vector((t1.x + 0.03, 2.22, 1.3))
    along = (tip - t0).normalized()
    _, u, w = basis(along)
    for i in range(14):
        a = TAU * i / 7 + jit(0.2)
        k = i / 14
        off = (u * math.cos(a) + w * math.sin(a))
        root = tip - along * (0.12 - 0.1 * k) + off * 0.03
        d = (along * (0.9 + 0.4 * k) + off * (0.9 - 0.5 * k) - Z * 0.2).normalized()
        fur.tuft(root, d, 0.18 + 0.12 * k + 0.05 * rnd.random(), 0.08, TAIL, bend=-Z, anchor=tip - along * 0.05)
    return fur


def basis(n):
    n = Vector(n).normalized()
    u = (Z if abs(n.z) < 0.9 else X).cross(n).normalized()
    return n, u, n.cross(u)


def fur_material():
    m = bpy.data.materials.new("lion_fur")
    m.use_nodes = True
    m.use_backface_culling = False
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "fur"
    nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.9
    return m


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    sc = bpy.context.scene
    arm = next(o for o in sc.objects if o.type == "ARMATURE")
    body = sc.objects["creature_lion"]
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()
    bones = {b.name: arm.matrix_world @ b.head_local for b in arm.data.bones}
    bvh, kd, verts = body_bvh(body)
    fur = build_fur(bvh, bones)

    me = bpy.data.meshes.new("lion_fur")
    me.from_pydata([tuple(v) for v in fur.v], [], fur.f)
    col = me.color_attributes.new("fur", "FLOAT_COLOR", "POINT")
    for i, c in enumerate(fur.c):
        col.data[i].color = (*c, 1.0)
    for p in me.polygons:
        p.use_smooth = False
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(fur_material())
    ob = bpy.data.objects.new("lion_fur", me)
    sc.collection.objects.link(ob)
    ob.parent = arm
    ob.matrix_parent_inverse = arm.matrix_world.inverted()
    # skin each tuft like the body vertex nearest to its anchor
    names = {g.index: g.name for g in body.vertex_groups}
    groups = {}
    for start, end, anchor in fur.root:
        _, vi, _ = kd.find(anchor)
        for g in body.data.vertices[vi].groups:
            if g.weight < 0.01:
                continue
            n = names[g.group]
            vg = groups.get(n) or ob.vertex_groups.new(name=n)
            groups[n] = vg
            vg.add(list(range(start, end)), g.weight, "REPLACE")
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    arm.data.pose_position = "POSE"
    print(f"fur: {len(fur.root)} tufts, {len(me.polygons)} faces (body {len(body.data.polygons)})")

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_yup=True, export_cameras=False,
                              export_lights=False, export_animations=True, export_skins=True)
    print("saved", OUT)


main()
