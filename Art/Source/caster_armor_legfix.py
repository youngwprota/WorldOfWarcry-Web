"""Leg skinning fix + human pauldron recolour for caster_armor_rigged.blend.

Run:  blender -b caster_armor_rigged.blend --factory-startup -P caster_armor_legfix.py -- <test|fix>
  test  only runs the pose stretch test (no changes)
  fix   fixes opposite-leg weights in legs_caster_*, recolours human pauldrons, runs the test, saves the .blend

Leg fix: legs meshes are split into topological islands (shared vertex index through faces). Islands that touch by
position only (two trim rings crossing at the midline) stay separate. An island with weights on both _l and _r bones
gets every minority-side weight moved to the mirrored bone of the majority side (tie -> side of the island centroid),
then weights are limited to 4 influences and normalised.
"""
import bpy, sys, math, collections
from mathutils import Matrix, Vector

RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']
MODE = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'test'


def side(n):
    if n.endswith('_l'):
        return 'L'
    if n.endswith('_r'):
        return 'R'
    return 'C'


def mirror(n):
    return n[:-2] + ('_r' if n.endswith('_l') else '_l')


def index_islands(me):
    par = list(range(len(me.vertices)))

    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a
    for p in me.polygons:
        for v in p.vertices[1:]:
            par[find(p.vertices[0])] = find(v)
    isl = collections.defaultdict(list)
    for v in me.vertices:
        isl[find(v.index)].append(v.index)
    return list(isl.values())


def island_weights(o, vs):
    vg = {g.index: g.name for g in o.vertex_groups}
    w = collections.Counter()
    for vi in vs:
        for g in o.data.vertices[vi].groups:
            w[side(vg[g.group])] += g.weight
    return w


def fix_legs(o):
    me = o.data
    vg_name = {g.index: g.name for g in o.vertex_groups}
    fixed = []
    for vs in index_islands(me):
        w = island_weights(o, vs)
        if w['L'] < 1e-6 or w['R'] < 1e-6:
            continue
        cx = sum(me.vertices[v].co.x for v in vs) / len(vs)
        if abs(w['L'] - w['R']) < 1e-6:
            maj = 'L' if cx > 0 else 'R'
        else:
            maj = 'L' if w['L'] > w['R'] else 'R'
        mino = 'R' if maj == 'L' else 'L'
        for vi in vs:
            v = me.vertices[vi]
            nw = collections.defaultdict(float)
            for g in v.groups:
                n = vg_name[g.group]
                nw[mirror(n) if side(n) == mino else n] += g.weight
            top = sorted(nw.items(), key=lambda kv: -kv[1])[:4]
            tot = sum(x for _, x in top) or 1.0
            for g in list(v.groups):
                o.vertex_groups[g.group].remove([vi])
            for n, x in top:
                vgrp = o.vertex_groups.get(n) or o.vertex_groups.new(name=n)
                vgrp.add([vi], x / tot, 'REPLACE')
        fixed.append((len(vs), maj, round(cx, 1), {k: round(x, 1) for k, x in w.items()}))
    return fixed


def rot_about_head(arm, bone, axis, deg):
    pb = arm.pose.bones[bone]
    head = arm.data.bones[bone].head_local
    # pivot = current posed head position
    cur_head = pb.matrix.translation.copy()
    R = Matrix.Rotation(math.radians(deg), 4, axis)
    T = Matrix.Translation(cur_head)
    pb.matrix = T @ R @ T.inverted() @ pb.matrix
    bpy.context.view_layer.update()


def set_pose(arm, spec):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    for bone, axis, deg in spec:
        rot_about_head(arm, bone, axis, deg)


