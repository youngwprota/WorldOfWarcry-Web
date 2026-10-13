"""Rigs a boar model (orc boar / undead boar; boarpack v13 meshes) with the Mesh2Motion horse skeleton and its
idle / walk / attack / death clips, then exports a GLB plus preview renders.

blender -b --factory-startup --python-exit-code 1 -P tools/blender/boar_rig.py -- \
    <source.blend> <mesh2motion_dir> <out_name> <preview_dir>
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector, kdtree

ARGS = sys.argv[sys.argv.index("--") + 1:]
SRC_BLEND, M2M_DIR, OUT_NAME, PREVIEW_DIR = ARGS[:4]
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
BLEND_OUT = os.path.join(REPO, "Art", "Source", OUT_NAME + ".blend")
GLB_OUT = os.path.join(REPO, "public", "assets", "models", OUT_NAME + ".glb")
os.makedirs(PREVIEW_DIR, exist_ok=True)

FPS = 24
# Horse clips are keyed every 0.8 frame (30 Hz data in a 24 fps scene); stretching x1.25 puts keys on whole frames
TIME_STRETCH = 1.25
HIPS_LOC_SCALE = 0.5
CLIPS = {"Idle": "idle", "Walk": "walk", "Head_But": "attack", "Death": "death"}


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def pchip(xs, ys):
    def f(x):
        if x <= xs[0]:
            return ys[0]
        for i in range(len(xs) - 1):
            if x <= xs[i + 1]:
                return ys[i] + (ys[i + 1] - ys[i]) * smooth(xs[i], xs[i + 1], x)
        return ys[-1]
    return f


def fcurves(action):
    return [fc for layer in action.layers for strip in layer.strips for cb in strip.channelbags for fc in cb.fcurves]


# ----------------------------------------------------------------------------- source model
def load_model():
    bpy.ops.wm.open_mainfile(filepath=SRC_BLEND)
    for o in list(bpy.data.objects):
        if o.type != "MESH" or len(o.data.vertices) == 0:
            bpy.data.objects.remove(o)
    meshes = list(bpy.data.objects)
    # The pack faces +X; the horse rig faces -Y
    rot = Matrix.Rotation(-math.pi / 2, 4, "Z")
    for o in meshes:
        o.data.transform(rot @ o.matrix_world)
        o.matrix_world = Matrix.Identity(4)
        o.modifiers.clear()
    split_hooves(next(o for o in meshes if o.name == "body"))
    return {o.name: o for o in meshes}


# The felboar's enlarged hooves grew into each other: faces below this height that cross the centre line join the
# left and right hoof and tear when the legs step apart
HOOF_WEB_TOP = 0.3  # the real belly starts at ~0.4
# Rig-space y between the front hooves (y ~ -0.1) and the hind hooves (y ~ 0.6)
HOOF_SPLIT_Y = 0.25


def split_hooves(body):
    """Deletes the faces bridging left and right hooves and caps the hole each side is left with."""
    bm = bmesh.new()
    bm.from_mesh(body.data)
    # bridging faces join two hooves (left/right across the centre line, front/back along a side) or hang on
    # vertices sitting on the centre line, shared by both sides
    def hoof(v):
        return (v.co.x > 0, v.co.y > HOOF_SPLIT_Y)
    web = [f for f in bm.faces if max(v.co.z for v in f.verts) < HOOF_WEB_TOP
           and (len({hoof(v) for v in f.verts}) > 1 or min(abs(v.co.x) for v in f.verts) < 0.015)]
    bmesh.ops.delete(bm, geom=web, context="FACES")
    rim = [e for e in bm.edges if e.is_boundary and max(v.co.z for v in e.verts) < HOOF_WEB_TOP]
    filled = bmesh.ops.holes_fill(bm, edges=rim, sides=0)["faces"]
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(body.data)
    bm.free()
    print("HOOVES web faces", len(web), "caps", len(filled))


def pack(p):
    """Converts pack coordinates (x forward, y left) to rig space (-y forward)."""
    return Vector((p[1], -p[0], p[2]))


def leg_columns(body):
    """Leg centre (pack x, |y|) at hoof and knee height, measured on the mesh."""
    verts = [Vector((-v.co.y, v.co.x, v.co.z)) for v in body.data.vertices]
    out = {}
    for key, front in (("front", True), ("back", False)):
        for z in (0.06, 0.28):
            s = [v for v in verts if abs(v.z - z) < 0.04 and v.y > 0.04 and (v.x > -0.2) == front]
            out[key, z] = (sum(v.x for v in s) / len(s), sum(v.y for v in s) / len(s))
    return out


def build_bones(body):
    c = leg_columns(body)
    fx0, fy0 = c["front", 0.06]
    fx1, fy1 = c["front", 0.28]
    bx0, by0 = c["back", 0.06]
    bx1, by1 = c["back", 0.28]
    print("FIT front", (round(fx0, 3), round(fy0, 3)), (round(fx1, 3), round(fy1, 3)),
          "back", (round(bx0, 3), round(by0, 3)), (round(bx1, 3), round(by1, 3)))
    centre = {
        "root": ((0, 0, 0), (-0.25, 0, 0)),
        "hips": ((-0.55, 0, 0.72), (-0.40, 0, 0.74)),
        "spine_1": ((-0.40, 0, 0.74), (-0.20, 0, 0.78)),
        "spine_2": ((-0.20, 0, 0.78), (0.0, 0, 0.82)),
        "spine_3": ((0.0, 0, 0.82), (0.20, 0, 0.84)),
        "spine_4": ((0.20, 0, 0.84), (0.32, 0, 0.83)),
        "spine_5": ((0.32, 0, 0.83), (0.42, 0, 0.80)),
        "spine_6": ((0.42, 0, 0.80), (0.52, 0, 0.76)),
        "head": ((0.52, 0, 0.76), (0.90, 0, 0.58)),
        "nose": ((0.90, 0, 0.58), (0.98, 0, 0.57)),
        "head_leaf": ((0.98, 0, 0.57), (1.04, 0, 0.57)),
        "mouth": ((0.70, 0, 0.50), (0.80, 0, 0.47)),
        "mouth_tip": ((0.80, 0, 0.47), (0.88, 0, 0.46)),
        "ribcage_middle": ((0.0, 0, 0.60), (0.0, 0, 0.50)),
        "ribcage_leaf": ((0.0, 0, 0.50), (0.0, 0, 0.42)),
        "ribcage_front": ((0.30, 0, 0.60), (0.32, 0, 0.52)),
        "ribcage_front_leaf": ((0.32, 0, 0.52), (0.34, 0, 0.45)),
        "tail_1": ((-0.74, 0, 0.76), (-0.81, 0, 0.72)),
        "tail_2": ((-0.81, 0, 0.72), (-0.87, 0, 0.67)),
        "tail_3": ((-0.87, 0, 0.67), (-0.93, 0, 0.61)),
        "tail_4": ((-0.93, 0, 0.61), (-0.99, 0, 0.55)),
        "tail_leaf": ((-0.99, 0, 0.55), (-1.05, 0, 0.47)),
    }
    side = {
        "ear_1_%s": ((0.62, 0.10, 0.86), (0.63, 0.13, 0.92)),
        "ear_2_%s": ((0.63, 0.13, 0.92), (0.64, 0.15, 0.97)),
        "ear_leaf_%s": ((0.64, 0.15, 0.97), (0.645, 0.16, 1.01)),
        "front_scapula_%s": ((0.18, 0.10, 0.90), (fx1 + 0.02, fy1, 0.56)),
        "front_humerus_%s": ((fx1 + 0.02, fy1, 0.56), (fx1 + 0.03, fy1, 0.42)),
        "front_leg_upper_%s": ((fx1 + 0.03, fy1, 0.42), (fx1, fy1, 0.26)),
        "front_leg_lower_%s": ((fx1, fy1, 0.26), (fx0, fy0, 0.13)),
        "front_leg_ankle_%s": ((fx0, fy0, 0.13), (fx0, fy0, 0.07)),
        "front_leg_foot_%s": ((fx0, fy0, 0.07), (fx0 + 0.02, fy0, 0.02)),
        "front_leg_leaf_%s": ((fx0 + 0.02, fy0, 0.02), (fx0 + 0.07, fy0, 0.015)),
        "back_leg_pelvis_%s": ((-0.40, 0.06, 0.76), (bx1 + 0.08, by1, 0.60)),
        "back_leg_upper_%s": ((bx1 + 0.06, by1, 0.60), (bx1 + 0.02, by1, 0.42)),
        "back_leg_lower_%s": ((bx1 + 0.02, by1, 0.42), (bx1, by1, 0.26)),
        "back_leg_ankle_%s": ((bx1, by1, 0.26), (bx0, by0, 0.10)),
        "back_leg_foot_%s": ((bx0, by0, 0.10), (bx0 + 0.01, by0, 0.05)),
        "back_leg_toe_%s": ((bx0 + 0.01, by0, 0.05), (bx0 + 0.02, by0, 0.02)),
        "back_leg_leaf_%s": ((bx0 + 0.02, by0, 0.02), (bx0 + 0.07, by0, 0.015)),
    }
    bones = {n: (pack(h), pack(t)) for n, (h, t) in centre.items()}
    for pat, (h, t) in side.items():
        for s, sg in (("l", 1), ("r", -1)):
            bones[pat % s] = (pack((h[0], h[1] * sg, h[2])), pack((t[0], t[1] * sg, t[2])))
    return bones


NON_DEFORM = ("ribcage_middle", "ribcage_leaf", "ribcage_front", "ribcage_front_leaf",
              "mouth", "mouth_tip", "root")


# ----------------------------------------------------------------------------- rig + clips
def import_rig(bones, keep_meshes):
    bpy.ops.import_scene.gltf(filepath=os.path.join(M2M_DIR, "horse-animations.glb"))
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.name not in keep_meshes:
            mesh = o.data
            bpy.data.objects.remove(o)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
    for m in list(bpy.data.materials):
        if m.users == 0:
            bpy.data.materials.remove(m)
    arm.name = "Armature"

    ad = arm.animation_data
    ad.action = None
    for tr in list(ad.nla_tracks):
        ad.nla_tracks.remove(tr)
    for act in list(bpy.data.actions):
        if act.name not in CLIPS:
            bpy.data.actions.remove(act)
    for old, new in CLIPS.items():
        bpy.data.actions[old].name = new

    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    assert set(bones) == {b.name for b in eb}, set(b.name for b in eb) ^ set(bones)
    for b in eb:
        b.use_connect = False
    # Only heads and lengths are fitted; each bone keeps the horse rest orientation so the clips' local
    # rotations bend joints about the same axes as on the horse
    for name, (h, t) in bones.items():
        b = eb[name]
        roll, d = b.roll, (b.tail - b.head).normalized()
        b.head = h
        b.tail = h + d * max((t - h).length, 0.02)
        b.roll = roll
    for name in NON_DEFORM:
        eb[name].use_deform = False
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def local_axis(arm, bone, world_axis):
    return (arm.data.bones[bone].matrix_local.to_3x3().inverted() @ Vector(world_axis)).normalized()


def author_attack(arm, act):
    """Replaces the horse head-butt neck/head/hips motion with a tusk uppercut: the head drops low, then whips up
    in 3 frames to its highest point on frame 9 = the hit (ATTACK_HIT in src/config.ts), holds, settles back.
    In game only spine_5 and below play it (on top of the walk); the body lunge is done in code."""
    frames = [0, 4, 6, 9, 11, 16, 22, 29]
    pitch_deg = [0, 30, 40, -75, -70, -35, -10, 0]  # + = snout down
    lunge = [0.0, 0.04, 0.02, -0.2, -0.2, -0.12, -0.03, 0.0]
    dip = [0.0, 0.015, 0.02, -0.03, -0.03, 0.0, 0.0, 0.0]
    shares = {"spine_5": 0.25, "spine_6": 0.3, "head": 0.45}
    fx = pchip(frames, [math.radians(d) for d in pitch_deg])
    flx, fdz = pchip(frames, lunge), pchip(frames, dip)
    chans = {fc.data_path + f"[{fc.array_index}]": fc for fc in fcurves(act)}
    for b, share in shares.items():
        ax = local_axis(arm, b, (1, 0, 0))
        w = chans[f'pose.bones["{b}"].rotation_quaternion[0]']
        for kp_i in range(len(w.keyframe_points)):
            q = Quaternion(ax, fx(w.keyframe_points[kp_i].co.x) * share)
            for a in range(4):
                chans[f'pose.bones["{b}"].rotation_quaternion[{a}]'].keyframe_points[kp_i].co.y = q[a]
    inv = arm.data.bones["hips"].matrix_local.to_3x3().inverted()
    lx = chans['pose.bones["hips"].location[0]']
    for kp_i in range(len(lx.keyframe_points)):
        f = lx.keyframe_points[kp_i].co.x
        v = inv @ Vector((0, flx(f), fdz(f)))
        for a in range(3):
            chans[f'pose.bones["hips"].location[{a}]'].keyframe_points[kp_i].co.y = v[a]
    for fc in chans.values():
        fc.update()


# Horse tail rotations swing the short boar tail flat against the rump: keep this share of them (gentle sway)
TAIL_MOTION = 0.25


def damp_tail():
    tail = {"tail_1", "tail_2", "tail_3", "tail_4", "tail_leaf"}
    for act in bpy.data.actions:
        chans = {}
        for fc in fcurves(act):
            if fc.data_path.endswith("rotation_quaternion") and fc.data_path.split('"')[1] in tail:
                chans.setdefault(fc.data_path, {})[fc.array_index] = fc
        for comps in chans.values():
            for k in range(len(comps[0].keyframe_points)):
                q = Quaternion([comps[a].keyframe_points[k].co.y for a in range(4)])
                q = Quaternion().slerp(q, TAIL_MOTION)
                for a in range(4):
                    comps[a].keyframe_points[k].co.y = q[a]
            for fc in comps.values():
                fc.update()


def retime_actions():
    for act in bpy.data.actions:
        start = min(kp.co.x for fc in fcurves(act) for kp in fc.keyframe_points)
        for fc in fcurves(act):
            hips_loc = fc.data_path == 'pose.bones["hips"].location'
            for kp in fc.keyframe_points:
                kp.co.x = round((kp.co.x - start) * TIME_STRETCH)
                if hips_loc:
                    kp.co.y *= HIPS_LOC_SCALE
            fc.update()
        act.use_fake_user = True
        if act.name in ("idle", "walk"):
            for fc in fcurves(act):
                pts = fc.keyframe_points
                if len(pts) > 2:
                    pts[len(pts) - 1].co.y = pts[0].co.y
                    fc.update()


def ground_clip(arm, objs, name):
    """Lifts the hips per key so the deformed mesh never sinks below z = 0 (the horse lies down much lower than a
    stocky boar can)."""
    act = bpy.data.actions[name]
    ad = arm.animation_data
    ad.action = act
    ad.action_slot = act.slots[0]
    scene = bpy.context.scene
    chans = {fc.array_index: fc for fc in fcurves(act) if fc.data_path == 'pose.bones["hips"].location'}
    inv = arm.data.bones["hips"].matrix_local.to_3x3().inverted()
    lifts = []
    for kp in chans[0].keyframe_points:
        scene.frame_set(int(kp.co.x))
        dg = bpy.context.evaluated_depsgraph_get()
        low = min(min((o.matrix_world @ v.co).z for v in o.evaluated_get(dg).data.vertices) for o in objs)
        lifts.append(inv @ Vector((0, 0, max(0.0, -low))))
    for a, fc in chans.items():
        for kp, d in zip(fc.keyframe_points, lifts):
            kp.co.y += d[a]
        fc.update()
    ad.action = None
    print("GROUND", name, "max lift", round(max(d.length for d in lifts), 3))


def nla_setup(arm):
    ad = arm.animation_data
    for name in CLIPS.values():
        tr = ad.nla_tracks.new()
        tr.name = name
        tr.strips.new(name, 0, bpy.data.actions[name]).name = name
    ad.action = None


# ----------------------------------------------------------------------------- weights
def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length


CENTRAL = ["hips", "spine_1", "spine_2", "spine_3", "spine_4", "spine_5", "spine_6", "head"]
LIMB_TOPS = [("front_scapula_%s", 0.12), ("front_humerus_%s", 0.18), ("back_leg_pelvis_%s", 0.15),
             ("back_leg_upper_%s", 0.18)]
LEG_BONES = {
    "front": ["front_humerus_%s", "front_leg_upper_%s", "front_leg_lower_%s", "front_leg_ankle_%s", "front_leg_foot_%s"],
    "back": ["back_leg_upper_%s", "back_leg_lower_%s", "back_leg_ankle_%s", "back_leg_foot_%s", "back_leg_toe_%s"],
}
TAIL = ["hips", "tail_1", "tail_2", "tail_3", "tail_4", "tail_leaf"]
# Only the tail tube follows the tail: the rump and the hind hooves reach as far back as the tail root
TAIL_RADIUS = 0.08
# Hooves are rigid on the last leg bone: spread over the short horse ankle/foot/toe bones they scatter in the walk
HOOF = {"front": "front_leg_foot_%s", "back": "back_leg_toe_%s"}


class Weigher:
    def __init__(self, bones):
        self.seg = bones

    def inv(self, p, names, power, planar=False):
        q = Vector((0, p.y, p.z)) if planar else p
        w = {}
        for n in names:
            a, b = self.seg[n]
            if planar:
                a, b = Vector((0, a.y, a.z)), Vector((0, b.y, b.z))
            w[n] = 1.0 / (seg_dist(q, a, b) + 0.02) ** power
        return w

    def body(self, p):
        w = self.inv(p, CENTRAL, 3, planar=True)
        s = sum(w.values())
        w = {n: v / s for n, v in w.items()}
        side = "l" if p.x > 0 else "r"
        for pat, radius in LIMB_TOPS:
            n = pat % side
            f = max(0.0, 1 - seg_dist(p, *self.seg[n]) / radius) ** 2 * 1.3
            if f > 0:
                w[n] = w.get(n, 0) + f
        return w

    def __call__(self, p):
        fwd, side = -p.y, ("l" if p.x > 0 else "r")
        if fwd > 0.55 and p.z > 0.84 and abs(p.x) > 0.06:
            w = self.inv(p, ["head", f"ear_1_{side}", f"ear_2_{side}", f"ear_leaf_{side}"], 3)
        elif fwd > 0.6:
            w = {"head": 1.0}
        elif fwd < -0.72 and min(seg_dist(p, *self.seg[n]) for n in TAIL[1:]) < TAIL_RADIUS:
            w = self.inv(p, TAIL, 3)
        elif p.z < 0.55 and (abs(p.x) > 0.03 or p.z < 0.3):  # low down even the centre line is a leg (wide hooves)
            # Upper leg blends into the torso so the thigh never tears off the flank
            key = "front" if fwd > -0.2 else "back"
            names = [n % side for n in LEG_BONES[key]]
            # belly and throat skin between the legs stays on the body: leg share fades out away from the leg bones
            t = max(smooth(0.36, 0.55, p.z), smooth(0.12, 0.24, min(seg_dist(p, *self.seg[n]) for n in names)))
            leg = self.inv(p, names, 4)
            s = sum(leg.values())
            h = smooth(0.14, 0.06, p.z)
            w = {n: v / s * (1 - t) * (1 - h) for n, v in leg.items()}
            hoof = HOOF[key] % side
            w[hoof] = w.get(hoof, 0) + h
            body = self.body(p)
            s = sum(body.values())
            for n, v in body.items():
                w[n] = w.get(n, 0) + v / s * t
        else:
            w = self.body(p)
        top = sorted(w.items(), key=lambda kv: -kv[1])[:4]
        s = sum(v for _, v in top)
        return [(n, v / s) for n, v in top]


def apply_weights(obj, weigher, ref=None):
    """ref = body kd-tree: accessories (mane, tusks, spikes, ribs, tail tuft) follow the nearest body point."""
    groups = {}
    for v in obj.data.vertices:
        p = v.co
        if ref is not None:
            p = ref.find(p)[0]
        for n, w in weigher(p):
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
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    tris = 0
    for m in meshes:
        m.data.calc_loop_triangles()
        tris += len(m.data.loop_triangles)
    print("VERIFY meshes", [m.name for m in meshes], "tris", tris, "bones", len(arm.data.bones))
    acts = {a.name: a for a in bpy.data.actions}
    for n, a in acts.items():
        print("VERIFY action", n, tuple(a.frame_range), "s", round((a.frame_range[1] - a.frame_range[0]) / FPS, 3))

    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "TEXTURE"
    scene.render.resolution_x = scene.render.resolution_y = 480
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
    cam.data.ortho_scale = 2.6
    scene.collection.objects.link(cam)
    scene.camera = cam

    ad = arm.animation_data
    for tr in ad.nla_tracks:
        tr.mute = True

    def shot(label, act=None, frac=0.0, view="side"):
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
        target = Vector((0, 0, 0.5))
        cam.location = Vector((5, 0, 0.6)) if view == "side" else Vector((3.2, -3.2, 2.0))
        d = target - cam.location
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(PREVIEW_DIR, f"{OUT_NAME}_{label}.png")
        bpy.ops.render.render(write_still=True)

    shot("rest_34", view="34")
    shot("rest_side")
    for i, fr in enumerate((0.0, 0.25, 0.5, 0.75)):
        shot(f"walk_{i}", "walk", fr)
    shot("idle_mid", "idle", 0.5)
    for i, fr in enumerate((0.2, 0.4, 0.55)):
        shot(f"attack_{i}", "attack", fr)
    shot("death_mid", "death", 0.5)
    shot("death_end", "death", 1.0)
    shot("death_end_34", "death", 1.0, view="34")


def main():
    objs = load_model()
    body = objs["body"]
    bones = build_bones(body)
    arm = import_rig(bones, set(objs))
    bpy.context.scene.render.fps = FPS
    retime_actions()
    damp_tail()
    author_attack(arm, bpy.data.actions["attack"])

    weigher = Weigher(bones)
    kd = kdtree.KDTree(len(body.data.vertices))
    for v in body.data.vertices:
        kd.insert(v.co, v.index)
    kd.balance()
    for name, o in objs.items():
        apply_weights(o, weigher, None if o is body else kd)
        skin(o, arm)
    ground_clip(arm, list(objs.values()), "death")
    nla_setup(arm)
    bpy.ops.file.pack_all()
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_OUT)
    export_glb(list(objs.values()), arm)
    preview()


main()
