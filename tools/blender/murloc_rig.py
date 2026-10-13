"""Rigs the human murloc with a Mesh2Motion skeleton (human or kaiju) and idle / walk / attack / death clips,
then exports a GLB plus preview renders. Same method as boar_rig.py: bone heads fitted to the murloc's
joints, every bone keeps the source rest orientation so the clips bend about the same axes.

blender -b --factory-startup --python-exit-code 1 -P tools/blender/murloc_rig.py -- \
    <source.blend> <mesh2motion_dir> human|kaiju <out_name> <preview_dir>
"""
import math
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector, kdtree

ARGS = sys.argv[sys.argv.index("--") + 1:]
SRC_BLEND, M2M_DIR, RIG, OUT_NAME, PREVIEW_DIR = ARGS[:5]
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
BLEND_OUT = os.path.join(REPO, "Art", "Source", OUT_NAME + ".blend")
GLB_OUT = os.path.join(REPO, "public", "assets", "models", OUT_NAME + ".glb")
os.makedirs(PREVIEW_DIR, exist_ok=True)
FPS = 24
# All clips play this much faster than authored (user, 2026-10-13); game stride / hit marker / speed are scaled to match
ANIM_SPEED = 1.3
HIPS_LOC_SCALE = 0.45  # human / kaiju root motion is ~2x the murloc's size

# Murloc joints in model space (x forward, y left, z up), measured on the remeshed body
J = {
    "pelvis": (-0.15, 0, 0.50), "sp1": (-0.10, 0, 0.58), "sp2": (-0.03, 0, 0.66), "sp2b": (0.01, 0, 0.69),
    "sp3": (0.04, 0, 0.72), "neck": (0.10, 0, 0.76), "head": (0.16, 0, 0.79), "headtip": (0.48, 0, 0.80),
    "jaw": (0.18, 0, 0.70), "jawtip": (0.46, 0, 0.62),
    "clav": (0.02, 0.07, 0.68), "shoulder": (0.03, 0.26, 0.62), "elbow": (0.06, 0.29, 0.36),
    "wrist": (0.10, 0.29, 0.13), "handtip": (0.15, 0.30, 0.03),
    "hipside": (-0.12, 0.08, 0.52), "hip": (-0.15, 0.13, 0.48), "knee": (-0.20, 0.22, 0.27),
    "ankle": (-0.32, 0.25, 0.08), "ball": (-0.18, 0.27, 0.03), "toe": (-0.06, 0.28, 0.01),
    "sk0": (-0.22, 0, 0.62), "sk1": (-0.30, 0, 0.58), "sk2": (-0.37, 0, 0.54), "sk3": (-0.43, 0, 0.50),
    "sk4": (-0.49, 0, 0.46), "sk5": (-0.55, 0, 0.42), "sk6": (-0.60, 0, 0.38),
}
RIGS = {
    "human": {
        "files": ["human-base-animations.glb", "human-addon-animations.glb"],
        "clips": {"Zombie_Idle_Crouch": "idle", "Crouch_Walk": "walk", "Sword_Attack": "attack", "Death_A": "death"},
        "hips": "pelvis", "side": ("_l", "_r"),
        "bones": {
            "pelvis": ("pelvis", "sp1"), "spine_01": ("sp1", "sp2"), "spine_02": ("sp2", "sp3"),
            "spine_03": ("sp3", "neck"), "neck_01": ("neck", "head"), "head": ("head", "headtip"),
            "clavicle_%s": ("clav", "shoulder"), "upperarm_%s": ("shoulder", "elbow"),
            "lowerarm_%s": ("elbow", "wrist"), "hand_%s": ("wrist", "handtip"),
            "thigh_%s": ("hip", "knee"), "calf_%s": ("knee", "ankle"), "foot_%s": ("ankle", "ball"),
            "ball_%s": ("ball", "toe"),
        },
        "spikes": [], "jaw": None, "sword": "hand_r", "shield": "lowerarm_l", "upper": "spine_01",
    },
    "kaiju": {
        "files": ["kaiju-animations.glb"],
        "clips": {"Idle": "idle", "Walk": "walk", "Attack": "attack", "Death": "death"},
        "hips": "Hips", "side": ("_L", "_R"),
        "bones": {
            "Hips": ("pelvis", "sp1"), "Spine_1": ("sp1", "sp2"), "Spine_2": ("sp2", "sp2b"),
            "Spine_2.001": ("sp2b", "sp3"), "Spine_3": ("sp3", "neck"), "Spine_4": ("neck", "head"),
            "Head": ("head", "headtip"), "Chin": ("jaw", "jawtip"),
            "Front_Leg_Shoulder_%s": ("clav", "shoulder"), "Front_Leg_Upper_%s": ("shoulder", "elbow"),
            "Front_Leg_Lower_%s": ("elbow", "wrist"), "Hand_%s": ("wrist", "handtip"),
            "Back_Leg_Pelvis_%s": ("hipside", "hip"), "Back_Leg_Upper_%s": ("hip", "knee"),
            "Back_Leg_Lower_%s": ("knee", "ankle"), "Back_Leg_Ankle_%s": ("ankle", "ball"),
            "Back_Leg_Foot_%s": ("ball", "toe"),
            "Tail_Base": ("sk0", "sk1"), "Tail_Mid": ("sk1", "sk2"), "Tail_Mid.001": ("sk2", "sk3"),
            "Tail_Mid.002": ("sk3", "sk4"), "Tail_Mid.003": ("sk4", "sk5"), "Tail_Tip": ("sk5", "sk6"),
        },
        "spikes": ["Tail_Base", "Tail_Mid", "Tail_Mid.001", "Tail_Mid.002", "Tail_Mid.003", "Tail_Tip"],
        "jaw": "Chin", "sword": "Hand_R", "shield": "Front_Leg_Lower_L", "upper": "Spine_1",
        # hand-made sword chop replacing the kaiju claw swipe: (bone, share of each rotation curve)
        "slash": {"spine": [("Spine_1", 0.4), ("Spine_2", 0.3), ("Spine_3", 0.3)],
                  "arm": [("Front_Leg_Shoulder_R", 0.15), ("Front_Leg_Upper_R", 0.55), ("Front_Leg_Lower_R", 0.3)]},
    },
}
R = RIGS[RIG]
SWORD_BONE = "sword_grip"


