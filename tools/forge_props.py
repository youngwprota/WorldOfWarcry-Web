# Props for the gacha forge scene (docs/features/ludka), built procedurally so the art is reproducible.
# Run: "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --factory-startup --python tools/forge_props.py
# Output: public/assets/models/forge.glb with objects ingot, hearth, coals, embers, floor (metres, Y up after export).
# Materials carry only flat base colours; the game swaps them for Lambert / emissive ones by name.
import math
import os
import random

import bmesh
import bpy

random.seed(7)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'assets', 'models', 'forge.glb')

bpy.ops.wm.read_factory_settings(use_empty=True)

MATS = {}


def mat(name, rgb):
    if name not in MATS:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*rgb, 1)
        bsdf.inputs['Roughness'].default_value = 0.9
        MATS[name] = m
    return MATS[name]


def obj_from_bm(name, bm, materials):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in materials:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def jitter(bm, verts, amount):
    for v in verts:
        v.co.x += random.uniform(-amount, amount)
        v.co.y += random.uniform(-amount, amount)
        v.co.z += random.uniform(-amount, amount)


def rock(bm, center, size, squash=0.6, subdiv=1, mat_index=0, rough=0.18):
    """Low-poly faceted rock: a jittered icosphere."""
    res = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    verts = res['verts']
    jitter(bm, verts, rough)
    rz = random.uniform(0, math.tau)
    for v in verts:
        x, y, z = v.co.x * size[0], v.co.y * size[1], v.co.z * size[2] * squash
        c, s = math.cos(rz), math.sin(rz)
        v.co.x, v.co.y, v.co.z = center[0] + x * c - y * s, center[1] + x * s + y * c, center[2] + z
    for f in {f for v in verts for f in v.link_faces}:
        f.material_index = mat_index


# ---------- ingot: a hot blade blank, 0.55 m long, tapered towards the tip ----------
bm = bmesh.new()
res = bmesh.ops.create_cube(bm, size=1.0)
for v in res['verts']:
    v.co.x *= 0.55
    v.co.y *= 0.16
    v.co.z *= 0.07
    if v.co.x > 0:  # tip: narrower and thinner
        v.co.y *= 0.45
        v.co.z *= 0.7
bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.012, segments=1, affect='EDGES')
obj_from_bm('ingot', bm, [mat('Hot', (1.0, 0.55, 0.2))])

# ---------- hearth: ring of rough stones around a coal bed ----------
bm = bmesh.new()
R = 0.85
for i in range(11):
    a = i / 11 * math.tau + random.uniform(-0.08, 0.08)
    s = random.uniform(0.26, 0.34)
    rock(bm, (math.cos(a) * R, math.sin(a) * R, 0.16), (s, s * 0.9, s), squash=0.95, mat_index=i % 2)
    # second course on top, offset by half a stone
    a2 = a + math.pi / 11
    s2 = random.uniform(0.2, 0.26)
    rock(bm, (math.cos(a2) * R * 0.97, math.sin(a2) * R * 0.97, 0.42), (s2, s2 * 0.9, s2), squash=0.8, mat_index=(i + 1) % 2)
obj_from_bm('hearth', bm, [mat('Stone', (0.42, 0.4, 0.43)), mat('StoneDark', (0.3, 0.28, 0.32))])

# ---------- coals: dark lumps; embers: glowing lumps between them (separate object = own material) ----------
bm = bmesh.new()
bm_e = bmesh.new()
for i in range(34):
    r = math.sqrt(random.random()) * (R - 0.25)
    a = random.uniform(0, math.tau)
    s = random.uniform(0.07, 0.13)
    hot = random.random() < 0.38
    rock(bm_e if hot else bm, (math.cos(a) * r, math.sin(a) * r, 0.3 + random.uniform(0, 0.08)), (s, s, s), squash=0.7, subdiv=0 if s < 0.1 else 1, rough=0.25)
obj_from_bm('coals', bm, [mat('Coal', (0.08, 0.07, 0.07))])
obj_from_bm('embers', bm_e, [mat('Ember', (1.0, 0.35, 0.08))])

# ---------- floor: round platform of flagstones ----------
bm = bmesh.new()
rings = [(0, 1, 0.55), (0.95, 7, 0.42), (1.85, 12, 0.42), (2.75, 17, 0.4)]
for rad, n, size in rings:
    for i in range(n):
        a = i / n * math.tau + (0.2 if rad > 2 else 0)
        cx, cy = math.cos(a) * rad, math.sin(a) * rad
        res = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=size, radius2=size * 0.92, depth=0.12)
        h = random.uniform(-0.025, 0.025)
        rz = random.uniform(0, math.tau)
        for v in res['verts']:
            x, y = v.co.x, v.co.y
            c, s = math.cos(rz), math.sin(rz)
            v.co.x = cx + x * c - y * s + random.uniform(-0.03, 0.03)
            v.co.y = cy + x * s + y * c + random.uniform(-0.03, 0.03)
            v.co.z += -0.06 + h
        for f in {f for v in res['verts'] for f in v.link_faces}:
            f.material_index = random.randrange(2)
obj_from_bm('floor', bm, [mat('Stone', (0.42, 0.4, 0.43)), mat('StoneDark', (0.3, 0.28, 0.32))])

tris = 0
for ob in bpy.data.objects:
    ob.data.calc_loop_triangles()
    tris += len(ob.data.loop_triangles)
    print(f'{ob.name}: {len(ob.data.loop_triangles)} tris')
print('total tris', tris)

bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB', export_apply=True, export_yup=True)
print('written', os.path.abspath(OUT))
