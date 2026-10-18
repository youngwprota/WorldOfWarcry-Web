"""Workbench walk-pose renders of the BASE orc mage FBX (orc_shaman.fbx or a backup copy), imported fresh.
Run: blender -b --factory-startup -P caster_orc_base_render.py -- <fbx> <out_dir> <tag>
Output: <out_dir>/<tag>_<view>.png  (same views/frames as caster_orc_kilt_render.py; nothing is saved)
"""
import bpy, sys
from mathutils import Vector

FBX, OUT, TAG = sys.argv[sys.argv.index('--') + 1:][:3]
for o in [o for o in bpy.data.objects if o.name in ('Camera', 'Light', 'Cube')]:
    bpy.data.objects.remove(o)
bpy.ops.import_scene.fbx(filepath=FBX)
_arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
_before = set(bpy.data.objects)
bpy.ops.import_scene.fbx(filepath='C:/Unity proj/WorldOfWarcry-Web/public/assets/models/Walk.fbx')
_walk = bpy.data.actions[-1]
for _o in [o for o in bpy.data.objects if o not in _before]:
    bpy.data.objects.remove(_o)
_arm.animation_data_create()
_arm.animation_data.action = _walk
_arm.animation_data.action_slot = _walk.slots[0]

for m in bpy.data.materials:
    if m.use_nodes:
        p = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if p and not p.inputs['Base Color'].is_linked:
            m.diffuse_color = p.inputs['Base Color'].default_value

sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.render.resolution_x = sc.render.resolution_y = 800
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'MATERIAL'
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


def render(pose, center, scale, loc, tag):
    sc.frame_set(pose)
    bpy.context.view_layer.update()
    tgt.location = center
    cam.location = loc
    cam.data.ortho_scale = scale
    sc.render.filepath = f'{OUT}/{TAG}_{tag}.png'
    bpy.ops.render.render(write_still=True)
    print('RENDERED', sc.render.filepath)


mid, low, feet = Vector((0, 0, 0.62)), Vector((0, 0, 0.42)), Vector((0, 0, 0.1))
render(13, mid, 1.9, Vector((0, -6, 0.9)), 'f13_front')
render(13, mid, 1.9, Vector((6, 0, 0.9)), 'f13_side')
render(34, mid, 1.9, Vector((0, 6, 0.9)), 'f34_back')
render(40, low, 0.9, Vector((4, -4.5, 0.9)), 'f40_close34')
render(13, feet, 0.9, Vector((0, -3, 5.3)), 'f13_top60_front')
render(34, feet, 0.9, Vector((0, 3, 5.3)), 'f34_top60_back')
render(40, feet, 0.9, Vector((3, -3, 5.3)), 'f40_top60_34')
