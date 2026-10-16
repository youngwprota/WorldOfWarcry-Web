import bpy
for o in sorted(bpy.data.objects, key=lambda o:o.name):
    if o.type=='MESH':
        print(o.name, len(o.data.vertices), [s.material.name if s.material else None for s in o.material_slots][:12], 'parent', o.parent.name if o.parent else None, 'mods', [m.type for m in o.modifiers])
    elif o.type=='ARMATURE':
        print('ARM', o.name, len(o.data.bones), o.matrix_world.translation[:], o.scale[:])
a=bpy.data.objects['Armature_human']
print([b.name for b in a.data.bones])
