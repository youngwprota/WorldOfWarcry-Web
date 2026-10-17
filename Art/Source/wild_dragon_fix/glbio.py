"""Minimal GLB reader/writer (numpy only) for in-place accessor edits."""
import json, struct, numpy as np
CT = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
class Glb:
    def __init__(self, path):
        f = open(path, 'rb').read()
        jl = struct.unpack('<I', f[12:16])[0]
        self.j = json.loads(f[20:20 + jl])
        bl = struct.unpack('<I', f[20 + jl:24 + jl])[0]
        self.bin = bytearray(f[28 + jl:28 + jl + bl])
    def acc(self, i):
        a = self.j['accessors'][i]; bv = self.j['bufferViews'][a['bufferView']]
        n = NC[a['type']]; dt = CT[a['componentType']]
        off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        assert 'byteStride' not in bv
        return np.frombuffer(self.bin, dtype=dt, count=a['count'] * n, offset=off).reshape(a['count'], n)  # writable view
    def save(self, path):
        js = json.dumps(self.j, separators=(',', ':')).encode()
        js += b' ' * ((4 - len(js) % 4) % 4)
        b = bytes(self.bin); b += b'\0' * ((4 - len(b) % 4) % 4)
        total = 12 + 8 + len(js) + 8 + len(b)
        with open(path, 'wb') as o:
            o.write(struct.pack('<4sII', b'glTF', 2, total))
            o.write(struct.pack('<I4s', len(js), b'JSON')); o.write(js)
            o.write(struct.pack('<I4s', len(b), b'BIN\0')); o.write(b)
