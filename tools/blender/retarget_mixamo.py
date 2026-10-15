"""Retargets a Mixamo-style animation FBX onto our game skeleton and writes an animation-only FBX
in the same format as public/assets/models/SwordAttack.fbx (same bone names, cm units, FBX axes,
one clip, quaternion tracks + root.position).

Method: the source pose is sampled per frame in armature space, every mapped bone gets the world-space
rest-corrected rotation  R_tgt_pose = R_src_pose * R_src_rest^-1 * R_tgt_rest, root translation is
transferred as a world offset with horizontal motion locked (the game strips it too). The target
armature is peasant.fbx (the rest pose the clips are applied to in game); its meshes stay in the saved
.blend for previews but only the armature is exported.
The exported FBX is then filtered to the tracks Mixamo clips carry: Lcl Rotation of animated bones plus
root Lcl Translation (Blender writes T/R/S for every bone).

blender -b --factory-startup --python-exit-code 1 -P tools/blender/retarget_mixamo.py -- \
    <source.fbx> <target_rig.fbx> <out.fbx> [out.blend] [action-name-substring]
"""
import os
import sys

import bpy
from mathutils import Matrix, Quaternion

ARGS = sys.argv[sys.argv.index("--") + 1:]
SRC_FBX, TGT_FBX, OUT_FBX = ARGS[:3]
OUT_BLEND = ARGS[3] if len(ARGS) > 3 and ARGS[3] != "-" else None
ACTION_KEY = ARGS[4] if len(ARGS) > 4 else "mixamo.com"
ROOT_BONE = "root"
CLIP_NAME = "mixamo.com"


def fresh_import(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=path)
    return next(o for o in bpy.data.objects if o.type == "ARMATURE")


def action_fcurves(act):
    for layer in act.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


# ---------- 1. sample the source ----------
src = fresh_import(SRC_FBX)
act = next(a for a in bpy.data.actions if ACTION_KEY in a.name)
src.animation_data_create()
src.animation_data.action = act
src.animation_data.action_slot = act.slots[0]
F0, F1 = int(act.frame_range[0]), int(act.frame_range[1])
fps = bpy.context.scene.render.fps
animated = set()
for fc in action_fcurves(act):
    if fc.data_path.startswith('pose.bones["'):
        animated.add(fc.data_path.split('"')[1])
src_mw = src.matrix_world.copy()
src_rest = {b.name: b.matrix_local.copy() for b in src.data.bones}
samples = {}  # frame -> {bone: armature-space pose matrix}
for f in range(F0, F1 + 1):
    bpy.context.scene.frame_set(f)
    samples[f] = {pb.name: pb.matrix.copy() for pb in src.pose.bones}
print(f"[retarget] source action '{act.name}' frames {F0}-{F1} @ {fps} fps, {len(animated)} animated bones")

# ---------- 2. target rig ----------
tgt = fresh_import(TGT_FBX)
assert all(abs(a - b) < 1e-4 for ra, rb in zip(tgt.matrix_world, src_mw) for a, b in zip(ra, rb)), "armature transforms differ"
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
tgt.animation_data_clear()
tgt_rest = {b.name: b.matrix_local.copy() for b in tgt.data.bones}
parent_of = {b.name: (b.parent.name if b.parent else None) for b in tgt.data.bones}
mapped = [b.name for b in tgt.data.bones if b.name in animated and b.name in src_rest]
skipped = sorted(animated - set(mapped))
print(f"[retarget] mapped {len(mapped)} bones; animated but absent on target: {skipped}")
assert ROOT_BONE in mapped

order = [b.name for b in sorted(tgt.data.bones, key=lambda b: len(b.parent_recursive))]
sc = bpy.context.scene
sc.frame_start, sc.frame_end = F0, F1
for pb in tgt.pose.bones:
    pb.rotation_mode = "QUATERNION"

prev_q = {}
locked_xz = None
for f in range(F0, F1 + 1):
    sm = samples[f]
    pose_arm = {}
    for n in order:
        p = parent_of[n]
        if p is None:
            chain = tgt_rest[n].copy()
        else:
            chain = pose_arm[p] @ (tgt_rest[p].inverted() @ tgt_rest[n])
        if n in mapped:
            r_src_pose = sm[n].to_3x3().normalized()
            r_src_rest = src_rest[n].to_3x3().normalized()
            r_tgt_rest = tgt_rest[n].to_3x3().normalized()
            r_pose = r_src_pose @ r_src_rest.inverted() @ r_tgt_rest
            loc = chain.translation.copy()
            if p is None:
                delta = sm[n].translation - src_rest[n].translation
                if locked_xz is None:
                    locked_xz = (delta.x, delta.z)
                delta.x, delta.z = locked_xz
                loc = tgt_rest[n].translation + delta
            desired = Matrix.Translation(loc) @ r_pose.to_4x4()
        else:
            desired = chain
        pose_arm[n] = desired
        basis = chain.inverted() @ desired
        pb = tgt.pose.bones[n]
        q = basis.to_quaternion()
        if n in prev_q and prev_q[n].dot(q) < 0:
            q.negate()
        prev_q[n] = q
        pb.rotation_quaternion = q
        pb.keyframe_insert("rotation_quaternion", frame=f)
        if p is None:
            pb.location = basis.translation
            pb.keyframe_insert("location", frame=f)

