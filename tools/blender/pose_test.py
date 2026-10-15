"""Pose test: rest + posed render of the mythic tier per faction from the working blend.
Run: blender -b Art/Source/caster_armor_rigged.blend -P pose_test.py -- <out_dir> [rarity]"""
import bpy, sys, math
from mathutils import Matrix, Vector
args = sys.argv[sys.argv.index('--') + 1:]
OUT = args[0]
RARITY = args[1] if len(args) > 1 else 'mythic'
RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1100, 1100
scene.render.film_transparent = False
world = bpy.data.worlds.new('w'); world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.35, 0.37, 0.42, 1)
scene.world = world
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.lens = 40
for loc, e in (((3, -4, 4), 4.0), ((-4, -2, 2), 1.5)):
    l = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); l.data.energy = e
    l.location = loc; l.rotation_euler = (math.radians(55), 0, math.radians(35 if loc[0] > 0 else -60)); scene.collection.objects.link(l)

def rot(arm, bone, axis, deg):
    pb = arm.pose.bones[bone]
    M = pb.matrix.copy()
    T = Matrix.Translation(M.translation)
    R = Matrix.Rotation(math.radians(deg), 4, axis)
    pb.matrix = T @ R @ T.inverted() @ M
    bpy.context.view_layer.update()

def reset(arm):
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()

def show(fac, r):
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = o.hide_viewport = not (o.name.endswith(f'_caster_{fac}_{r}'))
        if o.type == 'ARMATURE':
            o.hide_render = True

for fac in ('human', 'orc'):
    arm = bpy.data.objects[f'Armature_{fac}']
    show(fac, RARITY)
    cam.location = (0.0, -6.0, 1.15); cam.rotation_euler = (math.radians(90), 0, 0)
    cam.location = (1.0, -3.4, 1.15); cam.rotation_euler = (math.radians(89), 0, math.radians(16)); cam.data.lens = 45
    reset(arm)
    scene.render.filepath = f'{OUT}/pose_{fac}_{RARITY}_rest.png'
    bpy.ops.render.render(write_still=True)
    # axes are armature-local: Y up, Z toward the viewer's back, X sideways (Blender import of the Y-up FBX)
    rot(arm, 'spine_01', 'Y', 25); rot(arm, 'spine_02', 'Z', 20); rot(arm, 'spine_03', 'X', 15)
    rot(arm, 'neck_01', 'Y', 20); rot(arm, 'head', 'X', 25); rot(arm, 'head', 'Y', 20)
    rot(arm, 'upperarm_l', 'Z', 35); rot(arm, 'lowerarm_l', 'Y', 30)
    rot(arm, 'upperarm_r', 'X', 40); rot(arm, 'clavicle_r', 'Z', -15)
    rot(arm, 'thigh_l', 'X', 30); rot(arm, 'thigh_r', 'X', -25)
    scene.render.filepath = f'{OUT}/pose_{fac}_{RARITY}_posed.png'
    bpy.ops.render.render(write_still=True)
    reset(arm)
print('POSE DONE')
