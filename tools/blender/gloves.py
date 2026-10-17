"""Showcase gloves: the three gacha gloves (items.ts GACHA_GEAR) of every quality for the forge (src/forge3d.ts) and
their icons. Not worn on the character (the hero shows his class set's arms). Each kind has its own silhouette:
power — a plated gauntlet with knuckle spikes, crit — an archer's leather glove with a bracer, laces and talons,
haste — a light wrapped glove with wings at the wrist. The higher the quality, the richer: metal, stones, spikes,
glowing runes, crystal shards (same metal / stone ladder as tools/blender/jewels.py, whose helpers it uses).

blender -b --factory-startup --python-exit-code 1 -P tools/blender/gloves.py -- [only_name ...]
Output: public/assets/models/gloves_{power,crit,haste}_<rarity>.glb (Blender Z up, fingers up, the back of a right
hand faces -Y = the camera). Icons: icon_render.py <glb> <png> 1.1 0 25 0 10 studio, then icon_shrink.py.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

from jewels import (DIAMOND, GEM, METAL, MODELS, RARITIES, TAU, X, Y, Z, Mesh, brilliant, cabochon, halo, lathe,  # noqa: E402
                    leaf, material, me_tris, prongs, rope, setting, sphere, spike, spline, sweep, to_object, torus)

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
MET, GEMI, DIA, LTH, DRK = range(5)  # material slots
# per kind: base (leather / cloth) and trim (laces / wraps) colours, their roughness
SKIN = {"power": ((0.07, 0.04, 0.025), (0.03, 0.02, 0.015), 0.55),
        "crit": ((0.3, 0.14, 0.05), (0.07, 0.035, 0.015), 0.6),
        "haste": ((0.03, 0.07, 0.2), (0.78, 0.64, 0.42), 0.85)}
SQ = 0.8  # the wrist and the cuffs are flatter front to back
E = 0.6  # superellipse exponent of the hand's section
BACK = -math.pi / 2  # angle of the back of the hand (-Y)


# ---------- the hand ----------

def sect(z):
    """Half width, half thickness of the hand at height z (wrist 0, knuckles ~0.9)."""
    keys = [(-0.1, 0.33, 0.25), (0.2, 0.42, 0.23), (0.5, 0.47, 0.21), (0.78, 0.49, 0.18), (0.92, 0.46, 0.14), (1.0, 0.36, 0.09)]
    if z <= keys[0][0]:
        return keys[0][1:]
    for (z0, w0, t0), (z1, w1, t1) in zip(keys, keys[1:]):
        if z <= z1:
            f = (z - z0) / (z1 - z0)
            return w0 + (w1 - w0) * f, t0 + (t1 - t0) * f
    return keys[-1][1:]


def hand_pt(z, a, off=0.0):
    w, t = sect(z)
    c, s = math.cos(a), math.sin(a)
    return Vector((math.copysign(abs(c) ** E, c) * (w + off), math.copysign(abs(s) ** E, s) * (t + off), z))


def hand_n(z, a):
    da = hand_pt(z, a + 0.01) - hand_pt(z, a - 0.01)
    dz = hand_pt(z + 0.01, a) - hand_pt(z - 0.01, a)
    n = da.cross(dz).normalized()
    p = hand_pt(z, a)
    return n if n.dot(Vector((p.x, p.y, 0))) > 0 else -n


def palm(m):
    rows = []
    for i in range(16):
        z = -0.1 + 1.1 * i / 15
        rows.append([hand_pt(z, TAU * j / 40) for j in range(40)])
    ids = m.grid(rows, LTH, True)
    m.fan(ids[-1], Vector((0, 0, 1.02)), LTH, True)
    m.fan(ids[0], Vector((0, 0, -0.1)), LTH, True)


# index .. pinky: knuckle x, length, radius, spread
FINGERS = [(-0.3, 0.8, 0.1, -0.07), (-0.1, 0.88, 0.106, 0.0), (0.11, 0.82, 0.1, 0.05), (0.31, 0.64, 0.087, 0.13)]
CURL = (0.2, 0.38, 0.32)
PHAL = (0.45, 0.31, 0.24)


def finger_path(x, length, spread, z0=0.86):
    d = Vector((spread, 0, 1)).normalized()
    p = Vector((x, 0.0, z0))
    joints = [p.copy()]
    for f, c in zip(PHAL, CURL):
        d = Matrix.Rotation(-c, 3, "X") @ d  # curl toward the palm (+Y)
        p = p + d * length * f
        joints.append(p.copy())
    return joints, d


def thumb_path():
    p = Vector((-0.36, 0.0, 0.3))
    d = Vector((-0.85, -0.12, 0.5)).normalized()
    joints = [p.copy()]
    for ln in (0.3, 0.26, 0.22):
        d = (d + Vector((0.14, 0.1, 0.22))).normalized()
        p = p + d * ln
        joints.append(p.copy())
    return joints, d


def digits(m):
    """The four fingers and the thumb: [(path, joints, radius, tip direction)]."""
    out = []
    for x, ln, r, sp in FINGERS:
        joints, d = finger_path(x, ln, sp)
        out.append((joints, r, d))
    joints, d = thumb_path()
    out.append((joints, 0.115, d))
    res = []
    for joints, r, d in out:
        path = spline(joints, 6)
        sweep(m, path, lambda t, r=r: r * (1.0 - 0.14 * t + 0.06 * math.sin(math.pi * 3 * t) ** 2), LTH, prof=12)
        sphere(m, joints[-1], r * 0.86, LTH, 12)
        res.append((path, joints, r, d))
    return res


def horn(m, base, d, bend, length, w, mat, prof=8):
    """Curved tapering horn / talon from `base` along `d`, curling toward `bend`."""
    d, bend = Vector(d).normalized(), Vector(bend).normalized()
    ctrl = [Vector(base) + d * length * t + bend * length * 0.45 * t * t for t in (0, 0.33, 0.66, 1.0)]
    sweep(m, spline(ctrl, 6), lambda t: w * (1 - t) ** 0.85 + 0.004, mat, prof=prof)


def plate(m, f, nu, nv, th, mat):
    """A plate of thickness `th` over the surface f(u, v) -> (point, outward normal), with side walls."""
    P = [[f(i / (nu - 1), j / (nv - 1)) for i in range(nu)] for j in range(nv)]
    top = m.grid([[p + n * th for p, n in row] for row in P], mat, True, cu=False)
    bot = m.grid([[p for p, n in row] for row in P], mat, True, cu=False)
    edge = [(0, i) for i in range(nu)] + [(j, nu - 1) for j in range(1, nv)] + \
           [(nv - 1, i) for i in range(nu - 2, -1, -1)] + [(j, 0) for j in range(nv - 2, 0, -1)]
    for k in range(len(edge)):
        a, b = edge[k], edge[(k + 1) % len(edge)]
        m.face((top[a[0]][a[1]], top[b[0]][b[1]], bot[b[0]][b[1]], bot[a[0]][a[1]]), mat, False)


def ribbon(m, pts, nrm, w, th, mat):
    """Flat strap along `pts` lying on a surface with normals `nrm`."""
    n = len(pts)
    rows = []
    for i in range(n):
        T = (pts[min(n - 1, i + 1)] - pts[max(0, i - 1)]).normalized()
        N = (nrm[i] - T * nrm[i].dot(T)).normalized()
        B = T.cross(N)
        q = pts[i]
        rows.append([q + B * w + N * th, q - B * w + N * th, q - B * w - N * th * 0.2, q + B * w - N * th * 0.2])
    ids = m.grid(rows, mat, False, cu=True)
    m.face(ids[0], mat, False)
    m.face(ids[-1], mat, False)


def squash(m, since):
    m.transform(since, lambda q: Vector((q.x, q.y * SQ, q.z)))


# ---------- cuffs: a surface of revolution about Z, squashed along Y ----------

def cuff(m, R, z0, z1, mat, lip=0.05, rows=18):
    s0 = m.mark()
    prof = [(R(z0) - lip * 1.5, z0 + 0.3), (R(z0) - lip, z0)]
    prof += [(R(z0 + (z1 - z0) * i / rows), z0 + (z1 - z0) * i / rows) for i in range(rows + 1)]
    lathe(m, (0, 0, 0), Z, prof, mat, 48)
    squash(m, s0)


def cuff_pt(R, z, a, off=0.0):
    r = R(z) + off
    return Vector((r * math.cos(a), SQ * r * math.sin(a), z))


def cuff_n(R, z, a):
    dr = (R(z + 0.01) - R(z - 0.01)) / 0.02
    return Vector((math.cos(a), math.sin(a) / SQ, -dr)).normalized()


def cuff_ring(m, R, z, off, r, mat, seg=48):
    s0 = m.mark()
    torus(m, (0, 0, z), Z, R(z) + off, r, mat, seg, 8)
    squash(m, s0)


def back_gem(m, z, rg, k, lift, mat=GEMI, claws=6):
    """A faceted stone on the back of the hand at height z, in a cup and claws; returns its centre and normal."""
    n = hand_n(z, BACK)
    base = hand_pt(z, BACK) + n * lift
    gc = base + n * rg * 0.95
    setting(m, gc, n, rg, MET)
    brilliant(m, gc, n, rg, mat, 12 if k < 4 else 16)
    prongs(m, gc, n, rg, claws, 0.035 + 0.004 * k, MET, 0.5, 0.6)
    return gc, n


def shards(m, k, count, radius, z0, z1):
    """Crystal shards floating around the glove."""
    for i in range(count):
        a = TAU * i / count + 0.4
        z = z0 + (z1 - z0) * ((i * 0.618) % 1)
        d = Vector((math.cos(a), math.sin(a) * 0.7, 0)).normalized()
        c = d * radius + Z * z
        spike(m, c, (Z + d * 0.35).normalized(), 0.26 + 0.04 * (i % 3), 0.07, GEMI, seg=6, back=1.6)


# ---------- the three kinds ----------

def power(k):
    """Gauntlet of power: plates over the back and the fingers, knuckle studs → spikes, a flared cuff."""
    m = Mesh()
    palm(m)
    dg = digits(m)

    def R(z):
        return 0.4 + 0.26 * max(0.0, (0.05 - z) / 1.1) ** 1.6
    z0 = -1.1
    cuff(m, R, z0, 0.05, MET if k else LTH)
    cuff_ring(m, R, z0 + 0.02, 0.01, 0.045, MET)
    cuff_ring(m, R, -0.12, 0.0, 0.04, MET)
    for i in range(16 if k else 10):
        a = TAU * i / (16 if k else 10)
        sphere(m, cuff_pt(R, -0.24, a, 0.005), 0.03, MET, 8)
    # knuckle bar / guard over the knuckle row
    if k == 0:
        path = [hand_pt(0.86, BACK + (i / 20 - 0.5) * 2.2, 0.03) for i in range(21)]
        sweep(m, path, 0.05, MET, prof=8, flat=0.6)
    else:
        plate(m, lambda u, v: (hand_pt(0.78 + 0.18 * v, BACK + (u - 0.5) * 2.3, 0.02),
                               hand_n(0.78 + 0.18 * v, BACK + (u - 0.5) * 2.3)), 22, 5, 0.06, MET)
        # back plate: wider at the knuckles, a point toward the wrist
        plate(m, lambda u, v: (hand_pt(0.12 + 0.62 * v, BACK + (u - 0.5) * 2 * (0.25 + 0.65 * v ** 0.5), 0.02),
                               hand_n(0.12 + 0.62 * v, BACK + (u - 0.5) * 2 * (0.25 + 0.65 * v ** 0.5))), 14, 10, 0.045, MET)
    # studs / spikes on the knuckles
    for x, ln, r, sp in FINGERS:
        w, t = sect(0.88)
        base = Vector((x * 1.02, -t - (0.07 if k else 0.04), 0.88))
        d = (-Y + Z * 0.35).normalized()
        if k <= 1:
            sphere(m, base, 0.06 + 0.01 * k, MET, 12)
        else:
            spike(m, base, d, 0.18 + 0.07 * (k - 2), 0.07, MET, seg=8, back=0.6)
            if k == 5:
                spike(m, base + d * 0.12, d, 0.42, 0.045, GEMI, seg=6, back=0.3)
    # finger lames, the thumb included; claws on the tips from epic on
    if k:
        for path, joints, r, d in dg:
            for s in range(3):
                seg = path[s * 6 + 1: s * 6 + 6]
                sweep(m, seg, r * 1.3, MET, prof=12, flat=0.8)
            if k >= 3:
                horn(m, joints[-1] + d * r * 0.4, d, Y, 0.2 + 0.04 * (k - 3), r * 0.55, MET)
    if k >= 2:
        rope(m, [cuff_pt(R, z0 + 0.08, TAU * i / 120, 0.035) for i in range(120)], 0.025, 60, MET)
        rope(m, [cuff_pt(R, -0.04, TAU * i / 120, 0.03) for i in range(120)], 0.022, 60, MET)
        gc, n = back_gem(m, 0.48, [0, 0, 0.17, 0.19, 0.21, 0.23][k], k, 0.06)
        if k >= 4:
            halo(m, gc, n, 0.33, 12, 0.045, DIA, MET, lift=-0.08)
    if k >= 3:
        # spikes down the outside of the cuff, a stone on the cuff's back
        for i in range(7 if k == 3 else 11):
            a = BACK + (i / (6 if k == 3 else 10) - 0.5) * (2.4 if k == 3 else 3.6)
            z = -0.75
            spike(m, cuff_pt(R, z, a), (cuff_n(R, z, a) - Z * 0.5).normalized(), 0.22 + 0.05 * (k - 3), 0.06, MET, seg=6)
        c = cuff_pt(R, -0.45, BACK, 0.02)
        n2 = cuff_n(R, -0.45, BACK)
        rs = 0.12
        setting(m, c + n2 * rs * 0.7, n2, rs, MET, 0.7)
        brilliant(m, c + n2 * rs * 0.7, n2, rs, GEMI if k == 3 else DIA, 10)
    if k >= 4:
        # glowing rune band and swept horns on the sides of the cuff
        cuff_ring(m, R, -0.6, 0.015, 0.022, GEMI, 64)
        cuff_ring(m, R, -0.3, 0.015, 0.016, GEMI, 64)
        for s in (-1, 1):
            base = cuff_pt(R, -0.35, 0 if s > 0 else math.pi, -0.02)
            horn(m, base, Vector((s, 0.15, 0.35)), Vector((0, 0, 1)), 0.75 if k == 4 else 0.95, 0.1, MET, 10)
    if k == 5:
        shards(m, k, 9, 1.05, -0.6, 1.4)
    return m


def crit(k):
    """Archer's glove of precision: a long laced bracer, metal fingertips → talons, an eye stone, blade fins."""
    m = Mesh()
    palm(m)
    dg = digits(m)

    def R(z):
        return 0.4 + 0.06 * max(0.0, -z / 1.25)
    z0 = -1.25
    cuff(m, R, z0, 0.05, LTH)
    # edges of the bracer
    for z in (z0 + 0.03, -0.02):
        cuff_ring(m, R, z, 0.008, 0.035, MET if k else DRK)
    # laces across the back: eyelets and a criss-cross cord
    pts, nrm = [], []
    n_x = 6
    for i in range(n_x * 2 + 1):
        z = z0 + 0.15 + (i / (n_x * 2)) * 0.95
        a = BACK + (0.42 if i % 2 else -0.42)
        pts.append(cuff_pt(R, z, a, 0.02))
        nrm.append(cuff_n(R, z, a))
    for s in (0, 1):
        q = [pts[i] if (i + s) % 2 == 0 else pts[i] for i in range(len(pts))]
        mirror = [Vector((-p.x, p.y, p.z)) for p in q] if s else q
        sweep(m, spline(mirror, 4), 0.018, DRK, prof=6)
    for i, p in enumerate(pts):
        for sgn in (1, -1):
            e = Vector((p.x * sgn, p.y, p.z))
            n = nrm[i].copy()
            n.x *= sgn
            if k:
                torus(m, e, n, 0.03, 0.012, MET, 12, 6)
            else:
                sphere(m, e, 0.025, DRK, 8)
    # a strap with a buckle round the wrist
    ribbon(m, [cuff_pt(R, -0.18, TAU * i / 60, 0.012) for i in range(61)], [cuff_n(R, -0.18, TAU * i / 60) for i in range(61)],
           0.06, 0.02, DRK)
    bp = cuff_pt(R, -0.18, 0.0, 0.03)
    lathe(m, bp, X, [(0, -0.015), (0.08, -0.015), (0.08, 0.015), (0, 0.015)], MET, 4, smooth=False, off=0.5)
    # fingertips: thimbles on index and middle, then talons on every finger
    for i, (path, joints, r, d) in enumerate(dg):
        if k >= 1 and (i < 2 or k >= 3):
            sweep(m, path[-5:], r * 1.18, MET, prof=12)
            sphere(m, joints[-1], r * 1.02, MET, 12)
        if k >= 2:
            horn(m, joints[-1] + d * r * 0.5, d, Y, 0.18 + 0.06 * (k - 2) + (0.06 if i < 2 else 0), r * 0.6, MET)
    # the eye: a disc with a crosshair (uncommon), then a stone between metal lids
    n = hand_n(0.5, BACK)
    c = hand_pt(0.5, BACK, 0.02)
    if k == 1:
        lathe(m, c, n, [(0, 0), (0.17, 0), (0.17, 0.035), (0, 0.035)], MET, 32)
        for a in range(4):
            d2 = Vector((math.cos(a * math.pi / 2), 0, math.sin(a * math.pi / 2)))
            spike(m, c + n * 0.04 + d2 * 0.12, d2, 0.16, 0.025, MET, flat_n=n, flat=0.4)
    if k >= 2:
        rg = [0, 0, 0.15, 0.17, 0.19, 0.21][k]
        gc, gn = back_gem(m, 0.5, rg, k, 0.02, claws=4)
        for s in (-1, 1):
            # lids: two blades curving over and under the stone
            leaf(m, gc + Vector((-rg * 2.4, 0, s * rg * 0.9)), X, rg * 4.8, rg * 0.5, gn, MET, bend=0.0, thin=0.35)
        if k >= 4:
            halo(m, gc, gn, rg * 1.75, 12, rg * 0.22, DIA, MET, lift=-rg * 0.2)
    if k >= 3:
        # blade fins down the outer (pinky) side of the bracer, both sides from legendary
        for s in ((1,) if k == 3 else (1, -1)):
            for i in range(3 if k == 3 else 4):
                z = -0.25 - 0.27 * i
                a = 0.0 if s > 0 else math.pi
                base = cuff_pt(R, z, a, -0.02)
                d = Vector((s * 0.75, 0.05, -0.65)).normalized()
                leaf(m, base, d, 0.5 + 0.05 * (k - 3) - 0.04 * i, 0.12, Y, MET, bend=-s * 0.25, thin=0.22)
    if k >= 4:
        # feathers hanging from the bracer's end
        for i in range(5 if k == 4 else 7):
            a = BACK + (i / (4 if k == 4 else 6) - 0.5) * 2.2
            base = cuff_pt(R, z0 + 0.06, a, 0.03)
            d = (cuff_n(R, z0, a) * 0.35 - Z).normalized()
            leaf(m, base, d, 0.55, 0.11, cuff_n(R, z0, a), GEMI if i % 2 else MET, bend=0.15, thin=0.2)
    if k == 5:
        shards(m, k, 8, 1.0, -0.9, 1.5)
    return m


