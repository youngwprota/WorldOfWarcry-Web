"""Removes the orc caster's thigh/knee geometry hidden under the kilt, in caster_armor_rigged.blend.

Run:  blender -b Art/Source/caster_armor_rigged.blend --factory-startup -P caster_orc_kilt_fix.py -- <dry|fix>
  dry  prints what would be removed per rarity
  fix  deletes it and saves the .blend (re-export with caster_armor_export.py afterwards)
  feet_dry / feet   round 2 (run AFTER fix): keep only the feet, see "Step 3" below
  base_dry / base   BASE hero model (no armour): run WITHOUT a .blend, it imports public/assets/models/orc_shaman.fbx,
                    applies the same fix, exports it back (original first copied to Art/Source/backup/), see "Step 4"

Why: legs_caster_orc_<rarity> is one mesh = leg_orc_shaman + kilt_orc_shaman1. The kilt is skinned to the (unanimated)
kilt_* bones, so it stays put while the Walk clip swings the thighs up to ~60 deg; thigh tubes and knee pads then stick
out through the skirt. Boots/feet (closed solids, y -1.4..16 cm), the cuff rings and spikes on them and the whole kilt
(its waist edge touches the chest part) are kept, so nothing opens at the hem or the waist.

Rule (topological islands, same split as caster_armor_legfix.py): an island is removed when >= 95% of its skin weight
is on thigh_*/calf_* bones and it lies fully above the boot cuff (min y >= 11 cm). That picks the thigh+calf tube
(y 11.5..54.9) and the knee pad (y 25.6..38.6) of each leg; foot/ball-weighted boots and the mixed-weight cuff
rings/studs stay.

Step 2 (kilt follows the legs): with the tubes gone the boots still swing out in front of the rigid skirt. Kilt-island
vertices below the waist band (y < KILT_FREE_Y) therefore also get skin weight on thigh_l/thigh_r, growing smoothly
with depth up to KILT_MAX_W at the hem; the thigh is picked by the vertex x (blended across the centre line). Waist
vertices keep their original weights, so the kilt stays glued to the chest/belt. Skipped when a kilt vertex already
has thigh weight (idempotent).

Step 3 (round 2, "feet" mode): the user wants only the feet visible under the hem. Cut height = ANKLE_Y = 11 cm (foot bone
head y = 10.7 cm, boot cuff ring bottom 15.9, studs 13.5, spikes 11.8). Every non-kilt island fully above that is deleted:
cuff rings, studs, spikes. Islands are whole closed solids, so the cut leaves no open edges. The green foot solids
(y -1.4..16.1, 100% foot/ball weights), toe claws/spikes (y < 11.4, ball weights) and the whole kilt are untouched.

Step 4 ("base" mode): public/assets/models/orc_shaman.fbx (base orc mage, also the Black Rock shaman / tauren_totem / dune
mystics) has the same problem: leg_orc_shaman (thighs, calves, boots) and kilt_orc_shaman1 are SEPARATE meshes there.
Same fix: every leg_orc_shaman island above ANKLE_Y goes (feet stay), every kilt vertex gets the thigh weights of step 2.
Part names, bones, materials, hips/chest/arms/head are untouched; FBX written with the caster-export settings except
use_triangles=False (the original orc_shaman.fbx keeps its quads).
"""
import bpy, bmesh, sys, collections

sys.argv_backup = sys.argv
MODE = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'dry'
sys.argv = ['x']
exec(open('C:/Unity proj/WorldOfWarcry-Web/Art/Source/caster_armor_legfix.py').read().split("if MODE == 'test'")[0])
MODE = sys.argv_backup[sys.argv_backup.index('--') + 1] if '--' in sys.argv_backup else 'dry'

MIN_Y = 11.0
LEG_SHARE = 0.95
KILT_FREE_Y, KILT_HEM_Y, KILT_MAX_W, CENTRE_BLEND_X = 50.0, 7.0, 0.3, 12.0