def fcurves(action):
    return [fc for layer in action.layers for strip in layer.strips for cb in strip.channelbags for fc in cb.fcurves]


def to_rig(p):
    """Model space (x forward, y left) to rig space (-y forward, +x left)."""
    return Vector((p[1], -p[0], p[2]))


def bone_table():
    out = {}
    for pat, (h, t) in R["bones"].items():
        if "%s" not in pat:
            out[pat] = (to_rig(J[h]), to_rig(J[t]))
            continue
        for suf, sg in zip(R["side"], (1, -1)):
            mh, mt = J[h], J[t]
            out[pat % suf[1:]] = (to_rig((mh[0], mh[1] * sg, mh[2])), to_rig((mt[0], mt[1] * sg, mt[2])))
    return out


# ----------------------------------------------------------------------------- source model
def load_model():
    bpy.ops.wm.open_mainfile(filepath=SRC_BLEND)
    for o in list(bpy.data.objects):
        if o.type != "MESH" or len(o.data.vertices) == 0:
            bpy.data.objects.remove(o)
    rot = Matrix.Rotation(-math.pi / 2, 4, "Z")  # +X forward -> -Y forward
    for o in bpy.data.objects:
        o.data.transform(rot @ o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        o.modifiers.clear()
    # The textures have no transparency: a linked alpha would export as alphaMode BLEND and three.js would then
    # sort the body over the armour
    for m in bpy.data.materials:
        if m.use_nodes:
            for link in [l for l in m.node_tree.links if l.to_socket.name == "Alpha"]:
                m.node_tree.links.remove(link)
    return {o.name: o for o in bpy.data.objects}


# ----------------------------------------------------------------------------- rig + clips
def import_rig(keep):
    arm = None
    for f in R["files"]:
        before = set(bpy.data.objects.keys())
        bpy.ops.import_scene.gltf(filepath=os.path.join(M2M_DIR, f))
        for name in set(bpy.data.objects.keys()) - before:
            o = bpy.data.objects[name]
            if o.type == "ARMATURE" and arm is None:
                arm = o
                continue
            if o.type == "ARMATURE":
                # the addon clips share the skeleton: keep its actions, drop the second armature
                for act in bpy.data.actions:
                    act.use_fake_user = True
            elif o.type == "MESH" and name in keep:
                continue
            bpy.data.objects.remove(o)
    arm.name = "Armature"
    ad = arm.animation_data
    ad.action = None
    for tr in list(ad.nla_tracks):
        ad.nla_tracks.remove(tr)
    for act in list(bpy.data.actions):
        if act.name not in R["clips"]:
            bpy.data.actions.remove(act)
    for old, new in R["clips"].items():
        bpy.data.actions[old].name = new
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)
    return arm


