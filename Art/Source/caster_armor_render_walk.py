"""Workbench previews of a human caster tier in a walking pose (legs apart). Nothing is saved to the .blend.
Run: blender -b caster_armor_rigged.blend --factory-startup -P caster_armor_render_walk.py -- <rarity> [<rarity> ...]
Output: previews_casters_rigged/walk_<fac>_<rarity>_<view>.png
"""
import bpy, sys, math
from mathutils import Vector

sys.argv_backup = sys.argv
args = sys.argv[sys.argv.index('--') + 1:]
sys.argv = ['x']
exec(open('C:/Unity proj/WorldOfWarcry-Web/Art/Source/caster_armor_legfix.py').read().split("if MODE == 'test'")[0])
OUT = 'C:/Unity proj/WorldOfWarcry-Web/Art/Source/previews_casters_rigged'

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


def render(fac, rar, view, pose_name, center, scale, loc, tag):
    arm = bpy.data.objects[f'Armature_{fac}']
    keep = {arm.name} | {f'{p}_caster_{fac}_{rar}' for p in PARTS}
    for o in bpy.data.objects:
        if o.type in ('MESH', 'ARMATURE'):
            o.hide_render = o.name not in keep
    set_pose(arm, POSES[pose_name] if pose_name else [])
    tgt.location = center
    cam.location = loc
    cam.data.ortho_scale = scale
    sc.render.filepath = f'{OUT}/walk_{fac}_{rar}_{tag}.png'
    bpy.ops.render.render(write_still=True)
    print('RENDERED', sc.render.filepath)


for rar in args:
    # world: Z up, character ~1.28 m tall, faces +Y (armature object is rotated 90 deg about X, scale 0.01)
    mid = Vector((0, 0, 0.74))
    render('human', rar, 'side', 'walk_a', mid, 2.0, Vector((6, 0, 0.74)), 'side')
    render('human', rar, '34', 'walk_a', mid, 2.0, Vector((4, 4.5, 1.7)), '34front')
    render('human', rar, 'wide', 'wide', mid, 2.0, Vector((0, 6, 0.74)), 'front_wide')
    pad = bpy.data.objects['Armature_human'].matrix_world @ bpy.data.objects['Armature_human'].data.bones['sholder_pad_left'].head_local
    render('human', rar, 'pad', None, pad, 0.5, pad + Vector((2, 3.5, 1.2)), 'pauldron_closeup')
