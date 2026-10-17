"""Smooth the dragon wing membranes in place (normals + winding + V gradient). Everything else in the GLB stays byte-identical.
Run: blender -b --factory-startup -P fix_wings.py -- <in.glb> <out.glb> [normal_blur=2] [v_blur=3] [v_contrast=0.6]
(blender only provides numpy; no bpy used)"""
import sys, collections, numpy as np
sys.path.insert(0, __import__('os').path.dirname(__import__('os').path.abspath(__file__)))
from glbio import Glb
a = sys.argv[sys.argv.index('--') + 1:]
src, dst = a[0], a[1]
NB = int(a[2]) if len(a) > 2 else 30
VB = int(a[3]) if len(a) > 3 else 6
VC = float(a[4]) if len(a) > 4 else 0.9
MIX = float(a[5]) if len(a) > 5 else 0.5   # weight of the per-piece mean normal blended into the blurred normals
JOIN = float(a[7]) if len(a) > 7 else -0.3  # cos limit for treating faces as one surface; only the opposite layer is kept apart
SIG = float(a[6]) if len(a) > 6 else 4.0   # spatial smoothing radius (model units); wing span is ~30

g = Glb(src)
P, N, UV, J = g.acc(0), g.acc(1), g.acc(2), g.acc(3)
Iflat = g.acc(5)
I = Iflat.reshape(-1, 3)
n0 = N.copy(); uv0 = UV.copy(); i0 = I.copy()
col = np.floor(UV[:, 0] * 16).astype(int)
# membrane = cloth columns 11 (brown) and 12 (red edge trims), top swatch row (gltf v < .5); only column 11 gets its V smoothed
vmem = ((col == 11) | (col == 12)) & (UV[:, 1] < 0.5)
mem = np.array([k for k, t in enumerate(I) if vmem[t].all()])
print('membrane tris', len(mem), 'verts', len(set(I[mem].ravel())))

pos_id = np.zeros(len(P), int); d = {}
for i in range(len(P)):
    pos_id[i] = d.setdefault(tuple(P[i].round(4)), len(d))

def fnormal(t):
    return np.cross(P[t[1]] - P[t[0]], P[t[2]] - P[t[0]])

# ---- 1. consistent winding over manifold edges (BFS), sign per component voted by the original vertex normals
E = collections.defaultdict(list)           # undirected pos edge -> [(tri, directed a->b)]
for k in mem:
    t = pos_id[I[k]]
    for x, y in ((0, 1), (1, 2), (2, 0)):
        E[(min(t[x], t[y]), max(t[x], t[y]))].append((k, t[x] < t[y]))
adj = collections.defaultdict(list)          # tri -> [(tri, need_flip_relation)]
for (_, _), lst in E.items():
    if len(lst) == 2:
        (k1, f1), (k2, f2) = lst
        adj[k1].append((k2, f1 == f2)); adj[k2].append((k1, f1 == f2))   # same direction on the shared edge => opposite orientation
flip = {}
comps = []
for s in mem:
    if s in flip: continue
    flip[s] = False; comp = [s]; q = [s]
    while q:
        k = q.pop()
        for k2, rel in adj[k]:
            want = flip[k] ^ rel
            if k2 not in flip:
                flip[k2] = want; comp.append(k2); q.append(k2)
    comps.append(comp)
print('components', len(comps), 'sizes', sorted(len(c) for c in comps)[::-1][:12])
nflip = 0
for comp in comps:
    vote = 0
    for k in comp:
        w = fnormal(I[k]) * (-1 if flip[k] else 1)
        vote += np.sign(float(w @ n0[I[k]].mean(0)))
    if vote < 0:
        for k in comp: flip[k] = not flip[k]
    nflip += sum(flip[k] for k in comp)
print('tris re-wound', nflip, '(votes per comp done)')
for k in mem:
    if flip[k]: I[k] = I[k][[0, 2, 1]]

# ---- 2. smooth nodes: vertices at one position whose faces point the same half-space share one node
fn = np.array([fnormal(t) for t in I]); area = np.linalg.norm(fn, axis=1); fnu = fn / np.maximum(area[:, None], 1e-12)
corner = collections.defaultdict(list)       # vertex -> [(tri, angle at vertex)]
for k in mem:
    t = I[k]
    for c in range(3):
        e1 = P[t[(c + 1) % 3]] - P[t[c]]; e2 = P[t[(c + 2) % 3]] - P[t[c]]
        ang = np.arccos(np.clip(e1 @ e2 / max(np.linalg.norm(e1) * np.linalg.norm(e2), 1e-12), -1, 1))
        corner[t[c]].append((k, ang))
mverts = sorted(corner)
ref = {v: sum(fnu[k] for k, _ in corner[v]) for v in mverts}
par = {v: v for v in mverts}
def find(x):
    while par[x] != x: par[x] = par[par[x]]; x = par[x]
    return x
