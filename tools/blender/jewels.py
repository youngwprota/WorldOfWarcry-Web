"""Showcase jewels: rings and amulets of every quality for the gacha forge (src/forge3d.ts) and their icons.
Not worn on the character. The higher the quality, the richer the piece: metal, cut, setting, chain, ornaments.

blender -b --factory-startup --python-exit-code 1 -P tools/blender/jewels.py -- [only_name ...]
Output: public/assets/models/jewel_{ring,amulet}_<rarity>.glb (Blender Z up, front = -Y, size ~2-4 units).
Icons: tools/blender/icon_render.py <glb> <png> 1.1 0 0 <yaw> <pitch> studio, then icon_shrink.py (see README).
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
MODELS = os.path.join(REPO, "public", "assets", "models")
RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"]
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TAU = 2 * math.pi
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))

# by quality: metal (colour, roughness), the main stone (colour, emission)
METAL = [((0.66, 0.40, 0.20), 0.36),  # bronze
         ((0.93, 0.94, 0.96), 0.22),  # silver
         ((1.00, 0.76, 0.33), 0.2),  # gold
         ((1.00, 0.73, 0.30), 0.16),
         ((1.00, 0.69, 0.22), 0.12),  # red gold
         ((0.94, 0.95, 1.00), 0.1)]  # platinum
GEM = [((0.95, 0.38, 0.03), 0.25),  # amber
       ((0.02, 0.75, 0.18), 0.35),  # emerald
       ((0.03, 0.25, 1.00), 0.45),  # sapphire
       ((0.50, 0.08, 1.00), 0.55),  # amethyst
       ((1.00, 0.45, 0.00), 0.65),  # sun topaz
       ((1.00, 0.01, 0.04), 0.75)]  # ruby  (src/forge3d.ts boosts the glow for the bloom)
DIAMOND = ((0.85, 0.93, 1.00), 0.5)
LEATHER = (0.33, 0.18, 0.08)
MET, GEMI, DIA, LTH = range(4)  # material slots


# ---------- mesh building ----------

class Mesh:
    def __init__(self):
        self.v, self.f = [], []

    def p(self, co):
        self.v.append(Vector(co))
        return len(self.v) - 1

    def face(self, ids, mat, smooth):
        self.f.append((tuple(ids), mat, smooth))

    def grid(self, rows, mat, smooth=True, cu=True, cv=False):
        ids = [[self.p(q) for q in r] for r in rows]
        nr, nc = len(ids), len(ids[0])
        for i in range(nr if cv else nr - 1):
            a, b = ids[i], ids[(i + 1) % nr]
            for j in range(nc if cu else nc - 1):
                k = (j + 1) % nc
                self.face((a[j], a[k], b[k], b[j]), mat, smooth)
        return ids

    def fan(self, ring, centre, mat, smooth=False):
        c = self.p(centre)
        for i in range(len(ring)):
            self.face((ring[i], ring[(i + 1) % len(ring)], c), mat, smooth)

    def anti(self, a, b, mat):
        """Triangles between two rings of the same count, b[i] lying between a[i] and a[i+1]."""
        k = len(a)
        for i in range(k):
            j = (i + 1) % k
            self.face((a[i], a[j], b[i]), mat, False)
            self.face((b[i], a[j], b[j]), mat, False)

    def mark(self):
        return len(self.v)

    def transform(self, since, fn):
        for i in range(since, len(self.v)):
            self.v[i] = fn(self.v[i])


def basis(n):
    n = Vector(n).normalized()
    u = (Z if abs(n.z) < 0.9 else X).cross(n).normalized()
    return n, u, n.cross(u)


def spline(ctrl, n=8, closed=False):
    """Catmull-Rom through the control points, `n` samples per span."""
    ctrl = [Vector(c) for c in ctrl]
    m, out = len(ctrl), []
    for s in range(m if closed else m - 1):
        p0 = ctrl[(s - 1) % m] if closed or s > 0 else ctrl[0]
        p1, p2 = ctrl[s], ctrl[(s + 1) % m]
        p3 = ctrl[(s + 2) % m] if closed or s + 2 < m else ctrl[-1]
        for i in range(n):
            t = i / n
            out.append(0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t ** 3))
    if not closed:
        out.append(ctrl[-1])
    return out


def frames(path, closed, up=None):
    n = len(path)
    T = []
    for i in range(n):
        a = path[i - 1] if (closed or i > 0) else path[i]
        b = path[(i + 1) % n] if (closed or i < n - 1) else path[i]
        T.append((b - a).normalized())
    N = []
    if up is not None:
        up = Vector(up)
        N = [(up - t * up.dot(t)).normalized() for t in T]
    else:
        ref = Z if abs(T[0].z) < 0.9 else X
        nn = (ref - T[0] * ref.dot(T[0])).normalized()
        for t in T:
            nn = (nn - t * nn.dot(t)).normalized()
            N.append(nn)
    return T, N


def sweep(m, path, rad, mat, closed=False, prof=8, smooth=True, cap=True, up=None, flat=1.0):
    """Tube along `path`; `rad` a number or f(t 0..1); `flat` squashes it along the frame normal (ribbons)."""
    path = [Vector(q) for q in path]
    T, N = frames(path, closed, up)
    n = len(path)
    rows = []
    for i, q in enumerate(path):
        r = rad(i / (n if closed else n - 1)) if callable(rad) else rad
        b = T[i].cross(N[i])
        rows.append([q + (N[i] * math.cos(TAU * j / prof) * flat + b * math.sin(TAU * j / prof)) * r for j in range(prof)])
    ids = m.grid(rows, mat, smooth, cu=True, cv=closed)
    if not closed and cap:
        m.fan(ids[0], path[0], mat, smooth)
        m.fan(ids[-1], path[-1], mat, smooth)


def lathe(m, c, n, prof, mat, seg=32, smooth=True, off=0.0):
    """Surface of revolution about axis `n` through `c`; prof = [(r, h)], ends closed by fans."""
    n, u, v = basis(n)
    c = Vector(c)
    pole0, pole1 = prof[0][0] == 0, prof[-1][0] == 0
    body = prof[1 if pole0 else 0: len(prof) - (1 if pole1 else 0)]
    rows = [[c + n * h + (u * math.cos(TAU * (i + off) / seg) + v * math.sin(TAU * (i + off) / seg)) * r for i in range(seg)]
            for r, h in body]
    ids = m.grid(rows, mat, smooth, cu=True)
    m.fan(ids[0], c + n * prof[0][1], mat, smooth and pole0)
    m.fan(ids[-1], c + n * prof[-1][1], mat, smooth and pole1)


def sphere(m, c, r, mat, seg=16, smooth=True):
    lathe(m, c, Z, [(r * math.sin(math.pi * i / (seg // 2)), r * math.cos(math.pi * i / (seg // 2))) for i in range(seg // 2 + 1)],
          mat, seg, smooth)


def torus(m, c, n, R, r, mat, seg=32, prof=10):
    n, u, v = basis(n)
    c = Vector(c)
    sweep(m, [c + (u * math.cos(TAU * i / seg) + v * math.sin(TAU * i / seg)) * R for i in range(seg)], r, mat, closed=True,
          prof=prof, up=n)


def brilliant(m, c, n, rg, mat, k=12, pear=None):
    """Round brilliant cut, table toward `n`; `pear` = (direction, stretch) pulls one side into a drop."""
    n, u, v = basis(n)
    c = Vector(c)
    s0 = m.mark()

    def ring(r, h, off):
        return [m.p(c + n * h * rg + (u * math.cos(TAU * (i + off) / k) + v * math.sin(TAU * (i + off) / k)) * r * rg) for i in range(k)]

    t, s, g, g2, pv = ring(0.56, 0.40, 0), ring(0.84, 0.28, 0.5), ring(1.0, 0.08, 0), ring(1.0, -0.03, 0), ring(0.58, -0.38, 0.5)
    m.fan(t, c + n * 0.40 * rg, mat)
    m.anti(t, s, mat)
    m.anti(s, g[1:] + g[:1], mat)
    for i in range(k):
        j = (i + 1) % k
        m.face((g[i], g[j], g2[j], g2[i]), mat, False)
    m.anti(g2, pv, mat)
    m.fan(pv, c - n * 0.80 * rg, mat)
    if pear:
        e, f = Vector(pear[0]).normalized(), pear[1]
        m.transform(s0, lambda q: q + e * max(0.0, (q - c).dot(e)) * (f - 1))


def cabochon(m, c, n, rg, mat, h=0.62):
    lathe(m, c, n, [(0, h * rg)] + [(rg * math.sin(a), h * rg * math.cos(a)) for a in (math.pi / 2 * i / 8 for i in range(1, 9))]
          + [(0, -0.04 * rg)], mat, 24)


def spike(m, base, d, length, w, mat, flat_n=None, flat=1.0, seg=4, back=0.35):
    """Faceted spike from `base` along `d`; with `flat_n` it is squashed along that axis (a ray lying on a face)."""
    d = Vector(d).normalized()
    if flat_n is not None:
        u = Vector(flat_n).normalized()
        u = (u - d * u.dot(d)).normalized()
        v = d.cross(u)
    else:
        _, u, v = basis(d)
    base = Vector(base)
    ring = [m.p(base + (u * math.cos(TAU * i / seg) * flat + v * math.sin(TAU * i / seg)) * w) for i in range(seg)]
    m.fan(ring, base + d * length, mat)
    m.fan(ring, base - d * w * back, mat)


def leaf(m, base, d, length, w, normal, mat, bend=0.0, thin=0.28):
    """Pointed leaf / feather from `base` along `d`, curving toward `bend` side, thin along `normal`."""
    d = Vector(d).normalized()
    side = Vector(normal).cross(d).normalized()
    ctrl = [Vector(base) + d * length * t + side * bend * length * t * t for t in (0, 0.35, 0.7, 1.0)]
    sweep(m, spline(ctrl, 6), lambda t: w * max(0.02, math.sin(math.pi * min(1, t * 1.05)) ** 0.7), mat, prof=8, up=normal,
          flat=thin)


def rope(m, path, rw, turns, mat, closed=True, up=None, strands=2):
    """Twisted wire of `strands` around the centre line `path`."""
    path = [Vector(q) for q in path]
    T, N = frames(path, closed, up)
    n = len(path)
    for s in range(strands):
        pts = []
        for i, q in enumerate(path):
            a = TAU * turns * i / n + TAU * s / strands
            pts.append(q + (N[i] * math.cos(a) + T[i].cross(N[i]) * math.sin(a)) * rw)
        sweep(m, pts, rw * 0.95, mat, closed=closed, prof=6, up=None)


def circle(c, n, R, seg=96):
    n, u, v = basis(n)
    return [Vector(c) + (u * math.cos(TAU * i / seg) + v * math.sin(TAU * i / seg)) * R for i in range(seg)]


def prongs(m, gc, n, rg, count, r0, mat, off=0.0, low=0.9):
    """Claws holding a brilliant at `gc` (table toward `n`): from under the pavilion over the girdle."""
    n, u, v = basis(n)
    gc = Vector(gc)
    for i in range(count):
        a = TAU * (i + off) / count
        d = u * math.cos(a) + v * math.sin(a)
        ctrl = [gc - n * rg * low + d * rg * 0.45, gc - n * rg * 0.2 + d * rg * 1.02, gc + n * rg * 0.1 + d * rg * 1.08,
                gc + n * rg * 0.22 + d * rg * 0.9]
        sweep(m, spline(ctrl, 5), lambda t: r0 * (1.15 - 0.35 * t), mat, prof=8)
        sphere(m, ctrl[-1], r0 * 0.85, mat, 10)


def setting(m, gc, n, rg, mat, low=0.95):
    """Cup under a brilliant: a cone from below the pavilion to just under the girdle."""
    n = Vector(n).normalized()
    lathe(m, Vector(gc) - n * rg * low, n, [(0, 0), (rg * 0.42, 0), (rg * 0.95, rg * (low - 0.12)), (rg * 1.06, rg * (low - 0.06)),
                                           (rg * 0.96, rg * (low - 0.02)), (rg * 0.7, rg * (low - 0.3)), (0, rg * (low - 0.3))],
          mat, 32)


def halo(m, gc, n, R, count, rs, mat_gem, mat_metal, lift=0.0):
    """A ring of small stones around a centre stone, on a thin metal ring."""
    n, u, v = basis(n)
    gc = Vector(gc) + n * lift
    torus(m, gc - n * rs * 0.6, n, R, rs * 0.35, mat_metal, 48, 8)
    for i in range(count):
        a = TAU * (i + 0.5) / count
        d = u * math.cos(a) + v * math.sin(a)
        brilliant(m, gc + d * R, n, rs, mat_gem, 8)
        torus(m, gc + d * R - n * rs * 0.05, n, rs * 1.02, rs * 0.16, mat_metal, 12, 6)


# ---------- rings: band around Y (the hole faces the camera), the stone on top (+Z) ----------

def band(m, R, th, wd, mat, seg=128, prof=28, tilt=None):
    rows = []
    for i in range(seg):
        a = TAU * i / seg
        r, y = Vector((math.cos(a), 0, math.sin(a))), Y
        if tilt is not None:
            r, y = tilt @ r, tilt @ y
        t, w = th(a), wd(a)
        row = []
        for j in range(prof):
            b = TAU * j / prof
            cu, cv = math.cos(b), math.sin(b)
            # comfort-fit section: rounded rectangle (superellipse)
            uu = math.copysign(abs(cu) ** 0.55, cu)
            vv = math.copysign(abs(cv) ** 0.55, cv)
            row.append(r * (R + t * (0.5 + 0.5 * uu)) + y * (w * vv))
        rows.append(row)
    m.grid(rows, mat, True, cu=True, cv=True)


def ring_jewel(k):
    m = Mesh()
    R = 1.0
    t0, w0 = 0.12 + 0.008 * k, 0.13 + 0.012 * k
    sh = [0.2, 0.5, 0.9, 1.3, 1.6, 1.9][k]  # the shoulders widen toward the stone

    def top(a):
        return max(0.0, math.sin(a)) ** 4

    def th(a):
        return t0 * (1 + 0.6 * sh * top(a))

    def wd(a):
        return w0 * (1 + sh * top(a))

    band(m, R, th, wd, MET)
    gt = R + th(math.pi / 2)  # band top
    rg = [0.36, 0.4, 0.45, 0.5, 0.55, 0.6][k]
    if k == 0:
        # plain bronze ring: an amber cabochon in a low bezel
        lathe(m, (0, 0, gt - 0.08), Z, [(0, 0), (rg * 1.18, 0), (rg * 1.2, 0.17), (rg * 1.05, 0.2), (0, 0.2)], MET, 32)
        cabochon(m, (0, 0, gt + 0.11), Z, rg, GEMI)
        return m
    gc = Vector((0, 0, gt + rg * 0.95))
    setting(m, gc, Z, rg, MET)
    brilliant(m, gc, Z, rg, GEMI, 12 if k < 4 else 16)
    if k == 1:
        # bezel rim over the girdle, two beads on each shoulder
        torus(m, gc + Z * rg * 0.05, Z, rg * 1.04, rg * 0.09, MET, 40, 8)
        for s in (-1, 1):
            for a in (0.5, 0.75):
                ang = math.pi / 2 + s * a
                sphere(m, Vector((math.cos(ang), 0, math.sin(ang))) * (R + th(ang) + 0.02), 0.06, MET, 12)
    else:
        prongs(m, gc, Z, rg, [0, 0, 4, 6, 6, 8][k], 0.05 + 0.006 * k, MET, off=0.5 if k == 2 else 0)
        # twisted wire along both edges of the band
        for s in (-1, 1):
            path = []
            for i in range(160):
                a = TAU * i / 160
                path.append(Vector((math.cos(a), 0, math.sin(a))) * (R + th(a) * 0.55) + Y * s * (wd(a) + 0.03))
            rope(m, path, 0.028, 70, MET, up=Y)
    if k >= 3:
        # side stones down the shoulders
        for s in (-1, 1):
            for a, kk in ((0.42, 1.0), (0.7, 0.75)) if k >= 4 else ((0.45, 1.0),):
                ang = math.pi / 2 + s * a
                rd = Vector((math.cos(ang), 0, math.sin(ang)))
                rs = rg * 0.36 * kk
                c = rd * (R + th(ang) + rs * 0.5)
                setting(m, c, rd, rs, MET, 0.7)
                brilliant(m, c, rd, rs, GEMI if k == 3 else DIA, 10)
                prongs(m, c, rd, rs, 4, 0.025, MET, 0.5, 0.6)
    if k >= 4:
        halo(m, gc, Z, rg * 1.38, 14 if k == 4 else 16, rg * 0.17, DIA, MET, lift=-rg * 0.12)
        # crown of spikes around the halo
        for i in range(8 if k == 4 else 12):
            a = TAU * i / (8 if k == 4 else 12)
            d = Vector((math.cos(a), math.sin(a), 0))
            spike(m, gc + d * rg * 1.62 - Z * rg * 0.25, (d * 0.55 + Z).normalized(), rg * (0.75 if k == 4 else 1.0), rg * 0.1, MET, seg=6)
    if k == 5:
        # two crossing wires wrapping the band, crystal shards floating around the stone
        for s in (-1, 1):
            tilt = Matrix.Rotation(s * 0.32, 3, Z)
            path = [tilt @ Vector((math.cos(TAU * i / 160), 0, math.sin(TAU * i / 160))) * (R + t0 * 0.6) for i in range(160)]
            sweep(m, path, 0.035, MET, closed=True, prof=8)
        for i in range(5):
            a = TAU * i / 5 + 0.3
            d = Vector((math.cos(a), math.sin(a) * 0.6, 0)).normalized()
            c = gc + d * rg * 2.3 + Z * rg * (0.6 + 0.35 * math.sin(a * 3))
            spike(m, c, (Z + d * 0.3).normalized(), rg * 0.55, rg * 0.13, GEMI, seg=6, back=1.6)
    return m


# ---------- amulets: the pendant faces -Y (the camera), the chain loops up behind it ----------

def chain(m, k, top, W, H):
    """Necklace loop from the bail at `top`: a V at the pendant, a round arch above, tilted back a little."""
    tilt = 0.35
    path = []
    N = 400
    for i in range(N):
        t = TAU * i / N
        s = (1 - math.cos(t)) / 2
        x = W * math.sin(t) * (0.3 + 0.7 * s ** 0.5)
        h = H * s
        path.append(Vector(top) + Vector((x, h * math.sin(tilt), h * math.cos(tilt))))
    plane = Vector((0, math.cos(tilt), -math.sin(tilt)))  # normal of the loop plane
    if k == 0:
        sweep(m, path[::2], 0.045, LTH, closed=True, prof=10, up=plane)
        # knots and wooden-bronze beads up the cord
        for i in (22, -22, 40, -40):
            q = path[i % N]
            tang = (path[(i + 1) % N] - path[(i - 1) % N]).normalized()
            lathe(m, q, tang, [(0, -0.09), (0.07, -0.07), (0.1, 0), (0.07, 0.07), (0, 0.09)], MET, 16)
        return
    # oval links along the path, every other one turned a quarter
    rw = [0, 0.022, 0.026, 0.03, 0.034, 0.036][k]
    b, a = rw * 2.3, rw * 2.0
    L = [0.0]
    for i in range(1, N + 1):
        L.append(L[-1] + (path[i % N] - path[i - 1]).length)
    pitch = 2 * (a + b) - 2.4 * rw
    cnt = int(L[-1] / pitch) // 2 * 2
    pitch = L[-1] / cnt
    beads = set()
    if k >= 3:
        for f in (0.12, 0.24, 0.36):
            for g in (f, 1 - f):
                beads.add(round(g * cnt))
    j = 0
    for li in range(cnt):
        d = li * pitch
        while L[j + 1] < d:
            j += 1
        f = (d - L[j]) / max(1e-9, L[j + 1] - L[j])
        q = path[j].lerp(path[(j + 1) % N], f)
        tang = (path[(j + 1) % N] - path[j]).normalized()
        if li in beads:
            brilliant(m, q, tang, b * 1.5, GEMI if k < 5 else DIA, 8)
            brilliant(m, q, -tang, b * 1.5, GEMI if k < 5 else DIA, 8)
            continue
        side = tang.cross(plane).normalized()
        nrm = plane if li % 2 == 0 else side
        inp = tang.cross(nrm).normalized()
        loop = []
        for i in range(10):
            th = -math.pi / 2 + math.pi * i / 9
            loop.append(q + tang * (a + b * math.cos(th)) + inp * (b * math.sin(th)))
        for i in range(10):
            th = math.pi / 2 + math.pi * i / 9
            loop.append(q + tang * (-a + b * math.cos(th)) + inp * (b * math.sin(th)))
        sweep(m, loop, rw, MET, closed=True, prof=6, up=nrm)


def amulet_jewel(k):
    m = Mesh()
    F = -Y  # front
    D = 1.0
    rg = [0.44, 0.46, 0.5, 0.54, 0.58, 0.62][k]
    # medallion: a disc with a raised rim and a recessed face
    lathe(m, (0, 0, 0), F, [(0, -0.1), (D * 0.94, -0.1), (D, -0.04), (D, 0.07), (D * 0.95, 0.15), (D * 0.86, 0.15), (D * 0.82, 0.07),
                           (0, 0.07)], MET, 64)
    gh = 0.07 + rg * 0.55
    gc = F * gh
    if k == 0:
        cabochon(m, F * 0.06, F, rg, GEMI, 0.7)
        torus(m, F * 0.07, F, rg * 1.04, 0.05, MET, 40, 8)
        # punched dots around the face
        for i in range(12):
            a = TAU * i / 12
            sphere(m, Vector((math.cos(a), 0, math.sin(a))) * D * 0.68 + F * 0.08, 0.05, MET, 10)
    else:
        lathe(m, F * 0.06, F, [(0, 0), (rg * 0.9, 0), (rg * 1.08, gh - rg * 0.06), (rg * 0.96, gh), (0, gh - rg * 0.2)], MET, 40)
        brilliant(m, gc, F, rg, GEMI, 12 if k < 4 else 16)
        if k == 1:
            torus(m, gc + F * rg * 0.05, F, rg * 1.05, rg * 0.08, MET, 40, 8)
        else:
            prongs(m, gc, F, rg, 6 if k < 5 else 8, 0.05, MET, 0.5, 0.5)
    if k >= 1:
        # rays engraved on the face between the stone and the rim
        for i in range(12 if k >= 2 else 8):
            a = TAU * (i + 0.5) / (12 if k >= 2 else 8)
            d = Vector((math.cos(a), 0, math.sin(a)))
            spike(m, d * rg * 1.2 + F * 0.07, d, D * 0.82 - rg * 1.25, 0.06, MET, flat_n=F, flat=0.35)
    if k >= 2:
        rope(m, circle((0, 0, 0.0), F, D * 1.02, 160), 0.045, 90, MET, up=F)
    if k >= 3:
        # petals around the rim, a stone at each tip
        n = 8 if k == 3 else 12
        for i in range(n):
            a = TAU * i / n + math.pi / 2
            d = Vector((math.cos(a), 0, math.sin(a)))
            if abs(d.z - 1) < 0.05:
                continue  # the bail sits there
            leaf(m, d * D * 0.98 - F * 0.02, d, 0.42 + 0.06 * (k - 3), 0.15, F, MET)
            brilliant(m, d * (D * 1.42 + 0.06 * (k - 3)) + F * 0.03, F, 0.075, DIA if k >= 4 else GEMI, 8)
        # a drop stone hanging below
        bz = -D - 0.16
        torus(m, (0, 0, bz), X, 0.12, 0.04, MET, 20, 8)
        r2 = rg * 0.55
        brilliant(m, (0, 0, bz - 0.12 - r2 * 1.05), F, r2, GEMI, 12, pear=(-Z, 1.9))
        torus(m, (0, 0, bz - 0.12 - r2 * 0.1), Z, r2 * 0.45, 0.03, MET, 20, 6)
    if k >= 4:
        halo(m, gc - F * rg * 0.3, F, rg * 1.36, 16, rg * 0.15, DIA, MET)
        # sun rays behind the medallion
        for i in range(16):
            a = TAU * (i + 0.5) / 16
            d = Vector((math.cos(a), 0, math.sin(a)))
            if d.z > 0.9:
                continue
            spike(m, d * D * 0.9 - F * 0.08, d, D * (0.9 if i % 2 else 0.6) * (1.2 if k == 5 else 1), 0.13, MET, flat_n=F,
                  flat=0.3, seg=4)
        # wings
        for s in (-1, 1):
            for i in range(6):
                f = i / 5
                ang = math.radians(8 + 72 * f)
                d = Vector((s * math.cos(ang), 0, math.sin(ang)))
                ln = (1.1 + 0.6 * math.sin(math.pi * (0.25 + 0.75 * f))) * (1.25 if k == 5 else 1)
                leaf(m, Vector((s * D * 0.75, 0.06 + 0.02 * i, 0.1 + 0.15 * f)), d, ln, 0.17, F, MET, bend=-s * 0.18)
    if k == 5:
        # a floating halo ring behind, with shards on it
        torus(m, -F * 0.25, F, D * 1.95, 0.05, MET, 96, 10)
        for i in range(10):
            a = TAU * i / 10 + math.pi / 10
            d = Vector((math.cos(a), 0, math.sin(a)))
            spike(m, d * D * 1.95 - F * 0.25, d, 0.32, 0.09, GEMI, seg=6, back=1.5)
    # bail on top and the chain through it
    bz = D + 0.2 + (0.06 if k >= 2 else 0)
    torus(m, (0, 0, bz), X, 0.17, 0.055, MET, 24, 8)
    lathe(m, (0, 0, D - 0.06), Z, [(0, 0), (0.13, 0), (0.1, 0.14), (0, 0.16)], MET, 16)
    chain(m, k, Vector((0, 0, bz + 0.17)), 0.95 + 0.04 * k, 1.75 + 0.08 * k)
    return m


# ---------- export ----------

def material(name, col, metal, rough, emit=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*col, 1)
        b.inputs["Emission Strength"].default_value = emit
    return m


def materials(k):
    (mc, mr), (gc, ge) = METAL[k], GEM[k]
    r = RARITIES[k]
    return [material(f"jewel_metal_{r}", mc, 1.0, mr), material(f"jewel_gem_{r}", gc, 0.0, 0.04, ge),
            material(f"jewel_diamond_{r}", DIAMOND[0], 0.0, 0.03, DIAMOND[1]), material("jewel_leather", LEATHER, 0.0, 0.7)]


def to_object(name, m, mats):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in m.v], [], [f[0] for f in m.f])
    for p, (_, mat, sm) in zip(me.polygons, m.f):
        p.material_index = mat
        p.use_smooth = sm
    for mt in mats:
        me.materials.append(mt)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for k, r in enumerate(RARITIES):
        for kind, fn in (("ring", ring_jewel), ("amulet", amulet_jewel)):
            name = f"jewel_{kind}_{r}"
            if ARGS and name not in ARGS:
                continue
            m = fn(k)
            ob = to_object(name, m, materials(k))
            bpy.ops.object.select_all(action="DESELECT")
            ob.select_set(True)
            bpy.ops.export_scene.gltf(filepath=os.path.join(MODELS, name + ".glb"), export_format="GLB", use_selection=True,
                                      export_yup=True, export_apply=True, export_cameras=False, export_lights=False)
            print(f"{name}: {len(me_tris(ob))} tris")
            bpy.data.objects.remove(ob, do_unlink=True)


def me_tris(ob):
    return [t for p in ob.data.polygons for t in range(len(p.vertices) - 2)]


main()