def fit_bones(arm, table):
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    missing = set(table) - {b.name for b in eb}
    assert not missing, missing
    old = {b.name: (b.head.copy(), b.tail.copy()) for b in eb}
    for b in eb:
        b.use_connect = False
    new_head = {}

    def place(b):
        if b.name in new_head:
            return
        if b.name in table:
            new_head[b.name] = table[b.name][0]
        elif b.parent is None:
            new_head[b.name] = old[b.name][0] * 0.45
        else:
            place(b.parent)
            new_head[b.name] = new_head[b.parent.name] + (old[b.name][0] - old[b.parent.name][0]) * 0.45
    for b in eb:
        place(b)
    for b in eb:
        roll, d = b.roll, (old[b.name][1] - old[b.name][0])
        length = (table[b.name][1] - table[b.name][0]).length if b.name in table else d.length * 0.45
        b.head = new_head[b.name]
        b.tail = b.head + d.normalized() * max(length, 0.015)
        b.roll = roll
        b.use_deform = b.name in table
    bpy.ops.object.mode_set(mode="OBJECT")


def retime_actions(hips):
    for act in bpy.data.actions:
        start = min(kp.co.x for fc in fcurves(act) for kp in fc.keyframe_points)
        for fc in fcurves(act):
            loc = fc.data_path == f'pose.bones["{hips}"].location'
            for kp in fc.keyframe_points:
                kp.co.x -= start
                kp.handle_left.x -= start
                kp.handle_right.x -= start
                if loc:
                    for p in (kp.co, kp.handle_left, kp.handle_right):
                        p.y *= HIPS_LOC_SCALE
            fc.update()
        act.use_fake_user = True


def speed_up():
    """Compresses every clip by ANIM_SPEED (last step, after authoring, grounding and the sword bake)."""
    for act in bpy.data.actions:
        for fc in fcurves(act):
            for kp in fc.keyframe_points:
                for p in (kp.co, kp.handle_left, kp.handle_right):
                    p.x /= ANIM_SPEED
            fc.update()


def set_action(arm, act):
    ad = arm.animation_data
    ad.action = act
    ad.action_slot = act.slots[0]


def ground_clips(arm, objs, hips):
    """Offsets the hips so the lowest point of every clip sits on z = 0 (whole clip for idle / walk / attack,
    per key for death so the body never sinks into the floor)."""
    scene = bpy.context.scene
    inv = arm.data.bones[hips].matrix_local.to_3x3().inverted()
    for act in bpy.data.actions:
        set_action(arm, act)
        chans = {fc.array_index: fc for fc in fcurves(act) if fc.data_path == f'pose.bones["{hips}"].location'}
        if not chans:
            continue  # the authored attack only moves the upper body
        frames = sorted({int(round(kp.co.x)) for fc in chans.values() for kp in fc.keyframe_points})
        lows = []
        for f in frames:
            scene.frame_set(f)
            dg = bpy.context.evaluated_depsgraph_get()
            lows.append(min(min((o.matrix_world @ v.co).z for v in o.evaluated_get(dg).data.vertices)
                            for o in objs))
        per_key = act.name == "death"
        for fc_i, fc in chans.items():
            for kp in fc.keyframe_points:
                f = int(round(kp.co.x))
                lift = max(0.0, -lows[frames.index(f)]) if per_key else -min(lows)
                d = (inv @ Vector((0, 0, lift)))[fc_i]
                kp.co.y += d
                kp.handle_left.y += d
                kp.handle_right.y += d
            fc.update()
        print("GROUND", act.name, "min", round(min(lows), 3), "max", round(max(lows), 3))
    arm.animation_data.action = None


def nla_setup(arm):
    ad = arm.animation_data
    for name in [a.name for a in bpy.data.actions]:
        tr = ad.nla_tracks.new()
        tr.name = name
        tr.strips.new(name, 0, bpy.data.actions[name]).name = name
    ad.action = None