bypos = collections.defaultdict(list)
for v in mverts: bypos[pos_id[v]].append(v)
for vs in bypos.values():
    for x in vs:
        for y in vs:
            if x < y and ref[x] @ ref[y] > JOIN * np.linalg.norm(ref[x]) * np.linalg.norm(ref[y]):
                par[find(x)] = find(y)
node = {v: find(v) for v in mverts}
nodes = sorted(set(node.values())); nidx = {n: i for i, n in enumerate(nodes)}
print('verts', len(mverts), '-> smooth nodes', len(nodes))

acc = np.zeros((len(nodes), 3))
for v in mverts:
    for k, ang in corner[v]:
        acc[nidx[node[v]]] += fnu[k] * ang      # angle weighted: big and small triangles contribute fairly
nn = acc / np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-9)
nbr = collections.defaultdict(set)
for k in mem:
    t = [nidx[node[x]] for x in I[k]]
    for x in range(3):
        nbr[t[x]].add(t[(x + 1) % 3]); nbr[t[x]].add(t[(x + 2) % 3])
for _ in range(NB):                           # extra blur: widen the gradients across big triangles
    new = nn.copy()
    for i in range(len(nodes)):
        if nbr[i]:
            # never pull in neighbours pointing to the other layer of the shell
            nsum = nn[i] + sum(nn[j] for j in nbr[i] if nn[j] @ nn[i] > JOIN) / len(nbr[i])
            new[i] = nsum / max(np.linalg.norm(nsum), 1e-9)
    nn = new
# spatial smoothing: also blends separate wing pieces that touch or overlap (no shared vertices), same facing only
npos = np.array([P[next(v for v in mverts if nidx[node[v]] == i)] for i in range(len(nodes))])
D2 = ((npos[:, None, :] - npos[None, :, :]) ** 2).sum(2)
W = np.exp(-D2 / (2 * SIG * SIG))
for _ in range(6):
    face = (nn @ nn.T) > 0.2
    nn = (W * face) @ nn
    nn /= np.maximum(np.linalg.norm(nn, axis=1, keepdims=True), 1e-9)
# pull every node toward the mean normal of its connected piece (same layer only): removes the hard panel creases
# that are left after the local blur and the facets that face away from the light
seen = {}; pieces = []
for i0_ in range(len(nodes)):
    if i0_ in seen: continue
    seen[i0_] = len(pieces); st = [i0_]; mem_ = [i0_]
    while st:
        x = st.pop()
        for y in nbr[x]:
            if y not in seen and nn[y] @ nn[x] > JOIN:
                seen[y] = len(pieces); st.append(y); mem_.append(y)
    pieces.append(mem_)
for mem_ in pieces:
    if len(mem_) < 8: continue
    mean = nn[mem_].sum(0); mean /= max(np.linalg.norm(mean), 1e-9)
    for i_ in mem_:
        m_ = nn[i_] * (1 - MIX) + mean * MIX * (1 if nn[i_] @ mean > 0 else 0)
        nn[i_] = m_ / max(np.linalg.norm(m_), 1e-9)
print('pieces', len(pieces), 'largest', sorted(len(p) for p in pieces)[::-1][:6])
for v in mverts: N[v] = nn[nidx[node[v]]]

# winding must follow the final normals: three.js flips the normal of back-facing triangles of a doubleSided material
fixed = 0
for k in mem:
    t = I[k]
    if fnormal(t) @ N[t].mean(0) < 0:
        I[k] = t[[0, 2, 1]]; fixed += 1
print('tris re-wound to follow smoothed normals', fixed)

# ---- 3. V gradient: average per node, then Laplacian blur, then pull toward the mean to calm contrast
vv = np.zeros(len(nodes)); cnt = np.zeros(len(nodes))
for v in mverts:
    if col[v] == 11: vv[nidx[node[v]]] += uv0[v, 1]; cnt[nidx[node[v]]] += 1
has = cnt > 0
vv[has] /= cnt[has]
for _ in range(VB):
    new = vv.copy()
    for i in np.nonzero(has)[0]:
        nb_ = [vv[j] for j in nbr[i] if has[j]]
        if nb_: new[i] = 0.5 * vv[i] + 0.5 * np.mean(nb_)
    vv = new
m = vv[has].mean()
vv = m + (vv - m) * VC - 0.02   # slightly brighter than the mean so the membrane keeps its warm highlight
for v in mverts:
    if col[v] == 11: UV[v, 1] = vv[nidx[node[v]]]
print('V range before %.3f..%.3f after %.3f..%.3f' % (uv0[mverts, 1].min(), uv0[mverts, 1].max(), vv[has].min(), vv[has].max()))
g.save(dst)
print('saved', dst)
