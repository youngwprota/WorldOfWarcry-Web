# python extract_skin.py <glb> <out.png>: pulls the body skin texture out of the murloc GLB (the source of the class/shading map).
import json, struct, sys
d = open(sys.argv[1], 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20 + jl]); off = 28 + jl
mat = next(m for m in j['materials'] if m['name'] == 'murloc_skin')
bv = j['bufferViews'][j['images'][j['textures'][mat['pbrMetallicRoughness']['baseColorTexture']['index']]['source']]['bufferView']]
open(sys.argv[2], 'wb').write(d[off + bv.get('byteOffset', 0):off + bv.get('byteOffset', 0) + bv['byteLength']])
