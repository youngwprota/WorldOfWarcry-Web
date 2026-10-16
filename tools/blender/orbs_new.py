"""New buff orbs on top of Art/Source/orbs.py helpers: glass, swift, ward, fortune, demon.
Same conventions as orb_vigor/orb_fury: origin = sphere centre, metres, glass sphere R=0.15, spinnable `<name>_core`.

blender -b --factory-startup --python-exit-code 1 -P tools/blender/orbs_new.py -- [preview.png]
Output: Art/Source/orbs_new.blend, public/assets/models/orb_{glass,swift,ward,fortune,demon}.glb (+ preview sheet).
"""
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
sys.path.insert(0, os.path.join(REPO, "Art", "Source"))
import orbs as O  # noqa: E402  (main() is guarded, importing only brings the helpers)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = ARGS[0] if ARGS else None
BLEND = os.path.join(REPO, "Art", "Source", "orbs_new.blend")
R = O.R


def mat(name, color, rough=0.6, emit=None, emit_k=0.0, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit is not None:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = emit_k
    return m


def glass(name, color, emit_k=0.35):
    m = O.glass_material(name, color)
    m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = emit_k
    return m


def merge(dst, src, mat_index):
    """Copy src bmesh into dst, all faces on material slot mat_index."""
    vmap = {v: dst.verts.new(v.co) for v in src.verts}
    for f in src.faces:
        nf = dst.faces.new([vmap[v] for v in f.verts])
        nf.material_index = mat_index
    src.free()


def prism_bm(pts, half):
    """Extrude a convex 2D polygon (XZ plane, ccw seen from -Y) to a plate of thickness 2*half along Y."""
    bm = bmesh.new()
    front = [bm.verts.new((x, -half, z)) for x, z in pts]
    back = [bm.verts.new((x, half, z)) for x, z in pts]
    n = len(pts)
    bm.faces.new(front)
    bm.faces.new(back[::-1])
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([front[i], back[i], back[j], front[j]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    return bm


def triangle_pts(r, up):
    s = 1 if up else -1
    return [(r * s * math.cos(math.radians(90 + 120 * i)), r * s * math.sin(math.radians(90 + 120 * i))) for i in range(3)]


def swift_core_bm():
    """Two triangles (star of David) as thin plates, one inverted, offset along Y so they never z-fight."""
    bm = bmesh.new()
    a = prism_bm(triangle_pts(0.095, True), 0.006)
    a.transform(Matrix.Translation((0, -0.0075, -0.012)))
    b = prism_bm(triangle_pts(0.095, False), 0.006)
    b.transform(Matrix.Translation((0, 0.0075, 0.012)))
    merge(bm, a, 0)
    merge(bm, b, 1)
    return bm


def gem_bm():
    """Elongated hexagonal bipyramid with a short girdle: a cut diamond. 24 tris."""
    n = 6
    rg, zg, zt = 0.068, 0.028, 0.105
    bm = bmesh.new()
    top = bm.verts.new((0, 0, zt))
    bot = bm.verts.new((0, 0, -zt))
    up = [bm.verts.new((rg * math.cos(2 * math.pi * i / n), rg * math.sin(2 * math.pi * i / n), zg)) for i in range(n)]
    lo = [bm.verts.new((rg * math.cos(2 * math.pi * i / n), rg * math.sin(2 * math.pi * i / n), -zg)) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([top, up[i], up[j]])
        bm.faces.new([bot, lo[j], lo[i]])
        bm.faces.new([up[i], lo[i], lo[j], up[j]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    return bm


def coin_bm():
    """Coin standing on its edge (disc in XZ): rim body + raised inner disc on both faces. Mat 0 rim, mat 1 emboss."""
    n = 16
    rad, half = 0.068, 0.0075
    bm = bmesh.new()
    cyl = bmesh.new()
    bmesh.ops.create_cone(cyl, cap_ends=True, segments=n, radius1=rad, radius2=rad, depth=half * 2)
    cyl.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    merge(bm, cyl, 0)
    for s in (1, -1):
        e = bmesh.new()
        bmesh.ops.create_cone(e, cap_ends=True, segments=n, radius1=rad * 0.68, radius2=rad * 0.68, depth=0.004)
        e.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
        e.transform(Matrix.Translation((0, s * (half + 0.0016), 0)))
        merge(bm, e, 1)
    bm.transform(Euler((math.radians(12), 0, 0)).to_matrix().to_4x4())
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    return bm


def rock_bm(rng, size):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=size)
    sx, sy, sz = rng.uniform(0.8, 1.25), rng.uniform(0.7, 1.1), rng.uniform(0.65, 1.0)
    for v in bm.verts:
        j = rng.uniform(0.78, 1.18)
        v.co = Vector((v.co.x * sx * j, v.co.y * sy * j, v.co.z * sz * j))
    bm.transform(Euler((rng.uniform(0, 6.28), rng.uniform(0, 6.28), rng.uniform(0, 6.28))).to_matrix().to_4x4())
    return bm


def rock_ring(bm, rng, count, r_lo, r_hi, size_lo, size_hi, z_spread, tilt, mat_index):
    """Rocks scattered round the equator, then the whole belt tilted about X."""
    tmp = bmesh.new()
    for i in range(count):
        a = 2 * math.pi * (i + rng.uniform(-0.3, 0.3)) / count
        r = rng.uniform(r_lo, r_hi)
        rk = rock_bm(rng, rng.uniform(size_lo, size_hi))
        rk.transform(Matrix.Translation((r * math.cos(a), r * math.sin(a), rng.uniform(-z_spread, z_spread))))
        merge(tmp, rk, mat_index)
    tmp.transform(Matrix.Rotation(math.radians(tilt), 4, "X"))
    merge(bm, tmp, mat_index)


def band_bm(r_in, r_out, half, segs):
    """Flat ring (washer) in the XY plane."""
    bm = bmesh.new()
    top_i, top_o, bot_i, bot_o = [], [], [], []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        c, s = math.cos(a), math.sin(a)
        top_i.append(bm.verts.new((r_in * c, r_in * s, half)))
        top_o.append(bm.verts.new((r_out * c, r_out * s, half)))
        bot_i.append(bm.verts.new((r_in * c, r_in * s, -half)))
        bot_o.append(bm.verts.new((r_out * c, r_out * s, -half)))
    for i in range(segs):
        j = (i + 1) % segs
        bm.faces.new([top_i[i], top_o[i], top_o[j], top_i[j]])
        bm.faces.new([bot_i[j], bot_o[j], bot_o[i], bot_i[i]])
        bm.faces.new([top_o[i], bot_o[i], bot_o[j], top_o[j]])
        bm.faces.new([top_i[j], bot_i[j], bot_i[i], top_i[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    return bm


def horn_bm(side, a_deg=40.0, phi0=38.0, phi1=-22.0, length=0.17, r0=0.032, steps=7, sides=6):
    """Curved tapering horn in the XZ plane growing out of the sphere top at +-a_deg from the pole; the tip curls inward."""
    a = math.radians(a_deg)
    p = Vector((side * R * 0.97 * math.sin(a), 0, R * 0.97 * math.cos(a)))
    pts, tans = [], []
    seg = length / steps
    for i in range(steps + 1):
        t = i / steps
        phi = math.radians(phi0 + (phi1 - phi0) * t ** 0.85)
        d = Vector((side * math.sin(phi), 0, math.cos(phi)))
        pts.append(p.copy())
        tans.append(d)
        p = p + d * seg
    bm = bmesh.new()
    rings = []
    for i, (pt, d) in enumerate(zip(pts, tans)):
        t = i / steps
        rad = r0 * (1 - t) ** 0.9 + 0.0025
        nrm = Vector((0, 1, 0)).cross(d).normalized()
        ring = []
        for k in range(sides):
            ang = 2 * math.pi * k / sides
            ring.append(bm.verts.new(pt + (Vector((0, 1, 0)) * math.cos(ang) + nrm * math.sin(ang)) * rad))
        rings.append(ring)
    tip = bm.verts.new(pts[-1] + tans[-1] * seg * 0.9)
    for i in range(steps):
        for k in range(sides):
            j = (k + 1) % sides
            bm.faces.new([rings[i][k], rings[i + 1][k], rings[i + 1][j], rings[i][j]])
    for k in range(sides):
        j = (k + 1) % sides
        bm.faces.new([rings[-1][k], tip, rings[-1][j]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    return bm


def sphere(name, gm, loc):
    return O.make_object(name, O.sphere_bm(), [gm], True, loc)


def build_glass(loc):
    return [sphere("orb_glass", glass("orb_glass_grey", (0.62, 0.64, 0.7), 0.15), loc)]


def build_swift(loc):
    s = sphere("orb_swift", glass("orb_glass_blue", (0.12, 0.42, 1.0)), loc)
    mats = [O.core_material("orb_core_blue_a", (0.15, 0.5, 1.0)), O.core_material("orb_core_blue_b", (0.5, 0.82, 1.0))]
    for m in mats:
        m.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.5
    c = O.make_object("orb_swift_core", swift_core_bm(), mats, False, loc)
    return [s, c]


def build_ward(loc):
    s = sphere("orb_ward", glass("orb_glass_purple", (0.55, 0.15, 0.95)), loc)
    gem = O.core_material("orb_core_purple", (0.68, 0.28, 1.0))
    gem.node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.5
    c = O.make_object("orb_ward_core", gem_bm(), [gem], False, loc)
    return [s, c]


def build_fortune(loc):
    rng = random.Random(7)
    s = sphere("orb_fortune", glass("orb_glass_gold", (0.92, 0.62, 0.08), 0.15), loc)
    bm = coin_bm()
    coin_mats = [O.core_material("orb_core_coin", (0.95, 0.72, 0.18)), O.core_material("orb_core_coin_emboss", (0.78, 0.55, 0.1))]
    coin_mats[0].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.45
    coin_mats[1].node_tree.nodes["Principled BSDF"].inputs["Emission Strength"].default_value = 0.3
    stone = mat("orb_pebble", (0.5, 0.4, 0.27), 0.9, (0.5, 0.4, 0.27), 0.12)
    rock_ring(bm, rng, 10, 0.195, 0.225, 0.015, 0.027, 0.012, 22, 2)
    c = O.make_object("orb_fortune_core", bm, [*coin_mats, stone], False, loc)
    return [s, c]


def build_demon(loc):
    rng = random.Random(13)
    gm = O.glass_material("orb_glass_red", (1.0, 0.08, 0.05))
    cm = O.core_material("orb_core_red", (1.0, 0.3, 0.08))
    pip = O.flat_material("orb_core_red_pips", (0.08, 0.0, 0.0))
    ember = mat("orb_demon_belt", (0.55, 0.08, 0.03), 0.6, (1.0, 0.22, 0.04), 0.4)
    rock = mat("orb_demon_rock", (0.2, 0.1, 0.09), 0.9, (0.7, 0.1, 0.03), 0.25)
    horn = mat("orb_demon_horn", (0.9, 0.1, 0.02), 0.45, (1.0, 0.22, 0.02), 1.3)
    s = sphere("orb_demon", gm, loc)

    bm = O.die_bm()
    bm.transform(Euler((math.radians(35.3), math.radians(45), math.radians(10))).to_matrix().to_4x4())
    tilt = 24
    belt = band_bm(0.195, 0.218, 0.003, 32)
    belt.transform(Matrix.Rotation(math.radians(tilt), 4, "X"))
    merge(bm, belt, 2)
    rock_ring(bm, rng, 9, 0.195, 0.25, 0.012, 0.024, 0.03, tilt, 3)
    c = O.make_object("orb_demon_core", bm, [cm, pip, ember, rock], False, loc)

    hb = bmesh.new()
    merge(hb, horn_bm(1), 0)
    merge(hb, horn_bm(-1), 0)
    h = O.make_object("orb_demon_horns", hb, [horn], False, loc)
    return [s, c, h]


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def render_sheet(path, groups, step):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    n = len(groups)
    sc.render.resolution_x, sc.render.resolution_y = 400 * n, 520
    sc.render.filepath = path
    sc.view_settings.view_transform = "Standard"
    sc.world = bpy.data.worlds.new("w")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.09, 0.1, 0.13, 1)
    bg.inputs["Strength"].default_value = 1.0
    mid = (n - 1) * step / 2
    bpy.ops.mesh.primitive_plane_add(size=1, location=(mid, 0.4, 0.0), rotation=(math.pi / 2, 0, 0))
    wall = bpy.context.active_object
    wall.scale = (n * step * 1.2, 1.2, 1)
    wall.data.materials.append(O.flat_material("preview_wall", (0.33, 0.35, 0.4)))
    cd = bpy.data.cameras.new("cam")
    cd.type = "ORTHO"
    cd.ortho_scale = n * step
    cam = bpy.data.objects.new("cam", cd)
    sc.collection.objects.link(cam)
    cam.location = (mid, -3, 0.03)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = cam
    sun_d = bpy.data.lights.new("sun", "SUN")
    sun_d.energy = 3
    sun_d.use_shadow = False
    sun = bpy.data.objects.new("sun", sun_d)
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    sc.collection.objects.link(sun)
    bpy.ops.render.render(write_still=True)


def main():
    O.clear_scene()
    step = 0.7
    builders = [build_glass, build_swift, build_ward, build_fortune, build_demon]
    groups = [b((i * step, 0, 0)) for i, b in enumerate(builders)]
    os.makedirs(O.MODELS, exist_ok=True)
    for g in groups:
        O.export(g, os.path.join(O.MODELS, g[0].name + ".glb"))
        for o in g:
            print("TRIS", o.name, tris(o))
    bpy.ops.wm.save_as_mainfile(filepath=BLEND)
    if PREVIEW:
        render_sheet(PREVIEW, groups, step)


main()
