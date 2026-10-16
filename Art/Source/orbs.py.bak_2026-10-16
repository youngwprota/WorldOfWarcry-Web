"""Buff orbs: glassy sphere + spinnable core (heart / die). Origin of every object = sphere centre, metres.

blender -b --factory-startup --python-exit-code 1 -P Art/Source/orbs.py -- [preview.png]
Output: Art/Source/orbs.blend, public/assets/models/orb_vigor.glb, orb_fury.glb (+ preview png when given).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = ARGS[0] if ARGS else None
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
BLEND = os.path.join(REPO, "Art", "Source", "orbs.blend")
MODELS = os.path.join(REPO, "public", "assets", "models")

R = 0.15
CORE_SIZE = R * 2 * 0.55


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for coll in (bpy.data.meshes, bpy.data.materials):
        for d in list(coll):
            coll.remove(d)


def glass_material(name, color):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Alpha"].default_value = 0.3
    b.inputs["Roughness"].default_value = 0.08
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Emission Color"].default_value = (*color, 1)
    b.inputs["Emission Strength"].default_value = 0.35
    m.use_backface_culling = False
    try:
        m.surface_render_method = "BLENDED"
    except Exception:
        pass
    try:
        m.blend_method = "BLEND"
    except Exception:
        pass
    return m


def core_material(name, color):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = 0.5
    b.inputs["Emission Color"].default_value = (*color, 1)
    b.inputs["Emission Strength"].default_value = 1.0
    return m


def flat_material(name, color):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = 0.7
    return m


def make_object(name, bm, mats, smooth, loc):
    bm.normal_update()
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for m in mats:
        mesh.materials.append(m)
    if smooth:
        mesh.shade_smooth()
    else:
        mesh.shade_flat()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = loc
    return obj


def sphere_bm():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=R)
    return bm


def heart_bm():
    """Heart as a pillow: outline ring (z=0), inner ring pushed out, apex vertex. 96 tris."""
    n = 16
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((x, y))
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    cx = (max(xs) + min(xs)) / 2
    cy = (max(ys) + min(ys)) / 2
    k = CORE_SIZE / (max(xs) - min(xs))
    pts = [((x - cx) * k, (y - cy) * k) for x, y in pts]
    depth = CORE_SIZE * 0.3

    bm = bmesh.new()
    mid = [bm.verts.new((x, y, 0)) for x, y in pts]
    rings = {}
    apex = {}
    for sgn in (1, -1):
        rings[sgn] = [bm.verts.new((x * 0.62, y * 0.62 - 0.004, sgn * depth * 0.7)) for x, y in pts]
        apex[sgn] = bm.verts.new((0, -0.004, sgn * depth))
    for sgn in (1, -1):
        for i in range(n):
            j = (i + 1) % n
            quad = [mid[i], mid[j], rings[sgn][j], rings[sgn][i]]
            bm.faces.new(quad if sgn == 1 else quad[::-1])
            tri = [rings[sgn][i], rings[sgn][j], apex[sgn]]
            bm.faces.new(tri if sgn == 1 else tri[::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    return bm


# face normal -> number of pips (opposite faces sum to 7)
PIPS = {(0, 0, 1): 1, (0, 0, -1): 6, (1, 0, 0): 2, (-1, 0, 0): 5, (0, 1, 0): 3, (0, -1, 0): 4}
PIP_GRID = {
    1: [(0, 0)],
    2: [(-1, -1), (1, 1)],
    3: [(-1, -1), (0, 0), (1, 1)],
    4: [(-1, -1), (1, -1), (-1, 1), (1, 1)],
    5: [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)],
    6: [(-1, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (1, 1)],
}


def die_bm():
    """Bevelled cube (edge = s) with pips as dark quads sitting just above each face. Returns bm; pips use material 1."""
    s = CORE_SIZE / math.sqrt(3) * 1.15
    h = s / 2
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=s)
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=s * 0.1, segments=1, affect="EDGES")
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    pip_half = s * 0.065
    step = s * 0.26
    for normal, count in PIPS.items():
        n = Vector(normal)
        up = Vector((0, 0, 1)) if abs(n.z) < 0.5 else Vector((0, 1, 0))
        u = n.cross(up).normalized()
        v = n.cross(u).normalized()
        for a, b in PIP_GRID[count]:
            c = n * (h + s * 0.004) + u * a * step + v * b * step
            vs = [bm.verts.new(c + u * sx * pip_half + v * sy * pip_half)
                  for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            f = bm.faces.new(vs)
            if f.normal.dot(n) < 0:
                f.normal_flip()
            f.material_index = 1
            bmesh.ops.triangulate(bm, faces=[f])
    return bm


def build(prefix, glass_color, core_color, core_bm, core_rot, loc, extra_mats=()):
    gm = glass_material(f"orb_glass_{prefix[1]}", glass_color)
    cm = core_material(f"orb_core_{prefix[1]}", core_color)
    sph = make_object(prefix[0], sphere_bm(), [gm], True, loc)
    core = make_object(prefix[0] + "_core", core_bm, [cm, *extra_mats], False, loc)
    if core_rot:
        core.data.transform(Euler(core_rot).to_matrix().to_4x4())
    return sph, core


def export(objs, path):
    saved = [o.location.copy() for o in objs]
    for o in objs:
        o.location = (0, 0, 0)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_cameras=False, export_lights=False)
    for o, l in zip(objs, saved):
        o.location = l


def render_preview(path):
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except Exception:
        sc.render.engine = "BLENDER_WORKBENCH"
    sc.render.resolution_x, sc.render.resolution_y = 1200, 600
    sc.render.filepath = path
    sc.world = bpy.data.worlds.new("w")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.09, 0.1, 0.13, 1)
    bg.inputs["Strength"].default_value = 1.0
    # checker floor behind so the alpha is readable
    bpy.ops.mesh.primitive_plane_add(size=2, location=(0, 0.3, 0), rotation=(math.pi / 2, 0, 0))
    wall = bpy.context.active_object
    wm = flat_material("preview_wall", (0.35, 0.37, 0.42))
    wall.data.materials.append(wm)
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    cam.location = (0, -2.4, 0.0)
    cam.rotation_euler = (math.radians(90), 0, 0)
    cam_data.lens = 85
    sc.camera = cam
    sun_d = bpy.data.lights.new("sun", "SUN")
    sun_d.energy = 3
    sun = bpy.data.objects.new("sun", sun_d)
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    sc.collection.objects.link(sun)
    bpy.ops.render.render(write_still=True)


def main():
    clear_scene()
    pip = flat_material("orb_core_red_pips", (0.08, 0.0, 0.0))
    vs, vc = build(("orb_vigor", "green"), (0.1, 1.0, 0.25), (0.55, 1.0, 0.7), heart_bm(), (math.radians(90), 0, 0), (-0.2, 0, 0))
    fs, fc = build(("orb_fury", "red"), (1.0, 0.08, 0.05), (1.0, 0.3, 0.08), die_bm(),
                   (math.radians(35.3), math.radians(45), math.radians(10)), (0.2, 0, 0), [pip])

    os.makedirs(MODELS, exist_ok=True)
    export([vs, vc], os.path.join(MODELS, "orb_vigor.glb"))
    export([fs, fc], os.path.join(MODELS, "orb_fury.glb"))

    for o in (vs, vc, fs, fc):
        print("TRIS", o.name, sum(len(p.vertices) - 2 for p in o.data.polygons))

    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    if PREVIEW:
        render_preview(PREVIEW)


main()
