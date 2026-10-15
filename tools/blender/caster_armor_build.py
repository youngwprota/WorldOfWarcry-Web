"""Builds Art/Source/caster_armor_rigged.blend: skinned caster armour tiers on the original hero armatures.

Run:  blender -b --factory-startup -P caster_armor_build.py
Inputs (read only): wow2_mages_human.blend / wow2_shamans_orc.blend (static tier drafts, laid out in a row),
                    public/assets/models/mage.fbx and orc_shaman.fbx (rigged originals).
Per faction it
  1. imports the original FBX (armature + original body parts, kept hidden as weight sources),
  2. appends the 24 tier parts, undoes the row offset (object location only; verts already sit on the body),
  3. copies skin weights from the matching ORIGINAL parts (Data Transfer, nearest face interpolated, by group name),
     head accessories (verts further than 1 mm from the original head) are 100% head bone,
  4. parents every part to the armature exactly like the original meshes (same parent inverse),
  5. renames parts to head_/chest_/arms_/legs_caster_<faction>_<rarity>.
"""
import bpy, bmesh, os, sys
import numpy as np
from mathutils import Matrix
from mathutils.bvhtree import BVHTree

REPO = 'C:/Unity proj/WorldOfWarcry-Web'
SRC_DIR = 'C:/Unity proj/claude md'
OUT_BLEND = REPO + '/Art/Source/caster_armor_rigged.blend'
TEX_DIR = REPO + '/public/assets/textures'
RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']
PREFIX = {'head': 'head', 'torso': 'chest', 'arms': 'arms', 'legs': 'legs'}
ADDED_DIST = 0.001  # m: further than this from the original head surface = added accessory

FACTIONS = {
    'human': dict(
        fbx=REPO + '/public/assets/models/mage.fbx',
        blend=SRC_DIR + '/wow2_mages_human.blend',
        tier=lambda part, r: f'human_mage_{part}_{r}',
        base_mat='human_mage_mat', tex='human_mage_col.png',
        sources=dict(head=['head_human_mage'], torso=['chest_human_mage', 'hip_human_mage'],
                     arms=['arms_human_mage'], legs=['legs_human_mage']),
    ),
    'orc': dict(
        fbx=REPO + '/public/assets/models/orc_shaman.fbx',
        blend=SRC_DIR + '/wow2_shamans_orc.blend',
        tier=lambda part, r: f'orc_shaman_{part}_{r}',
        base_mat='orc_shaman_mat.001', tex='orc_shaman_albedo.png',
        sources=dict(head=['head_orc_shaman'], torso=['chest_orc_shaman', 'hips_orc_shaman1'],
                     arms=['arms_orc_shaman'], legs=['leg_orc_shaman', 'kilt_orc_shaman1']),
    ),
}


def ctx(obj, selected=None):
    return bpy.context.temp_override(active_object=obj, object=obj, selected_objects=selected or [obj],
                                     selected_editable_objects=selected or [obj])


def standalone_world_copy(o, name):
    """Copy of an object baked to world space, no parent/modifiers, vertex groups kept."""
    c = o.copy()
    c.data = o.data.copy()
    c.name = name
    bpy.context.scene.collection.objects.link(c)
    c.modifiers.clear()
    c.parent = None
    c.data.transform(o.matrix_world)
    c.matrix_world = Matrix.Identity(4)
    return c


def bvh_world(objs):
    bm = bmesh.new()
    for o in objs:
        m = bmesh.new()
        m.from_mesh(o.data)
        m.transform(o.matrix_world)
        me = bpy.data.meshes.new('tmp')
        m.to_mesh(me)
        m.free()
        bm.from_mesh(me)
        bpy.data.meshes.remove(me)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def finalize_weights(o, max_inf=4):
    """Top-4 influences, normalised; returns number of unweighted verts."""
    names = {g.index: g.name for g in o.vertex_groups}
    rows = []
    for v in o.data.vertices:
        ws = sorted(((g.weight, g.group) for g in v.groups if g.weight > 0.001), reverse=True)[:max_inf]
        s = sum(w for w, _ in ws)
        rows.append([(g, w / s) for w, g in ws] if s > 0 else [])
    for vg in o.vertex_groups:
        vg.remove(range(len(o.data.vertices)))
    empty = 0
    for i, row in enumerate(rows):
        if not row:
            empty += 1
        for g, w in row:
            o.vertex_groups[names[g]].add([i], w, 'REPLACE')
    return empty