def add_sword_bone(arm, sword):
    """Own bone for the sword under the upper-body root (so the in-game attack layer drives it too). Baked to follow
    the hand in every clip; in the death clip the sword is let go, falls flat and shrinks away."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    grip = eb[R["sword"]].tail.copy()
    tip = max((v.co for v in sword.data.vertices), key=lambda c: (c - grip).length)
    b = eb.new(SWORD_BONE)
    b.head = grip
    b.tail = grip + (tip - grip).normalized() * 0.3
    b.parent = eb[R["upper"]]
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.pose.bones[SWORD_BONE].rotation_mode = "QUATERNION"


# Sword chop with the flow of the game's human SwordAttack (sampled from SwordAttack.fbx): the arm rises overhead
# by 0.4 s while the torso winds up, chops diagonally across the body to the hit at 0.6 s (ATTACK_HIT in
# src/config.ts) with the torso turning through (half the human's turn, the murloc leans forward), recovers by 1.5 s.
# Curves: (chain, world axis, degrees per key), applied in order. X: negative = arm forward / up, positive spine =
# lean forward. Z: positive = turn to the murloc's left.
SLASH_T = [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.75, 1.0, 1.2, 1.5]
SLASH = [
    ("arm", "X", [0, -94, -148, -165, -120, -55, 20, 15, -30, 0]),
    ("arm", "Z", [0, -5, -10, -10, 10, 35, 50, 40, 10, 0]),
    ("spine", "Z", [0, -9, -14, -5, 18, 37, 52, 40, 8, 0]),
    ("spine", "X", [0, 0, -4, -6, 2, 12, 16, 14, 6, 0]),
]
AXES = {"X": Vector((1, 0, 0)), "Z": Vector((0, 0, 1))}


def author_attack(arm):
    bpy.data.actions.remove(bpy.data.actions["attack"])
    act = bpy.data.actions.new("attack")
    arm.animation_data.action = act
    sl = R["slash"]
    for i, t in enumerate(SLASH_T):
        world = {}
        for chain, axis, degs in SLASH:
            for bone, share in sl[chain]:
                world[bone] = Quaternion(AXES[axis], math.radians(degs[i] * share)) @ world.get(bone, Quaternion())
        for bone, q in world.items():
            # world-space rotation expressed in the bone's rest frame
            rest = arm.data.bones[bone].matrix_local.to_quaternion()
            pb = arm.pose.bones[bone]
            pb.rotation_mode = "QUATERNION"
            pb.rotation_quaternion = rest.inverted() @ q @ rest
            pb.keyframe_insert("rotation_quaternion", frame=t * FPS)
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"
        fc.update()
    act.use_fake_user = True
    arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = (1, 0, 0, 0)


def hold_arms():
    """Idle and walk keep both arms in the rest pose (a mirror pair): the kaiju clips bend the sword hand so the
    blade points into the body and fold the shield arm into the crotch. The sword arm's rest is where the chop starts."""
    right = [b for b, _ in R["slash"]["arm"]] + [R["sword"]]
    lsuf, rsuf = R["side"]
    bones = right + [b[:-len(rsuf)] + lsuf for b in right]
    paths = {f'pose.bones["{b}"].rotation_quaternion' for b in bones}
    for name in ("idle", "walk"):
        for layer in bpy.data.actions[name].layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    # keys set to rest, not removed: an unkeyed bone keeps whatever pose was evaluated last
                    for fc in [fc for fc in cb.fcurves if fc.data_path in paths]:
                        for kp in fc.keyframe_points:
                            kp.co.y = kp.handle_left.y = kp.handle_right.y = 1.0 if fc.array_index == 0 else 0.0
                        fc.update()


def bake_sword(arm):
    scene = bpy.context.scene
    pb = arm.pose.bones[SWORD_BONE]
    off = arm.data.bones[R["sword"]].matrix_local.inverted() @ arm.data.bones[SWORD_BONE].matrix_local
    for act in bpy.data.actions:
        set_action(arm, act)
        f0, f1 = (int(round(x)) for x in act.frame_range)
        drop = act.name == "death"
        held = None
        for f in range(f0, f1 + 1):
            scene.frame_set(f)
            m = arm.pose.bones[R["sword"]].matrix @ off
            if drop and f >= 6:
                held = held or m.copy()
                t = min(1.0, (f - 6) / 10)
                loc, rot, _ = held.decompose()
                d = rot @ Vector((0, 1, 0))
                flat = rot.copy()
                flat.rotate(d.rotation_difference(Vector((d.x, d.y, 0)).normalized()))
                shrink = max(0.001, 1 - max(0.0, (f - 30) / 8))
                m = Matrix.LocRotScale(loc.lerp(Vector((loc.x, loc.y, 0.03)), t * t),
                                       rot.slerp(flat, t), Vector((shrink,) * 3))
            pb.matrix = m
            bpy.context.view_layer.update()
            for path in ("location", "rotation_quaternion", "scale"):
                pb.keyframe_insert(path, frame=f)
    arm.animation_data.action = None