POSES = {
    'walk_a': [('thigh_l', 'X', 40), ('calf_l', 'X', -55), ('foot_l', 'X', 20), ('thigh_r', 'X', -30), ('foot_r', 'X', -10)],
    'walk_b': [('thigh_r', 'X', 40), ('calf_r', 'X', -55), ('foot_r', 'X', 20), ('thigh_l', 'X', -30), ('foot_l', 'X', -10)],
    'wide': [('thigh_l', 'Z', 25), ('thigh_r', 'Z', -25), ('foot_l', 'Z', -15), ('foot_r', 'Z', 15)],
    'cross': [('thigh_l', 'Z', -25), ('thigh_r', 'Z', 25), ('calf_l', 'X', 30), ('calf_r', 'X', -30)],
}


def evaluated_verts(o):
    dg = bpy.context.evaluated_depsgraph_get()
    eo = o.evaluated_get(dg)
    m = eo.to_mesh()
    pts = [v.co.copy() for v in m.vertices]
    eo.to_mesh_clear()
    return pts


def vert_sides(o):
    vg = {g.index: g.name for g in o.vertex_groups}
    return [{side(vg[g.group]) for g in v.groups if g.weight > 1e-4} - {'C'} for v in o.data.vertices]


def stretch_test(fac, rar):
    """Returns (worst cross-leg edge ratio, pose), (worst edge ratio overall, pose). Cross-leg = one end on _l bones, the other on _r."""
    arm = bpy.data.objects[f'Armature_{fac}']
    o = bpy.data.objects[f'legs_caster_{fac}_{rar}']
    sides = vert_sides(o)
    set_pose(arm, [])
    rest = evaluated_verts(o)
    edges = [(e.vertices[0], e.vertices[1]) for e in o.data.edges]
    cross, allw = (1.0, None), (1.0, None)
    for name, spec in POSES.items():
        set_pose(arm, spec)
        pts = evaluated_verts(o)
        for a, b in edges:
            r0 = (rest[a] - rest[b]).length
            if r0 < 0.05:
                continue
            r = (pts[a] - pts[b]).length / r0
            if r > allw[0]:
                allw = (r, name)
            if (('L' in sides[a] and 'R' in sides[b]) or ('R' in sides[a] and 'L' in sides[b])) and r > cross[0]:
                cross = (r, name)
    set_pose(arm, [])
    return cross, allw


def run_tests(tag):
    for fac in ('human', 'orc'):
        for r in RARITIES:
            (cw, cp), (aw, ap) = stretch_test(fac, r)
            print(f'STRETCH[{tag}] {fac:5s} {r:10s} cross-leg edges max {cw:5.2f} ({cp}){"  <-- BAD" if cw > 2 else ""}   all edges max {aw:5.2f} ({ap})')


def fix_pads():
    for r in RARITIES:
        o = bpy.data.objects[f'chest_caster_human_{r}']
        me = o.data
        vg = {g.index: g.name for g in o.vertex_groups}
        main = bpy.data.materials[f'torso_{r}']
        slot = next((i for i, s in enumerate(o.material_slots) if s.material == main), None)
        if slot is None:
            o.data.materials.append(main)
            slot = len(o.material_slots) - 1
        metal = f'torso_{r}_metal'
        moved = glow = 0
        for p in me.polygons:
            pad = sum(sum(g.weight for g in me.vertices[v].groups if vg[g.group].startswith('sholder_pad')) for v in p.vertices) / len(p.vertices)
            if pad <= 0.5:
                continue
            mn = o.material_slots[p.material_index].material.name
            if mn == metal:
                p.material_index = slot
                moved += 1
            elif mn.endswith('_glow'):
                glow += 1
        print(f'PADS {r}: metal->torso_{r} {moved} faces, glow kept {glow}')


if MODE == 'test':
    run_tests('current')
elif MODE == 'fix':
    run_tests('before')
    for fac in ('human', 'orc'):
        for r in RARITIES:
            fx = fix_legs(bpy.data.objects[f'legs_caster_{fac}_{r}'])
            print(f'FIXED {fac} {r}: {len(fx)} islands {fx}')
    run_tests('after')
    fix_pads()
    bpy.ops.wm.save_mainfile()
    print('SAVED')
