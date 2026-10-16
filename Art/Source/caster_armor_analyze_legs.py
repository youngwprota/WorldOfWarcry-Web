import bpy, collections
def islands(me):
    key = {}
    par = {}
    for v in me.vertices:
        k = tuple(round(c, 3) for c in v.co)
        key[v.index] = key.setdefault(k, v.index)
    def find(a):
        while par.setdefault(a, a) != a:
            par[a] = par[par[a]]; a = par[a]
        return a
    for p in me.polygons:
        vs = [key[v] for v in p.vertices]
        for v in vs[1:]:
            par[find(vs[0])] = find(v)
    isl = collections.defaultdict(list)
    for v in me.vertices:
        isl[find(key[v.index])].append(v.index)
    return list(isl.values())
def side(n):
    if n.endswith('_l') or n.endswith('_left'): return 'L'
    if n.endswith('_r') or n.endswith('_right'): return 'R'
    return 'C'
for o in sorted(bpy.data.objects, key=lambda o: o.name):
    if o.type != 'MESH' or not o.name.startswith('legs_caster'): continue
    me = o.data; vg = {g.index: g.name for g in o.vertex_groups}
    iss = islands(me); mixed = 0; out = []
    for isl in iss:
        w = collections.Counter(); xs = []
        for vi in isl:
            xs.append(me.vertices[vi].co.x)
            for g in me.vertices[vi].groups:
                w[side(vg[g.group])] += g.weight
        if w['L'] > 1e-4 and w['R'] > 1e-4:
            mixed += 1
            out.append((len(isl), round(min(xs),1), round(max(xs),1), {k: round(v,1) for k, v in w.items()}))
    print(o.name, 'verts', len(me.vertices), 'islands', len(iss), 'mixed', mixed)
    for t in out[:6]: print('   ', t)