new_act = tgt.animation_data.action
new_act.name = CLIP_NAME
print(f"[retarget] built action '{new_act.name}'")

if OUT_BLEND:
    os.makedirs(os.path.dirname(OUT_BLEND), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)

# ---------- 3. export + filter ----------
os.makedirs(os.path.dirname(OUT_FBX), exist_ok=True)
tmp_fbx = OUT_FBX + ".tmp.fbx"
bpy.ops.object.select_all(action="DESELECT")
tgt.select_set(True)
bpy.ops.export_scene.fbx(
    filepath=tmp_fbx, use_selection=True, object_types={"ARMATURE"},
    bake_anim=True, bake_anim_use_all_bones=False, bake_anim_use_all_actions=True, bake_anim_use_nla_strips=False,
    bake_anim_simplify_factor=0.0, add_leaf_bones=False, primary_bone_axis="Y", secondary_bone_axis="X",
    axis_forward="-Z", axis_up="Y", apply_scale_options="FBX_SCALE_NONE", global_scale=1.0, apply_unit_scale=True)

from io_scene_fbx import encode_bin, parse_fbx

root, version = parse_fbx.parse(tmp_fbx)


def child(elem, fid):
    return next((e for e in elem.elems if e.id == fid), None)


def name_of(elem):
    return elem.props[1].split(b"\x00")[0].decode()


objects = child(root, b"Objects")
conns = child(root, b"Connections")
model_name = {e.props[0]: name_of(e) for e in objects.elems if e.id == b"Model"}
keep_rot = set(mapped)
curve_nodes = {}  # id -> (model name, property)
for c in conns.elems:
    if c.props[0] == b"OP" and c.props[1] in {e.props[0] for e in objects.elems if e.id == b"AnimationCurveNode"}:
        if c.props[2] in model_name:
            curve_nodes[c.props[1]] = (model_name[c.props[2]], c.props[3].decode())
drop = set()
for cid, (mname, prop) in curve_nodes.items():
    ok = (prop == "Lcl Rotation" and mname in keep_rot) or (prop == "Lcl Translation" and mname == ROOT_BONE)
    if not ok:
        drop.add(cid)
curves_of = {}
for c in conns.elems:
    if c.props[0] == b"OP" and c.props[2] in curve_nodes:
        curves_of.setdefault(c.props[2], []).append(c.props[1])
for cid in list(drop):
    drop.update(curves_of.get(cid, []))
objects.elems[:] = [e for e in objects.elems if not (e.id in (b"AnimationCurveNode", b"AnimationCurve") and e.props[0] in drop)]
conns.elems[:] = [c for c in conns.elems if c.props[1] not in drop and c.props[2] not in drop]
defs = child(root, b"Definitions")
if defs:
    for ot in defs.elems:
        if ot.id == b"ObjectType" and ot.props[0] in (b"AnimationCurveNode", b"AnimationCurve"):
            kind = ot.props[0]
            cnt = sum(1 for e in objects.elems if e.id == kind)
            for e in ot.elems:
                if e.id == b"Count":
                    e.props[0] = cnt


def to_writable(elem):
    """parse_fbx returns immutable tuples; encode_bin needs its own FBXElem with typed add_* calls."""
    out = encode_bin.FBXElem(elem.id)
    adders = {
        b"B"[0]: out.add_bool, b"C"[0]: out.add_char, b"Z"[0]: out.add_int8, b"Y"[0]: out.add_int16,
        b"I"[0]: out.add_int32, b"L"[0]: out.add_int64, b"F"[0]: out.add_float32, b"D"[0]: out.add_float64,
        b"R"[0]: out.add_bytes, b"S"[0]: out.add_string, b"i"[0]: out.add_int32_array, b"l"[0]: out.add_int64_array,
        b"f"[0]: out.add_float32_array, b"d"[0]: out.add_float64_array, b"b"[0]: out.add_bool_array,
        b"c"[0]: out.add_byte_array,
    }
    for value, ptype in zip(elem.props, elem.props_type):
        adders[ptype](value)
    for e in elem.elems:
        out.elems.append(to_writable(e))
    return out


encode_bin.write(OUT_FBX, to_writable(root), version)
os.remove(tmp_fbx)
print(f"[retarget] wrote {OUT_FBX}: kept {len(curve_nodes) - len([d for d in drop if d in curve_nodes])} curve nodes")