# ----------------------------------------------------------------------------- weights
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length


ARM_JOINTS = {"clav", "shoulder", "elbow", "wrist"}
LEG_JOINTS = {"hipside", "hip", "knee", "ankle", "ball"}
# Arms hang beside the thighs, so straight-line distance alone mixes arm and leg bones. Limb regions are grown
# along the mesh from the hands / feet: the arm only up to just above the elbow (forearm and hand are what touch the
# legs; higher up the crouched torso joins arms and thighs), the leg up to the hips.
ARM_TOP = J["elbow"][2] + 0.04
LEG_TOP = J["hip"][2] + 0.02


def limb_bones(joints):
    """Bone names (both sides) whose chain starts at one of `joints`."""
    out = set()
    for pat, (h, _) in R["bones"].items():
        if h in joints:
            out |= {pat % suf[1:] for suf in R["side"]} if "%s" in pat else {pat}
    return out


def limb_regions(body, table):
    """Per body vertex: 'arm' (forearm + hand), 'leg' or None. Flood fill over mesh edges from vertices hugging
    the hand / foot bones, below ARM_TOP / LEG_TOP; the leg fill never enters the arm region."""
    me = body.data
    nbr = [[] for _ in me.vertices]
    for e in me.edges:
        a, b = e.vertices
        nbr[a].append(b)
        nbr[b].append(a)
    label = [None] * len(me.vertices)
    hands = [table[n] for n in limb_bones({"wrist"})]
    feet = [table[n] for n in limb_bones({"ankle", "ball"})]
    # The hand tips hang next to the feet: a seed belongs to whichever end bone it is closer to
    near = [(min(seg_dist(v.co, *e) for e in hands), min(seg_dist(v.co, *e) for e in feet)) for v in me.vertices]
    for kind, own, top in (("arm", 0, ARM_TOP), ("leg", 1, LEG_TOP)):
        st = [v.index for v in me.vertices if v.co.z < top and label[v.index] is None
              and near[v.index][own] < 0.04 and near[v.index][own] < near[v.index][1 - own]]
        seen = set(st)
        while st:
            i = st.pop()
            label[i] = kind
            for j in nbr[i]:
                if j not in seen and label[j] is None and me.vertices[j].co.z < top:
                    seen.add(j)
                    st.append(j)
    print("REGIONS arm", label.count("arm"), "leg", label.count("leg"))
    return label


class Weigher:
    def __init__(self, table):
        self.seg = table
        self.arm = limb_bones(ARM_JOINTS)
        self.leg = limb_bones(LEG_JOINTS)
        lsuf, rsuf = R["side"]
        self.left = {n for n in table if n.endswith(lsuf)}
        self.right = {n for n in table if n.endswith(rsuf)}
        self.limb = self.left | self.right
        self.spikes = set(R["spikes"])

    def __call__(self, p, region=None):
        m = Vector((-p.y, p.x, p.z))  # back to model space for region tests
        cands = set(self.seg)
        if region == "arm":
            cands -= self.leg
        elif region == "leg":
            cands -= self.arm
        if m.y > 0.03:
            cands -= self.right
        elif m.y < -0.03:
            cands -= self.left
        if self.spikes and not (m.x < -0.2 and 0.3 < m.z < 0.76):
            cands -= self.spikes
        jaw = R["jaw"]
        if jaw and not (m.x > 0.22 and m.z < 0.71 and abs(m.y) < 0.2):
            cands.discard(jaw)
        if m.z > 0.7 and abs(m.y) < 0.2 and m.x < 0.2:
            cands -= self.limb  # torso top and fin stalks never follow the arms
        w = {n: 1.0 / (seg_dist(p, *self.seg[n]) + 0.015) ** 4 for n in cands}
        top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
        s = sum(v for _, v in top)
        return [(n, v / s) for n, v in top]


def apply_weights(obj, weigher, regions, ref=None, rigid=None):
    """ref = body kd-tree: gear takes the weights and limb region of the nearest body vertex."""
    groups = {}
    for v in obj.data.vertices:
        if rigid:
            ws = [(rigid, 1.0)]
        elif ref:
            co, i, _ = ref.find(v.co)
            ws = weigher(co, regions[i])
        else:
            ws = weigher(v.co, regions[v.index])
        for n, w in ws:
            if n not in groups:
                groups[n] = obj.vertex_groups.get(n) or obj.vertex_groups.new(name=n)
            groups[n].add([v.index], w, "REPLACE")


