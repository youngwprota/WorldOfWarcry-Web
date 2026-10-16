"""gun_common v4: the user's exported dwarven rifle (Art/Source/ref/guns/rifledwarven.obj, texture
Art/Source/ref/gunracks/dwarvenrifle01.png) cleaned up and recoloured to the common gear style.

Pipeline: import OBJ -> apply transform -> merge doubles -> split faces into flat-colour materials by sampling the
texture at each face -> orient (Blender +Z long, muzzle +Z, sight side = -Y, lock side +X; glTF: long +Y, up +Z), wrist at
the origin, 142 cm long -> slightly thicker body and bigger muzzle -> outward normals -> three cloth wraps on the wrist
-> GLB (flat materials gun_wood / gun_steel / gun_trim / gun_cloth / gun_bore, no textures).

blender -b --factory-startup --python-exit-code 1 -P tools/blender/gun_src.py -- [preview_dir]
Output: Art/Source/gun_common.blend, public/assets/models/gun_common.glb (+ PNG renders in preview_dir when given).
"""
import colorsys
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW_DIR = ARGS[0] if ARGS else None
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
REF = os.path.join(REPO, "Art", "Source", "ref")
GLB = os.path.join(REPO, "public", "assets", "models", "gun_common.glb")
BLEND = os.path.join(REPO, "Art", "Source", "gun_common.blend")
AXE = os.path.join(REPO, "public", "assets", "models", "axe_uncommon.glb")

COLORS = {
    "gun_wood": (0.30, 0.18, 0.09),
    "gun_steel": (0.38, 0.43, 0.51),
    "gun_trim": (0.56, 0.62, 0.70),
    "gun_cloth": (0.50, 0.45, 0.38),
    "gun_bore": (0.05, 0.035, 0.03),
}
PARTS = list(COLORS)

LENGTH = 142.0
WRIST_Y = 0.45        # source units (OBJ world Y, butt at +0.875, muzzle at -0.776)
BARREL_UP = 0.12      # source Z of the bore centre
CROSS = 1.25          # cross-section scale (the source is very thin)
MUZZLE_GROW = 1.12    # extra radial growth of the bell mouth


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


