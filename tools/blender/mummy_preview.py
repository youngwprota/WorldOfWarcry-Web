"""Preview of the undead archer next to its mummy recolour (front + 3/4), in the bind (T) pose.
Run: blender -b --factory-startup -P mummy_preview.py -- <models_dir> <textures_dir> <out_dir>"""
import bpy, sys, math, os
models, tex, out = sys.argv[sys.argv.index('--') + 1:][:3]
scene = bpy.context.scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o)
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1400, 1000
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('w'); world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.30, 0.31, 0.34, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 1.0
scene.world = world

def imp(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(models, name + '.fbx'))
    return [o for o in bpy.data.objects if o not in before]

from mathutils import Euler

def reset_pose(arm):
    arm.animation_data_create(); arm.animation_data.action = None
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
        pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()

def material(name, albedo, glow):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = 1.0
    for k in ('Specular IOR Level', 'Metallic'):
        if k in b.inputs: b.inputs[k].default_value = 0.0
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(os.path.join(tex, albedo)); t.interpolation = 'Linear'
    nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    g = nt.nodes.new('ShaderNodeTexImage'); g.image = bpy.data.images.load(os.path.join(tex, glow))
    nt.links.new(g.outputs['Color'], b.inputs['Emission Color']); b.inputs['Emission Strength'].default_value = 1.0
    return m

mats = {'orig': material('orig', 'undead_units_texture.png', 'undead_units_glow.png'),
        'mummy': material('mummy', 'mummy_undead_units_albedo.png', 'undead_units_glow.png')}
chars = {}
for key, x in (('orig', -0.75), ('mummy', 0.75)):
    objs = imp('undead_archer')
    arm = next(o for o in objs if o.type == 'ARMATURE')
    reset_pose(arm)
    chars[key] = (arm, objs, x, arm.rotation_euler.to_quaternion())
    for o in objs:
        if o.type == 'MESH':
            o.data.materials.clear(); o.data.materials.append(mats[key])
bpy.context.view_layer.update()

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
cam.data.lens = 60
for loc, e in (((3, -4, 5), 3.5), ((-4, -2, 2), 1.2)):
    l = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); l.data.energy = e
    l.rotation_euler = (math.radians(55), 0, math.radians(35 if loc[0] > 0 else -60)); scene.collection.objects.link(l)
cam.location = (0, -6.2, 0.95); cam.rotation_euler = (math.radians(90), 0, 0)

for view, yaw in (('front', 0), ('three_quarter', -38)):
    for key, (arm, objs, x, base) in chars.items():
        arm.location = (x, 0, 0); arm.rotation_mode = 'QUATERNION'
        arm.rotation_quaternion = Euler((0, 0, math.radians(yaw))).to_quaternion() @ base
    bpy.context.view_layer.update()
    scene.render.filepath = os.path.join(out, f'mummy_{view}.png')
    bpy.ops.render.render(write_still=True)
print('dims', {k: tuple(round(d, 2) for d in v[0].dimensions) for k, v in chars.items()})