def haste(k):
    """Glove of haste: cloth wrapped in straps, open cuff, wings at the wrist growing with the quality."""
    m = Mesh()
    palm(m)
    dg = digits(m)

    def R(z):
        return 0.39 + 0.07 * max(0.0, -z / 0.75)
    z0 = -0.75
    cuff(m, R, z0, 0.05, LTH)
    # a strap spiralling up the cuff, two crossing over the back of the hand
    pts, nrm = [], []
    for i in range(90):
        t = i / 89
        a = TAU * (1.6 * t) + BACK - 0.6
        z = z0 + 0.1 + (-0.08 - z0 - 0.1) * t
        pts.append(cuff_pt(R, z, a, 0.012))
        nrm.append(cuff_n(R, z, a))
    ribbon(m, pts, nrm, 0.05, 0.014, DRK)
    for sgn in (-1, 1):
        pts, nrm = [], []
        for i in range(31):
            t = i / 30
            a = BACK + sgn * (t - 0.5) * 2.2
            z = 0.05 + 0.7 * t
            pts.append(hand_pt(z, a, 0.012))
            nrm.append(hand_n(z, a))
        ribbon(m, pts, nrm, 0.05, 0.014, DRK)
    # wraps on the fingers
    for path, joints, r, d in dg:
        for s in range(2):
            q = path[s * 6 + 2]
            tang = (path[s * 6 + 3] - path[s * 6 + 1]).normalized()
            torus(m, q, tang, r * 1.08, 0.022, DRK, 20, 6)
    if k:
        cuff_ring(m, R, -0.12, 0.01, 0.04, MET)
        cuff_ring(m, R, z0 + 0.04, 0.01, 0.035, MET)
    # wings: feathers fanning out of both sides of the wrist
    nf = [3, 4, 5, 6, 7, 9][k]
    for s in (-1, 1):
        for row in range(2 if k >= 2 else 1):
            for i in range(nf - row):
                f = i / max(1, nf - 1)
                ang = math.radians(15 + 80 * f - row * 6)
                d = Vector((s * math.cos(ang), 0.15 + 0.1 * row, math.sin(ang))).normalized()
                ln = (0.6 + 0.12 * k) * (0.55 + 0.55 * math.sin(math.pi * (0.25 + 0.6 * f))) * (0.62 if row else 1)
                base = cuff_pt(R, -0.42 + 0.05 * i, 0 if s > 0 else math.pi, -0.05) - Y * 0.06 * row
                mat = (MET if k >= 3 else DRK) if row == 0 else (DRK if k < 3 else GEMI if k == 5 else MET)
                leaf(m, base, d, ln, 0.13 + 0.012 * k, Y, mat, bend=-s * 0.22, thin=0.2)
                if k >= 2 and row == 0 and i % 2 == 0:
                    # a quill of the stone's colour down the feather
                    sweep(m, [base + d * ln * t for t in (0.05, 0.5, 0.9)], 0.013, GEMI, prof=5)
    if k >= 2:
        c = cuff_pt(R, -0.35, BACK, 0.02)
        n = cuff_n(R, -0.35, BACK)
        rg = [0, 0, 0.13, 0.15, 0.17, 0.19][k]
        gc = c + n * rg * 0.95
        setting(m, gc, n, rg, MET)
        brilliant(m, gc, n, rg, GEMI, 12)
        prongs(m, gc, n, rg, 6, 0.035, MET, 0.5, 0.6)
        if k >= 4:
            halo(m, gc, n, rg * 1.7, 12, rg * 0.22, DIA, MET, lift=-rg * 0.2)
    if k >= 3:
        # a cabochon on the back of the hand in a small bezel
        n = hand_n(0.5, BACK)
        c = hand_pt(0.5, BACK, 0.02)
        lathe(m, c, n, [(0, 0), (0.15, 0), (0.15, 0.05), (0, 0.05)], MET, 32)
        cabochon(m, c + n * 0.04, n, 0.12, GEMI)
    if k >= 4:
        # lightning zigzags up the back of the cuff and the hand
        for s in (-1, 1):
            pts = []
            for i in range(9):
                z = z0 + 0.1 + 0.95 * i / 8
                a = BACK + s * (0.55 + (0.12 if i % 2 else -0.12))
                pts.append(cuff_pt(R, z, a, 0.03) if z < 0 else hand_pt(z, a, 0.03))
            sweep(m, pts, 0.018, GEMI, prof=5, smooth=False)
    if k == 5:
        # a floating ring round the wrist and shards
        s0 = m.mark()
        torus(m, (0, 0, -0.3), Z, 0.85, 0.03, MET, 96, 8)
        rope(m, [Vector((math.cos(TAU * i / 160) * 0.85, math.sin(TAU * i / 160) * 0.85, -0.3)) for i in range(160)], 0.018, 80, GEMI)
        squash(m, s0)
        shards(m, k, 7, 1.15, -0.6, 1.3)
    return m