def import_source():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.wm.obj_import(filepath=os.path.join(REF, "guns", "rifledwarven.obj"))
    ob = next(o for o in bpy.data.objects if o.type == "MESH")
    ob.data.transform(ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    return ob


def src_preview(ob, path_dir):
    """Raw import with its original texture, unlit, from the side and 3/4."""
    nt = ob.data.materials[0].node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(os.path.join(REF, "gunracks", "dwarvenrifle01.png"))
    em = nt.nodes.new("ShaderNodeEmission")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(tex.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    for name, d in (("src_preview", (1, 0, 0)), ("src_3q", (1, -0.8, 0.5))):
        render(os.path.join(path_dir, name + ".png"), d, 2.0, ctr=(0, -0.05, 0.1), up=(0, 0, 1), dist=10)


def classify(bm):
    """Tag each face (int layer "part", index into PARTS) from the texture colour at its UV centroid."""
    img = bpy.data.images.load(os.path.join(REF, "gunracks", "dwarvenrifle01.png"))
    W, H = img.size
    px = list(img.pixels)
    uvl = bm.loops.layers.uv.active
    tag = bm.faces.layers.int.new("part")
    for f in bm.faces:
        u = sum(l[uvl].uv[0] for l in f.loops) / len(f.loops)
        v = sum(l[uvl].uv[1] for l in f.loops) / len(f.loops)
        i = (min(H - 1, max(0, int(v * H))) * W + min(W - 1, max(0, int(u * W)))) * 4
        h, s, val = colorsys.rgb_to_hsv(*px[i:i + 3])
        cy = f.calc_center_median().y
        if u > 0.84 and v > 0.55 and cy < -0.7:
            part = "gun_bore"
        elif v >= 0.5 and s < 0.3:
            part = "gun_trim" if val >= 0.85 else "gun_steel"
        elif cy > 0.77:
            part = "gun_steel"
        elif val >= 0.76:
            part = "gun_trim"
        else:
            part = "gun_wood"
        f[tag] = PARTS.index(part)


def to_gear_space(bm):
    """OBJ world (X side, Y long butt+, Z up) -> gear (Blender X lock side, Z long muzzle+, -Y up), wrist at origin."""
    xs = [v.co.x for v in bm.verts]
    xc = (min(xs) + max(xs)) / 2
    y_min = min(v.co.y for v in bm.verts)
    L = max(v.co.y for v in bm.verts) - y_min
    S = LENGTH / L
    for v in bm.verts:  # bell mouth: grow the first 20% (muzzle end) radially about the bore axis
        t = max(0.0, 1.0 - (v.co.y - y_min) / (0.2 * L))
        k = 1.0 + (MUZZLE_GROW - 1.0) * t * t * (3 - 2 * t)
        v.co.x = xc + (v.co.x - xc) * k
        v.co.z = BARREL_UP + (v.co.z - BARREL_UP) * k
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((-(x - xc) * S * CROSS, -(z - BARREL_UP) * S * CROSS, -(y - WRIST_Y) * S))
    return S


def orient_outward(bm):
    """recalc_face_normals keeps the mesh self-consistent; one global flip if most faces then look inward (bore
    faces are expected to look toward the spine). Disagreeing faces are only reported."""
    tag = bm.faces.layers.int["part"]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    verts = [v.co for v in bm.verts]
    votes, bad = 0, []
    for f in bm.faces:
        c = f.calc_center_median()
        near = sorted(verts, key=lambda p: abs(p.z - c.z))[:10]
        spine = sum(near, Vector()) / len(near)
        ok = (f.normal.dot(c - spine) > 0) == (PARTS[f[tag]] != "gun_bore")
        votes += 1 if ok else -1
        if not ok:
            bad.append(f.index)
    if votes < 0:
        for f in bm.faces:
            f.normal_flip()
        bad = [f.index for f in bm.faces if f.index not in bad]
    print("outward normals: global flip" if votes < 0 else "outward normals: kept", "- faces against the spine rule:", bad)


def slice_box(bm, z):
    """x half width and y range of the wood where the plane z cuts the mesh."""
    tag = bm.faces.layers.int["part"]
    pts = []
    for f in bm.faces:
        if PARTS[f[tag]] not in ("gun_wood", "gun_trim"):
            continue
        for e in f.edges:
            a, b = e.verts[0].co, e.verts[1].co
            if (a.z - z) * (b.z - z) < 0:
                t = (z - a.z) / (b.z - a.z)
                pts.append(a.lerp(b, t))
    return max(abs(p.x) for p in pts), min(p.y for p in pts), max(p.y for p in pts)


def add_wraps(bm):
    """Four wide cloth bands wound diagonally round the neck of the stock (tilted rings fitted to the wood section)."""
    tag = bm.faces.layers.int["part"]
    tilt, half = 0.55, 2.8
    for n, z0 in enumerate((-4.0, -8.2, -12.4, -16.6)):
        w, y0, y1 = slice_box(bm, z0)
        m = 0.6 if n % 2 == 0 else 0.25
        w, y0, y1 = w + m, y0 - m, y1 + m
        ch = 1.4
        loop = [(w - ch, y0), (w, y0 + ch), (w, y1 - ch), (w - ch, y1), (-w + ch, y1), (-w, y1 - ch), (-w, y0 + ch), (-w + ch, y0)]
        yc = (y0 + y1) / 2
        rings = [[bm.verts.new((x, y, z0 + dz + tilt * (y - yc))) for x, y in loop] for dz in (-half, half)]
        faces = []
        for i in range(8):
            j = (i + 1) % 8
            faces.append(bm.faces.new([rings[0][i], rings[0][j], rings[1][j], rings[1][i]]))
        faces.append(bm.faces.new(list(reversed(rings[0]))))
        faces.append(bm.faces.new(rings[1]))
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        for f in faces:
            f[tag] = PARTS.index("gun_cloth")


def configure_scene():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.57, 0.62, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    sc.world = world


def render(path, direction, ortho, ctr=(0, 0, 39), up=(0, -1, 0), res=(1600, 700), dist=400, lit=False):
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = res
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho
    cam_data.clip_end = 5000
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    d = Vector(direction).normalized()
    eye = Vector(ctr) + d * dist
    f = (Vector(ctr) - eye).normalized()
    r = f.cross(Vector(up)).normalized()
    u = r.cross(f)
    cam.matrix_world = Matrix(((r.x, u.x, -f.x, eye.x), (r.y, u.y, -f.y, eye.y), (r.z, u.z, -f.z, eye.z), (0, 0, 0, 1)))
    scene.camera = cam
    lights = []
    if lit:
        for name, energy, rot in (("sun", 3.0, (55, 15, -35)), ("fill", 1.2, (120, -20, 140))):
            ld = bpy.data.lights.new(name, "SUN")
            ld.energy = energy
            lo = bpy.data.objects.new(name, ld)
            scene.collection.objects.link(lo)
            lo.rotation_euler = tuple(math.radians(a) for a in rot)
            lights.append(lo)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in [cam] + lights:
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
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=AXE)
    axe = [o for o in bpy.data.objects if o not in before]
    for o in axe:
        if o.parent is None:
            o.location.y += 34
    gun.location.y = -48
    render(path, (1, 0, 0), 200, res=(1600, 1000), lit=True)
    gun.location.y = 0
    for o in axe:
        bpy.data.objects.remove(o, do_unlink=True)


def build():
    ob = import_source()
    if PREVIEW_DIR:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        configure_scene()
        src_preview(ob, PREVIEW_DIR)
        bpy.data.objects.remove(ob, do_unlink=True)
        ob = import_source()
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    classify(bm)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    scale = to_gear_space(bm)
    orient_outward(bm)
    add_wraps(bm)
    tag = bm.faces.layers.int["part"]
    for f in bm.faces:
        f.smooth = False
        f.material_index = f[tag]
    for layer in list(bm.loops.layers.uv):
        bm.loops.layers.uv.remove(layer)
    me = bpy.data.meshes.new("gun_common")
    bm.to_mesh(me)
    bm.free()
    for n in PARTS:
        me.materials.append(material(n))
    bpy.data.objects.remove(ob, do_unlink=True)
    out = bpy.data.objects.new("gun_common", me)
    bpy.context.scene.collection.objects.link(out)
    print("source scale", scale, "tris", sum(len(p.vertices) - 2 for p in me.polygons), "dims", tuple(round(x, 1) for x in out.dimensions))
    return out


def main():
    gun = build()
    export(gun)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    if PREVIEW_DIR:
        configure_scene()
        for m in gun.data.materials:
            m.use_backface_culling = True  # previews show inverted faces as holes
        render(os.path.join(PREVIEW_DIR, "gun_side.png"), (1, 0, 0), 170, lit=True)
        render(os.path.join(PREVIEW_DIR, "gun_side_other.png"), (-1, 0, 0), 170, lit=True)
        render(os.path.join(PREVIEW_DIR, "gun_3q.png"), (1.2, -0.7, 0.55), 170, lit=True)
        vs_axe(gun, os.path.join(PREVIEW_DIR, "gun_vs_axe.png"))
        for m in gun.data.materials:
            m.use_backface_culling = False
        bpy.ops.wm.save_as_mainfile(filepath=BLEND)


if __name__ == "__main__":
    main()