def smooth(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def kilt_islands(o):
    me = o.data
    vg = {g.index: g.name for g in o.vertex_groups}
    out = []
    for vs in index_islands(me):
        w = collections.Counter()
        for vi in vs:
            for g in me.vertices[vi].groups:
                n = vg[g.group]
                w['kilt' if n.startswith(('kilt', 'pelvis')) else 'other'] += g.weight
        if w['kilt'] > w['other']:
            out.append(vs)
    return out


def kilt_follow_legs(o):
    me = o.data
    names = {g.index: g.name for g in o.vertex_groups}
    moved = 0
    for vs in kilt_islands(o):
        if any(names[g.group].startswith('thigh') for vi in vs for g in me.vertices[vi].groups):
            return -1
        for vi in vs:
            v = me.vertices[vi]
            d = smooth((KILT_FREE_Y - v.co.y) / (KILT_FREE_Y - KILT_HEM_Y)) * KILT_MAX_W
            if d <= 1e-4:
                continue
            sx = smooth(abs(v.co.x) / CENTRE_BLEND_X) * (1 if v.co.x > 0 else -1)
            nw = collections.defaultdict(float)
            for g in v.groups:
                nw[names[g.group]] += g.weight * (1 - d)
            nw['thigh_l'] += d * (0.5 + 0.5 * sx)
            nw['thigh_r'] += d * (0.5 - 0.5 * sx)
            top = sorted(nw.items(), key=lambda kv: -kv[1])[:4]
            tot = sum(x for _, x in top)
            for g in list(v.groups):
                o.vertex_groups[g.group].remove([vi])
            for n, x in top:
                (o.vertex_groups.get(n) or o.vertex_groups.new(name=n)).add([vi], x / tot, 'REPLACE')
            moved += 1
    return moved


def leg_islands(o):
    me = o.data
    vg = {g.index: g.name for g in o.vertex_groups}
    out = []
    for vs in index_islands(me):
        w = collections.Counter()
        for vi in vs:
            for g in me.vertices[vi].groups:
                n = vg[g.group]
                w['leg' if n.startswith(('thigh', 'calf')) else 'other'] += g.weight
        tot = w['leg'] + w['other']
        ymin = min(me.vertices[v].co.y for v in vs)
        if tot > 0 and w['leg'] / tot >= LEG_SHARE and ymin >= MIN_Y:
            out.append(vs)
    return out


def remove_islands(o, islands):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    doomed = {v for vs in islands for v in vs}
    faces = [f for f in bm.faces if f.verts[0].index in doomed]
    nf = len(faces)
    bmesh.ops.delete(bm, geom=faces, context='FACES')
    bm.to_mesh(o.data)
    bm.free()
    o.data.update()
    return nf


ANKLE_Y = 11.0


def above_ankle_islands(o):
    """Non-kilt islands that lie fully above the ankle: boot cuff rings, studs, spikes, gems."""
    me = o.data
    kilt = {vi for vs in kilt_islands(o) for vi in vs}
    return [vs for vs in index_islands(me)
            if vs[0] not in kilt and min(me.vertices[v].co.y for v in vs) >= ANKLE_Y]


BASE_FBX = 'C:/Unity proj/WorldOfWarcry-Web/public/assets/models/orc_shaman.fbx'


def kilt_follow_all(o):
    """Step 2 on a mesh that is only kilt (all islands)."""
    me = o.data
    names = {g.index: g.name for g in o.vertex_groups}
    if any(names[g.group].startswith('thigh') for v in me.vertices for g in v.groups):
        return -1
    moved = 0
    for v in me.vertices:
        d = smooth((KILT_FREE_Y - v.co.y) / (KILT_FREE_Y - KILT_HEM_Y)) * KILT_MAX_W
        if d <= 1e-4:
            continue
        sx = smooth(abs(v.co.x) / CENTRE_BLEND_X) * (1 if v.co.x > 0 else -1)
        nw = collections.defaultdict(float)
        for g in v.groups:
            nw[names[g.group]] += g.weight * (1 - d)
        nw['thigh_l'] += d * (0.5 + 0.5 * sx)
        nw['thigh_r'] += d * (0.5 - 0.5 * sx)
        top = sorted(nw.items(), key=lambda kv: -kv[1])[:4]
        tot = sum(x for _, x in top)
        for g in list(v.groups):
            o.vertex_groups[g.group].remove([v.index])
        for n, x in top:
            (o.vertex_groups.get(n) or o.vertex_groups.new(name=n)).add([v.index], x / tot, 'REPLACE')
        moved += 1
    return moved


if MODE in ('base_dry', 'base'):
    for o in [o for o in bpy.data.objects if o.name in ('Camera', 'Light', 'Cube')]:
        bpy.data.objects.remove(o)
    bpy.ops.import_scene.fbx(filepath=BASE_FBX)
    leg, kilt = bpy.data.objects['leg_orc_shaman'], bpy.data.objects['kilt_orc_shaman1']
    isl = [vs for vs in index_islands(leg.data) if min(leg.data.vertices[v].co.y for v in vs) >= ANKLE_Y]
    before = (len(leg.data.vertices), len(leg.data.polygons))
    print(f'BASE legs: {len(leg.data.vertices)} verts in {len(index_islands(leg.data))} islands; {len(isl)} above ankle, {sum(len(v) for v in isl)} verts')
    if MODE == 'base':
        nf = remove_islands(leg, isl)
        print(f'BASE removed {nf} faces; leg mesh {before} -> {(len(leg.data.vertices), len(leg.data.polygons))}')
        print(f'BASE kilt: {kilt_follow_all(kilt)} vertices re-weighted to thighs')
        arm = bpy.data.objects['Armature']
        for o in bpy.data.objects:
            o.select_set(False)
        for o in [arm] + [c for c in arm.children if c.type == 'MESH']:
            o.select_set(True)
        bpy.context.view_layer.objects.active = arm
        out = sys.argv_backup[sys.argv_backup.index('--') + 2] if len(sys.argv_backup) > sys.argv_backup.index('--') + 2 else BASE_FBX
        bpy.ops.export_scene.fbx(
            filepath=out, use_selection=True, object_types={'ARMATURE', 'MESH'},
            axis_forward='-Z', axis_up='Y', apply_scale_options='FBX_SCALE_NONE', global_scale=1.0,
            apply_unit_scale=True, bake_space_transform=False, use_mesh_modifiers=True,
            use_armature_deform_only=False, add_leaf_bones=False, primary_bone_axis='Y', secondary_bone_axis='X',
            bake_anim=False, use_triangles=False, path_mode='RELATIVE', embed_textures=False)
        print('EXPORTED', out)
    sys.exit(0)

if MODE in ('feet_dry', 'feet'):
    for r in RARITIES:
        o = bpy.data.objects[f'legs_caster_orc_{r}']
        isl = above_ankle_islands(o)
        before = (len(o.data.vertices), len(o.data.polygons))
        top = max((o.data.vertices[v].co.y for vs in isl for v in vs), default=0)
        if MODE == 'feet':
            nf = remove_islands(o, isl)
            print(f'FEET {r}: {len(isl)} islands (y up to {top:.1f}), {nf} faces removed; mesh {before} -> {(len(o.data.vertices), len(o.data.polygons))}')
        else:
            print(f'FEET_DRY {r}: {len(isl)} islands, verts {sum(len(v) for v in isl)}; mesh {before}')
    if MODE == 'feet':
        bpy.ops.wm.save_mainfile()
        print('SAVED')
    sys.exit(0)

for r in RARITIES:
    o = bpy.data.objects[f'legs_caster_orc_{r}']
    isl = leg_islands(o)
    before = (len(o.data.vertices), len(o.data.polygons))
    nverts = sum(len(v) for v in isl)
    if MODE == 'fix':
        nf = remove_islands(o, isl)
        kf = kilt_follow_legs(o)
        print(f'KILT {r}: {kf} vertices re-weighted to thighs' if kf >= 0 else f'KILT {r}: already has thigh weights, skipped')
        print(f'REMOVED {r}: {len(isl)} islands, {nverts} verts, {nf} faces; mesh {before} -> {(len(o.data.vertices), len(o.data.polygons))}')
    else:
        print(f'DRY {r}: {len(isl)} islands, {nverts} verts; mesh {before}')
if MODE == 'fix':
    bpy.ops.wm.save_mainfile()
    print('SAVED')