def skin(obj, arm):
    obj.parent = arm
    obj.modifiers.new("Armature", "ARMATURE").object = arm


# ----------------------------------------------------------------------------- export + previews
def export_glb(objs, arm):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(filepath=GLB_OUT, export_format="GLB", use_selection=True, export_animations=True,
                              export_animation_mode="NLA_TRACKS", export_force_sampling=True, export_yup=True,
                              export_apply=False, export_skins=True, export_def_bones=False,
                              export_optimize_animation_size=False, export_image_format="AUTO")


def preview():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB_OUT)
    scene = bpy.context.scene
    scene.render.fps = FPS
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    tris = 0
    for m in meshes:
        m.data.calc_loop_triangles()
        tris += len(m.data.loop_triangles)
    print("VERIFY meshes", sorted(m.name for m in meshes), "tris", tris, "bones", len(arm.data.bones))
    acts = {a.name: a for a in bpy.data.actions}
    for n, a in acts.items():
        print("VERIFY action", n, tuple(a.frame_range), "s", round((a.frame_range[1] - a.frame_range[0]) / FPS, 2))
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = scene.render.resolution_y = 420
    world = bpy.data.worlds.new("w")
    world.color = (0.08, 0.08, 0.09)
    scene.world = world
    for m in bpy.data.materials:
        tex = [l.from_node for l in m.node_tree.links if l.from_node.type == "TEX_IMAGE"
               and l.to_socket.name == "Base Color"] if m.use_nodes else []
        if tex:
            m.node_tree.nodes.active = tex[0]
    bpy.ops.mesh.primitive_plane_add(size=6)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.4
    scene.collection.objects.link(cam)
    scene.camera = cam
    ad = arm.animation_data
    for tr in ad.nla_tracks:
        tr.mute = True

    def shot(label, act=None, frac=0.0, view="34"):
        ad.action = None
        for pb in arm.pose.bones:
            pb.location, pb.rotation_quaternion, pb.scale = (0, 0, 0), (1, 0, 0, 0), (1, 1, 1)
        if act:
            a = acts[act]
            ad.action = a
            ad.action_slot = a.slots[0]
            scene.frame_set(int(round(a.frame_range[0] + frac * (a.frame_range[1] - a.frame_range[0]))))
        else:
            scene.frame_set(0)
        target = Vector((0, -0.2, 0.55))
        cam.location = target + (Vector((5, 0, 0.3)) if view == "side" else Vector((3.0, -3.4, 1.6)))
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(PREVIEW_DIR, f"{OUT_NAME}_{label}.png")
        bpy.ops.render.render(write_still=True)

    shot("00_rest")
    for i, fr in enumerate((0.0, 0.5)):
        shot(f"10_idle_{i}", "idle", fr)
    for i, fr in enumerate((0.0, 0.25, 0.5, 0.75)):
        shot(f"20_walk_{i}", "walk", fr, "side")
    for i, fr in enumerate((0.25, 0.45, 0.65)):
        shot(f"30_attack_{i}", "attack", fr)
    for i, fr in enumerate((0.4, 1.0)):
        shot(f"40_death_{i}", "death", fr)


def main():
    objs = load_model()
    table = bone_table()
    arm = import_rig(set(objs))
    bpy.context.scene.render.fps = FPS
    fit_bones(arm, table)
    add_sword_bone(arm, objs["sword"])
    retime_actions(R["hips"])
    if "slash" in R:
        author_attack(arm)
        hold_arms()
    weigher = Weigher(table)
    body = objs["body"]
    kd = kdtree.KDTree(len(body.data.vertices))
    for v in body.data.vertices:
        kd.insert(v.co, v.index)
    kd.balance()
    regions = limb_regions(body, table)
    for name, o in objs.items():
        rigid = SWORD_BONE if name == "sword" else R["shield"] if name == "shield" else None
        apply_weights(o, weigher, regions, None if o is body else kd, rigid)
        skin(o, arm)
    ground_clips(arm, [objs["body"]], R["hips"])  # gear may dip into the floor; the sword would prop the corpse up
    bake_sword(arm)
    speed_up()
    nla_setup(arm)
    bpy.ops.file.pack_all()
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    export_glb(list(objs.values()), arm)
    preview()


main()
