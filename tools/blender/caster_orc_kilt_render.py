"""Workbench walk-pose renders of an ORC caster tier (nothing is saved to the .blend).
Run: blender -b <blend> --factory-startup -P caster_orc_kilt_render.py -- <out_dir> <tag> <rarity> [<rarity> ...]
Output: <out_dir>/<tag>_<rarity>_<view>.png  (front / side / back / mid-stride 3/4 / close-ups of the waist-to-hem band)
"""
import bpy, sys
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
OUT, TAG, RARS = args[0], args[1], args[2:]
sys.argv = ['x']
exec(open('C:/Unity proj/WorldOfWarcry-Web/Art/Source/caster_armor_legfix.py').read().split("if MODE == 'test'")[0])

for m in bpy.data.materials:
    if not m.use_nodes:
        continue
    p = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not p:
        continue
    if p.inputs['Emission Strength'].default_value > 0:
        m.diffuse_color = (*p.inputs['Emission Color'].default_value[:3], 1)
    elif not p.inputs['Base Color'].is_linked:
        m.diffuse_color = p.inputs['Base Color'].default_value

sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.render.resolution_x = sc.render.resolution_y = 800
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'TEXTURE'
sc.display.shading.show_cavity = False
sc.view_settings.view_transform = 'Standard'
sc.world = bpy.data.worlds.new('w') if not sc.world else sc.world
sc.world.color = (0.55, 0.57, 0.62)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.type = 'ORTHO'
sc.collection.objects.link(cam)
sc.camera = cam
tgt = bpy.data.objects.new('tgt', None)
sc.collection.objects.link(tgt)
c = cam.constraints.new('TRACK_TO')
c.target, c.track_axis, c.up_axis = tgt, 'TRACK_NEGATIVE_Z', 'UP_Y'
PARTS = ['head', 'chest', 'arms', 'legs']

# the game's own Walk clip (public/assets/models/Walk.fbx, no kilt bones animated) applied to the orc armature
_before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath='C:/Unity proj/WorldOfWarcry-Web/public/assets/models/Walk.fbx')
_walk = bpy.data.actions[-1]
for _o in [o for o in bpy.data.objects if o not in _before]:
    bpy.data.objects.remove(_o)
_arm = bpy.data.objects['Armature_orc']
_arm.animation_data_create()
_arm.animation_data.action = _walk
_arm.animation_data.action_slot = _walk.slots[0]


def render(rar, pose, center, scale, loc, tag):
    arm = bpy.data.objects['Armature_orc']
    keep = {arm.name} | {f'{p}_caster_orc_{rar}' for p in PARTS}
    for o in bpy.data.objects:
        if o.type in ('MESH', 'ARMATURE'):
            o.hide_render = o.name not in keep
    sc.frame_set(pose)
    bpy.context.view_layer.update()
    tgt.location = center
    cam.location = loc
    cam.data.ortho_scale = scale
    sc.render.filepath = f'{OUT}/{TAG}_{rar}_{tag}.png'
    bpy.ops.render.render(write_still=True)
    print('RENDERED', sc.render.filepath)


mid, low = Vector((0, 0, 0.62)), Vector((0, 0, 0.42))
for rar in RARS:
    # world Z up; character front is -Y (local +Z), left leg (thigh_l) at world +X
    # walk frames: 13 = left thigh far forward, 34 = right thigh far forward, 40 = left calf folded back
    render(rar, 13, mid, 1.6, Vector((6, 0, 0.62)), 'f13_side')
    render(rar, 13, mid, 1.6, Vector((0, -6, 0.62)), 'f13_front')
    render(rar, 34, mid, 1.6, Vector((0, 6, 0.62)), 'f34_back')
    render(rar, 34, mid, 1.6, Vector((-6, 0, 0.62)), 'f34_side')
    render(rar, 40, low, 0.9, Vector((4, -4.5, 0.9)), 'f40_close34')
    render(rar, 13, low, 0.9, Vector((-4, 4.5, 0.9)), 'f13_back_close')
    # game camera: ~60 deg elevation from the front / back
    feet = Vector((0, 0, 0.1))
    render(rar, 13, feet, 0.9, Vector((0, -3, 5.3)), 'f13_top60_front')
    render(rar, 34, feet, 0.9, Vector((0, 3, 5.3)), 'f34_top60_back')
    render(rar, 40, feet, 0.9, Vector((3, -3, 5.3)), 'f40_top60_34')