KINDS = {"power": power, "crit": crit, "haste": haste}


def materials(kind, k):
    (mc, mr), (gc, ge) = METAL[k], GEM[k]
    r = RARITIES[k]
    base, trim, rough = SKIN[kind]
    return [material(f"jewel_metal_{r}", mc, 1.0, mr), material(f"jewel_gem_{r}", gc, 0.0, 0.04, ge),
            material(f"jewel_diamond_{r}", DIAMOND[0], 0.0, 0.03, DIAMOND[1]), material(f"glove_{kind}_base", base, 0.0, rough),
            material(f"glove_{kind}_trim", trim, 0.0, rough)]


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for kind, fn in KINDS.items():
        for k, r in enumerate(RARITIES):
            name = f"gloves_{kind}_{r}"
            if ARGS and name not in ARGS:
                continue
            ob = to_object(name, fn(k), materials(kind, k))
            bpy.ops.object.select_all(action="DESELECT")
            ob.select_set(True)
            bpy.ops.export_scene.gltf(filepath=os.path.join(MODELS, name + ".glb"), export_format="GLB", use_selection=True,
                                      export_yup=True, export_apply=True, export_cameras=False, export_lights=False)
            print(f"{name}: {len(me_tris(ob))} tris")
            bpy.data.objects.remove(ob, do_unlink=True)


main()
