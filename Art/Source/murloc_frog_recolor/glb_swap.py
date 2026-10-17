# python glb_swap.py <in.glb> <skin.png> <out.glb> <material name>
# Replaces the body skin texture inside a GLB (binary patch: mesh, rig and clips stay byte-identical) and renames its material.
import json, struct, sys
src, png, dst, matname = sys.argv[1:5]
d = open(src, 'rb').read()
jl, _ = struct.unpack('<II', d[12:20]); j = json.loads(d[20:20 + jl])
bl = struct.unpack('<I', d[20 + jl:24 + jl])[0]; bin0 = d[28 + jl:28 + jl + bl]
mat = next(m for m in j['materials'] if m['name'] == 'murloc_skin')
img = j['images'][j['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source']]
target = img['bufferView']
img['name'] = matname; mat['name'] = matname
views = j['bufferViews']; out = bytearray()
for i, bv in sorted(enumerate(views), key=lambda t: t[1].get('byteOffset', 0)):
    o = bv.get('byteOffset', 0)
    data = open(png, 'rb').read() if i == target else bin0[o:o + bv['byteLength']]
    while len(out) % 4: out += b'\0'
    bv['byteOffset'] = len(out); bv['byteLength'] = len(data); out += data
while len(out) % 4: out += b'\0'
j['buffers'][0]['byteLength'] = len(out)
js = json.dumps(j, separators=(',', ':')).encode()
while len(js) % 4: js += b' '
total = 12 + 8 + len(js) + 8 + len(out)
open(dst, 'wb').write(struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out))
print('wrote', dst, total)
