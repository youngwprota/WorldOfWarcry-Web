"""Exports the 12 skinned caster armour FBX files for the three.js game.

Run:  blender -b "Art/Source/caster_armor_rigged.blend" -P caster_armor_export.py
Output: public/assets/models/casters/<human|orc>_caster_<rarity>.fbx  (armature + head_/chest_/arms_/legs_ meshes of one tier)

FBX settings reproduce the original mage.fbx / orc_shaman.fbx exactly (verified by re-import and by FBXLoader bind
matrices): Y up, -Z forward, FBX_SCALE_NONE + unit scale (cm geometry, bind matrix = identity), no leaf bones, no anim.

Materials are rewritten for export only (nothing is saved back): FBX carries a Phong-like material, so each Blender
material becomes
  DiffuseColor = Base Color (tint colour for the tinted texture materials), sRGB-encoded because FBXLoader treats
                 file colours as sRGB and converts them to linear,
  EmissiveColor/EmissiveFactor = Emission colour (sRGB-encoded) / strength,
  texture = the real file in public/assets/textures (relative path ../textures/<file>), only for textured materials.
"""
import bpy, os

REPO = 'C:/Unity proj/WorldOfWarcry-Web'
MODELS = REPO + '/public/assets/models'
TEX_DIR = REPO + '/public/assets/textures'
RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']
PARTS = ['head', 'chest', 'arms', 'legs']


def enc(c):
    c = max(c, 0.0)
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def prep_material(mat):
    nt = mat.node_tree
    p = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    bc, em, es = p.inputs['Base Color'], p.inputs['Emission Color'], p.inputs['Emission Strength']
    color, img = tuple(bc.default_value[:3]), None
    if bc.is_linked:
        color, gray, tint = (1.0, 1.0, 1.0), False, None
        stack = [bc.links[0].from_node]
        while stack:
            n = stack.pop()
            if n.type == 'VECT_MATH' and n.operation == 'MULTIPLY':
                tint = tuple(n.inputs[1].default_value[:3])
            elif n.type == 'HUE_SAT' and n.inputs['Saturation'].default_value == 0:
                gray = True
            elif n.type == 'TEX_IMAGE':
                img = n.image
            for i in n.inputs:
                stack.extend(l.from_node for l in i.links)
        if tint:
            color = tint
        if gray:
            img = bpy.data.images.load(f'{TEX_DIR}/orc_shaman_albedo_gray.png', check_existing=True)
        for n in list(nt.nodes):
            if n.type not in ('BSDF_PRINCIPLED', 'OUTPUT_MATERIAL'):
                nt.nodes.remove(n)
    emit = tuple(em.default_value[:3]) if es.default_value > 0 else (0.0, 0.0, 0.0)
    bc.default_value = (*(enc(c) for c in color), 1.0)
    em.default_value = (*(enc(c) for c in emit), 1.0)
    if img:
        tex = nt.nodes.new('ShaderNodeTexImage')
        tex.image = img
        nt.links.new(tex.outputs['Color'], bc)
    return img.filepath if img else None


def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def main():
    mats = {s.material for o in bpy.data.objects if o.type == 'MESH' and not o.name.startswith('src_')
            for s in o.material_slots if s.material}
    used = {}
    for m in sorted(mats, key=lambda m: m.name):
        used[m.name] = prep_material(m)
    for fac in ('human', 'orc'):
        arm = bpy.data.objects[f'Armature_{fac}']
        for r in RARITIES:
            meshes = [bpy.data.objects[f'{p}_caster_{fac}_{r}'] for p in PARTS]
            for o in bpy.data.objects:
                o.select_set(False)
            for o in [arm] + meshes:
                o.select_set(True)
            bpy.context.view_layer.objects.active = arm
            arm.name = 'Armature'
            path = f'{MODELS}/casters/{fac}_caster_{r}.fbx'
            bpy.ops.export_scene.fbx(
                filepath=path, use_selection=True, object_types={'ARMATURE', 'MESH'},
                axis_forward='-Z', axis_up='Y', apply_scale_options='FBX_SCALE_NONE', global_scale=1.0,
                apply_unit_scale=True, bake_space_transform=False, use_mesh_modifiers=True,
                use_armature_deform_only=False, add_leaf_bones=False, primary_bone_axis='Y', secondary_bone_axis='X',
                bake_anim=False, use_triangles=True, path_mode='RELATIVE', embed_textures=False)
            arm.name = f'Armature_{fac}'
            print(f'EXPORTED {path} tris={sum(tris(o) for o in meshes)} ' + ' '.join(f'{o.name}={tris(o)}' for o in meshes))
    print('TEXTURES', {k: v for k, v in used.items() if v})


main()