def build_faction(fac, cfg):
    before = set(bpy.data.objects)
    before_mats = set(bpy.data.materials)
    bpy.ops.import_scene.fbx(filepath=cfg['fbx'])
    new = [o for o in bpy.data.objects if o not in before]
    for m in bpy.data.materials:
        if m not in before_mats:
            m.name = f'src_{fac}_{m.name}'
    arm = next(o for o in new if o.type == 'ARMATURE')
    arm.name = f'Armature_{fac}'
    arm.data.name = f'Armature_{fac}'
    arm.animation_data_clear()  # clips come from the shared Idle/Walk/... FBX files in the game
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    orig = {o.name: o for o in new if o.type == 'MESH'}
    pinv = next(iter(orig.values())).matrix_parent_inverse.copy()

    coll = bpy.data.collections.new(f'caster_{fac}')
    bpy.context.scene.collection.children.link(coll)
    srccoll = bpy.data.collections.new(f'weight_src_{fac}')
    bpy.context.scene.collection.children.link(srccoll)
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
    coll.objects.link(arm)
    for o in orig.values():
        srccoll.objects.link(o)
        o.name = f'src_{o.name}'
    srccoll.hide_viewport = True
    srccoll.hide_render = True

    wanted = [cfg['tier'](p, r) for p in PREFIX for r in RARITIES]
    with bpy.data.libraries.load(cfg['blend']) as (df, dt):
        dt.objects = [n for n in df.objects if n in wanted]
    tiers = {o.name: o for o in dt.objects if o}
    assert len(tiers) == 24, (fac, len(tiers))

    for part, srcnames in cfg['sources'].items():
        srcs = [bpy.data.objects['src_' + n] for n in srcnames]
        bpy.context.view_layer.update()
        copies = [standalone_world_copy(s, f'wsrc_{fac}_{part}_{i}') for i, s in enumerate(srcs)]
        for c in copies:
            c.select_set(True)
        with ctx(copies[0], copies):
            bpy.ops.object.join()
        wsrc = copies[0]
        wsrc.name = f'wsrc_{fac}_{part}'
        head_bvh = bvh_world(srcs) if part == 'head' else None
        gnames = [g.name for g in wsrc.vertex_groups]

        for r in RARITIES:
            o = tiers[cfg['tier'](part, r)]
            coll.objects.link(o)
            o.location = (0, 0, 0)  # undo the row offset
            o.rotation_euler = (0, 0, 0)
            bpy.context.view_layer.update()
            o.vertex_groups.clear()
            for gname in gnames:
                o.vertex_groups.new(name=gname)
            mod = o.modifiers.new('xfer', 'DATA_TRANSFER')
            mod.object = wsrc
            mod.use_vert_data = True
            mod.data_types_verts = {'VGROUP_WEIGHTS'}
            mod.vert_mapping = 'POLYINTERP_NEAREST'
            mod.layers_vgroup_select_src = 'ALL'
            mod.layers_vgroup_select_dst = 'NAME'
            mod.mix_mode = 'REPLACE'
            mod.mix_factor = 1.0
            mod.use_object_transform = True
            with ctx(o):
                bpy.ops.object.modifier_apply(modifier='xfer')
            added = 0
            if part == 'head':
                head_vg = o.vertex_groups['head']
                for v in o.data.vertices:
                    d = head_bvh.find_nearest(v.co)[3]
                    if d > ADDED_DIST:
                        added += 1
                        for vg in o.vertex_groups:
                            if vg.name != 'head':
                                vg.remove([v.index])
                        head_vg.add([v.index], 1.0, 'REPLACE')
            empty = finalize_weights(o)
            # export naming and rig parenting (same structure as the original FBX meshes)
            new_name = f'{PREFIX[part]}_caster_{fac}_{r}'
            o.name = new_name
            o.data.name = new_name
            o.parent = arm
            o.matrix_parent_inverse = pinv
            # mesh data in armature-local space (cm, like the original FBX meshes); world position stays the same
            o.data.transform(pinv.inverted() @ arm.matrix_world.inverted())
            bpy.context.view_layer.update()
            wb = [o.matrix_world @ v.co for v in o.data.vertices]
            assert abs(min(w.z for w in wb)) < 5 and max(w.z for w in wb) < 3, 'tier moved off the body'
            o.modifiers.clear()
            am = o.modifiers.new('Armature', 'ARMATURE')
            am.object = arm
            print(f'PART {new_name} verts={len(o.data.vertices)} added_head={added} unweighted={empty} groups={len(o.vertex_groups)}')
        bpy.data.objects.remove(wsrc)

    # base texture material: reference the real texture file instead of the packed copy
    for mat in {s.material for o in tiers.values() for s in o.material_slots if s.material}:
        if mat.name == cfg['base_mat']:
            mat.name = cfg['base_mat'].replace('.001', '')
    return arm


def fix_images():
    """All texture nodes point at files in public/assets/textures (no packed copies, no foreign relative paths)."""
    for mat in bpy.data.materials:
        if not mat.node_tree or mat.name.startswith('src_'):
            continue
        for n in mat.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image:
                base = n.image.name.split('.png')[0] + '.png'
                path = f'{TEX_DIR}/{base}'
                assert os.path.exists(path), path
                n.image = bpy.data.images.load(path, check_existing=True)


def make_gray_texture():
    """orc_shaman_albedo_gray.png: HSV saturation 0 like the tint nodes of the drafts (grey = max(r,g,b) in linear)."""
    src = bpy.data.images.load(f'{TEX_DIR}/orc_shaman_albedo.png', check_existing=True)
    w, h = src.size
    px = np.array(src.pixels[:], dtype=np.float32).reshape(-1, 4)
    g = px[:, :3].max(axis=1)
    enc = np.where(g <= 0.0031308, g * 12.92, 1.055 * np.power(np.maximum(g, 1e-9), 1 / 2.4) - 0.055)
    out = np.empty_like(px)
    out[:, 0] = out[:, 1] = out[:, 2] = enc
    out[:, 3] = 1.0
    img = bpy.data.images.new('orc_shaman_albedo_gray.png', w, h, alpha=False)
    img.colorspace_settings.name = 'sRGB'
    img.pixels.foreach_set(out.ravel())
    img.filepath_raw = f'{TEX_DIR}/orc_shaman_albedo_gray.png'
    img.file_format = 'PNG'
    img.save()
    return img


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for fac, cfg in FACTIONS.items():
        build_faction(fac, cfg)
    fix_images()
    make_gray_texture()
    for act in list(bpy.data.actions):
        bpy.data.actions.remove(act)
    bpy.data.orphans_purge(do_recursive=True)
    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, compress=True, relative_remap=True)
    print('SAVED', OUT_BLEND)


main()
