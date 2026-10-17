# blender -b --factory-startup -P bake.py -- <murloc glb> <out.npz>
# Rasterises the body mesh in UV space: per texel the 3D position, normal and bone-category weights.
# Everything downstream (frog patterns) is painted from this map, so it does not depend on the UV layout.
import bpy, sys, numpy as np
GLB, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
body = bpy.data.objects['body']; me = body.data
N = 1024
CATS = ['head', 'torso', 'arm', 'hand', 'leg', 'foot', 'tail', 'jaw']
def cat(n):
    if n.startswith('Chin'): return 7
    if n.startswith(('Head', 'Nose')): return 0
    if n.startswith(('Hand', 'Finger', 'Thumb')): return 3
    if n.startswith('Front_Leg'): return 2
    if n.startswith(('Back_Leg_Foot', 'Back_Leg_Tip', 'Back_Leg_Ankle')): return 5
    if n.startswith('Back_Leg'): return 4
    if n.startswith('Tail'): return 6
    return 1
gname = [g.name for g in body.vertex_groups]
vc = np.zeros((len(me.vertices), len(CATS)), np.float32)
for v in me.vertices:
    for g in v.groups: vc[v.index, cat(gname[g.group])] += g.weight
vp = np.array([v.co[:] for v in me.vertices], np.float32)
uv = np.array([d.uv[:] for d in me.uv_layers[0].data], np.float32).reshape(-1, 2)
nrm = np.array([c.vector[:] for c in me.corner_normals], np.float32).reshape(-1, 3)
pos = np.zeros((N, N, 3), np.float32); nor = np.zeros((N, N, 3), np.float32); cw = np.zeros((N, N, len(CATS)), np.float32)
cover = np.zeros((N, N), np.int16); fid = -np.ones((N, N), np.int32)
me.calc_loop_triangles()
for ti, t in enumerate(me.loop_triangles):
    L = t.loops; V = t.vertices
    p = uv[list(L)] * N; p[:, 1] = (1 - uv[list(L)][:, 1]) * N  # image rows run top-down
    x0, x1 = int(np.floor(p[:, 0].min())) - 1, int(np.ceil(p[:, 0].max())) + 1
    y0, y1 = int(np.floor(p[:, 1].min())) - 1, int(np.ceil(p[:, 1].max())) + 1
    x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, N), min(y1, N)
    if x1 <= x0 or y1 <= y0: continue
    xs, ys = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
    d = (p[1, 1] - p[2, 1]) * (p[0, 0] - p[2, 0]) + (p[2, 0] - p[1, 0]) * (p[0, 1] - p[2, 1])
    if abs(d) < 1e-9: continue
    a = ((p[1, 1] - p[2, 1]) * (xs - p[2, 0]) + (p[2, 0] - p[1, 0]) * (ys - p[2, 1])) / d
    b = ((p[2, 1] - p[0, 1]) * (xs - p[2, 0]) + (p[0, 0] - p[2, 0]) * (ys - p[2, 1])) / d
    c = 1 - a - b
    m = (a >= -0.02) & (b >= -0.02) & (c >= -0.02)  # slight overscan closes seams
    if not m.any(): continue
    sl = (slice(y0, y1), slice(x0, x1))
    w = np.stack([a, b, c], -1)[m]
    pos[sl][m] = w @ vp[list(V)]
    nor[sl][m] = w @ nrm[list(L)]
    cw[sl][m] = w @ vc[list(V)]
    cover[sl][m] += 1; fid[sl][m] = ti
print('covered', int((cover > 0).sum()), 'overlap', int((cover > 1).sum()))
np.savez_compressed(OUT, pos=pos, nor=nor, cw=cw, cover=cover, fid=fid)
