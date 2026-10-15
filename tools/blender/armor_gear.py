"""Armour by quality (docs/features/warrior): procedural overlays on top of the Bitgem armour sets, in wow.blend.

The game shows armour by borrowing body parts of other characters (src/items.ts SETS: guard / knight / lord =
soldier / human_knight / paladin and orc_warrior / orc_grunt / orc_chieftain). Quality adds rigid pieces on top,
each hung on one bone: helmet band, gem, fins, horns, crown, halo (head); chest emblem and pauldrons (chest);
bracers (arms); knee guards and a belt buckle (legs); a pendant (amulet) and a ring. Common pieces get nothing,
except the ring and the amulet. Pieces are fitted to the set's own meshes (collections unit_<model> of the blend).

Space: the characters' mesh space (cm, Y up, face toward +Z) — the same space as the game's skinned geometry, so a
piece hangs on its bone with the bone's inverse bind matrix (attachTrim in src/rig.ts). GLB nodes are named
<glb>__<bone>; materials: armor_body (vertex colour) and armor_glow (vertex colour, unlit in the game).

blender -b <wow.blend> --factory-startup --python-exit-code 1 -P tools/blender/armor_gear.py -- [save_as.blend]
Run on the blend that already has the shields (rarity_gear.py) to keep both in one file.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rarity_gear as rg  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SAVE_AS = ARGS[0] if len(ARGS) > 0 and ARGS[0] else None

RARITIES = rg.RARITIES
SETS = {
    "human": [("guard", "soldier"), ("knight", "human_knight"), ("lord", "paladin")],
    "orc": [("guard", "orc_warrior"), ("knight", "orc_grunt"), ("lord", "orc_chieftain")],
}
HERO = {"human": "peasant", "orc": "orc_peon"}
PREFIXES = {
    "head": ("head_", "helmet_", "face_plate_"),
    "chest": ("chest_", "torso_", "cape_"),
    "arms": ("arms_",),
    "legs": ("legs_", "hip_", "hips_"),
}
UP, FWD = Vector((0, 1, 0)), Vector((0, 0, 1))


# ---------- measuring the characters (mesh space) ----------

def unit(model):
    col = bpy.data.collections["unit_" + model]
    rig = next(o for o in col.objects if o.type == "ARMATURE")
    return col, rig


def points(model, part, bones=None, minw=0.4):
    """Vertices of a body part of `model` in mesh space; with `bones`, only those weighted to one of them."""
    col, rig = unit(model)
    inv = rig.matrix_world.inverted()
    out = []
    for o in col.objects:
        if o.type != "MESH" or not o.name.startswith(PREFIXES[part]):
            continue
        m = inv @ o.matrix_world
        names = {g.index: g.name for g in o.vertex_groups}
        for v in o.data.vertices:
            if bones:
                w = max((g.weight for g in v.groups if names.get(g.group) in bones), default=0)
                if w < minw:
                    continue
            out.append(m @ v.co)
    return out


def bone(model, name):
    """Bind-pose bone head/tail. Every character shares one skeleton (same positions), but some name their hands
    Character1_*; the pieces hang on the hero's bones, so the hero's rig is read whatever `model` is."""
    _, rig = unit("peasant")
    b = rig.data.bones[name]
    return b.head_local.copy(), b.tail_local.copy()


def pick(pts, **lim):
    """Points inside the given ranges: x=(lo, hi), y=…, z=…"""
    out = pts
    for k, (lo, hi) in lim.items():
        i = "xyz".index(k)
        out = [p for p in out if lo <= p[i] <= hi]
    return out


def pct(vals, q):
    s = sorted(vals)
    return s[min(len(s) - 1, int(q * (len(s) - 1)))] if s else 0.0


# ---------- geometry in mesh space ----------

class Build:
    """Vertices and faces with a display colour per face; `glow` faces get the unlit material."""

    def __init__(self):
        self.verts, self.faces = [], []

    def v(self, p):
        self.verts.append(Vector(p))
        return len(self.verts) - 1

    def f(self, idx, col, glow=False):
        self.faces.append((tuple(idx), col, glow))

    def ring(self, c, u, v, ru, rv, seg):
        return [self.v(c + u * ru * math.cos(2 * math.pi * i / seg) + v * rv * math.sin(2 * math.pi * i / seg)) for i in range(seg)]

    def strip(self, a, b, col, glow=False):
        n = len(a)
        for i in range(n):
            j = (i + 1) % n
            self.f([a[i], a[j], b[j], b[i]], col, glow)

    def fan(self, c, ring, col, glow=False):
        for i in range(len(ring)):
            self.f([c, ring[i], ring[(i + 1) % len(ring)]], col, glow)

    def band(self, c, axis, u, ru, rv, h, t, col, seg=16):
        """Elliptic ring around `axis` (a bracer, a helmet band): radii ru/rv inside, thickness t, height h."""
        axis, u = Vector(axis).normalized(), Vector(u).normalized()
        v = axis.cross(u).normalized()
        c = Vector(c)
        lo, hi = c - axis * h / 2, c + axis * h / 2
        oi, ih = self.ring(lo, u, v, ru + t, rv + t, seg), self.ring(hi, u, v, ru + t, rv + t, seg)
        ii, il = self.ring(hi, u, v, ru, rv, seg), self.ring(lo, u, v, ru, rv, seg)
        self.strip(oi, ih, col)
        self.strip(ih, ii, col)
        self.strip(ii, il, col)
        self.strip(il, oi, col)

    def dome(self, c, n, u, ru, rv, depth, col, seg=12, rings=4):
        """Half ellipsoid shell (pauldron, knee cap) bulging along `n`, closed by a flat base."""
        n, u = Vector(n).normalized(), Vector(u).normalized()
        u = (u - n * u.dot(n)).normalized()
        v = n.cross(u)
        c = Vector(c)
        prev = self.ring(c, u, v, ru, rv, seg)
        base = prev
        for k in range(1, rings):
            a = (math.pi / 2) * k / rings
            cur = self.ring(c + n * depth * math.sin(a), u, v, ru * math.cos(a), rv * math.cos(a), seg)
            self.strip(prev, cur, col)
            prev = cur
        self.fan(self.v(c + n * depth), prev, col)
        self.fan(self.v(c), list(reversed(base)), col)

    def slab(self, c, n, u, w, h, t, col):
        """Box: `w` along u, `h` along n×u, `t` along n (the front face at c + n*t/2)."""
        n, u = Vector(n).normalized(), Vector(u).normalized()
        u = (u - n * u.dot(n)).normalized()
        up = n.cross(u)
        c = Vector(c)
        q = [self.v(c + u * sx * w / 2 + up * sy * h / 2 + n * sz * t / 2) for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
        for a in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
            self.f([q[i] for i in a], col)

    def gem(self, c, n, r, depth, col, seg=6):
        n = Vector(n).normalized()
        u = n.orthogonal().normalized()
        v = n.cross(u)
        ring = self.ring(Vector(c), u, v, r, r, seg)
        self.fan(self.v(Vector(c) + n * depth), ring, col, True)
        self.fan(self.v(Vector(c) - n * 0.3), list(reversed(ring)), col, True)

    def spike(self, base, d, length, r, col, seg=5):
        d = Vector(d).normalized()
        u = d.orthogonal().normalized()
        v = d.cross(u)
        ring = self.ring(Vector(base), u, v, r, r, seg)
        self.fan(self.v(Vector(base) + d * length), ring, col)
        self.fan(self.v(Vector(base) - d * 0.5), list(reversed(ring)), col)

    def crystal(self, c, axis, h, r, col):
        axis = Vector(axis).normalized()
        u = axis.orthogonal().normalized()
        v = axis.cross(u)
        ring = self.ring(Vector(c), u, v, r, r, 4)
        self.fan(self.v(Vector(c) + axis * h), ring, col, True)
        self.fan(self.v(Vector(c) - axis * h * 0.6), list(reversed(ring)), col, True)


# ---------- palette ----------

def colors(r):
    k = RARITIES.index(r)
    return {
        # mythic accent of the weapons (0.3, 0.03, 0.05) reads black on a small piece
        "plate": {"common": (0.55, 0.38, 0.22), "mythic": (0.72, 0.08, 0.1)}.get(r, rg.ACCENT[r]),
        "steel": rg.IRON if r in ("common", "mythic") else rg.STEEL,
        "trim": rg.GOLD if k >= 3 else rg.STEEL,
        "gem": rg.GEM[r][0] if r in rg.GEM else (0.9, 0.85, 0.7),
        "leather": rg.LEATHER,
    }


# ---------- pieces ----------

def head_piece(model, r):
    k, c = RARITIES.index(r), colors(r)
    pts = points(model, "head")
    y0 = bone(model, "head")[0].y
    ytop = pct([p.y for p in pts], 0.97)
    yb = y0 + 0.62 * (ytop - y0)  # around the crown of the head / helmet, above the eyes
    sl = pick(pts, y=(yb - 3, yb + 3))
    xr = max(abs(p.x) for p in sl)
    zf, zb = max(p.z for p in sl), min(p.z for p in sl)
    cz, rz = (zf + zb) / 2, (zf - zb) / 2
    b = Build()
    h = 4.5 + 0.8 * k
    b.band((0, yb, cz), UP, (1, 0, 0), xr + 0.8, rz + 0.8, h, 1.4, c["plate"] if k < 3 else c["trim"])
    b.slab((0, yb, zf + 1.6), FWD, (1, 0, 0), 6 + k, h + 2, 1.2, c["trim"])
    b.gem((0, yb, zf + 2.2), FWD, 1.8 + 0.35 * k, 1.6, c["gem"])
    if k in (2, 4):  # fins swept back
        for s in (-1, 1):
            b.spike((s * (xr + 1.5), yb + 1, cz), (s * 0.5, 0.8, -0.7), 9 + 2 * k, 1.8, c["trim"])
    if k in (3, 5):  # horns
        for s in (-1, 1):
            base = Vector((s * (xr + 0.5), yb + 2, cz + rz * 0.25))
            b.spike(base, (s * 0.9, 0.55, 0.2), 8 + k, 2.6, c["steel"] if k == 3 else c["plate"])
            b.spike(base + Vector((s * 6.5, 4.5, 1.2)), (s * 0.15, 1, 0.1), 7 + k, 1.6, c["trim"])
    if k >= 4:  # crown on the band
        n = 7
        for i in range(n):
            a = math.pi * (0.15 + 0.7 * i / (n - 1))
            p = Vector((math.cos(a) * (xr + 1.4), yb + h / 2, cz + math.sin(a) * (rz + 1.4)))
            b.spike(p, UP, 4 + (3 if i == n // 2 else 1.5), 1.4, c["trim"])
    if k >= 5:  # halo of shards
        for i in range(6):
            a = 2 * math.pi * i / 6
            b.crystal((math.cos(a) * xr * 0.75, ytop + 9, cz + math.sin(a) * rz * 0.75), (0.25 * math.cos(a), 1, 0.25 * math.sin(a)), 4.5, 1.4, c["gem"])
    return {"head": b}


def chest_piece(model, r):
    k, c = RARITIES.index(r), colors(r)
    chest = points(model, "chest")
    arms = points(model, "arms")
    out = {}
    s3 = bone(model, "spine_03")[0]
    ye = s3.y + 2
    zf = max(p.z for p in pick(chest, y=(ye - 3, ye + 3), x=(-6, 6)))
    b = Build()
    w, h = 9 + 1.6 * k, 10 + 1.6 * k
    b.slab((0, ye, zf + 0.4), FWD, (1, 0, 0), w + 2, h + 2, 1.0, c["trim"])
    b.slab((0, ye, zf + 1.2), FWD, (1, 0, 0), w, h, 1.2, c["plate"])
    b.gem((0, ye, zf + 1.9), FWD, 1.8 + 0.4 * k, 1.8, c["gem"])
    if k >= 2:
        for sx in (-1, 1):
            for sy in (-1, 1):
                b.gem((sx * w * 0.35, ye + sy * h * 0.35, zf + 1.9), FWD, 0.9, 0.8, c["trim"])
    if k >= 5:
        for i, (dx, dy) in enumerate(((-14, 18), (0, 24), (14, 18))):
            b.crystal((dx, s3.y + dy, s3.z - 22), (dx * 0.03, 1, -0.2), 5, 1.5, c["gem"])
    out["spine_03"] = b
    if k >= 2:  # pauldrons, on the collarbone: it stays put when the arm drops from the bind T-pose
        for side, sgn in (("l", 1), ("r", -1)):
            sh = bone(model, "upperarm_" + side)[0]
            near = pick(chest + arms, x=sorted((sh.x - sgn * 4, sh.x + sgn * 8)), z=(sh.z - 10, sh.z + 10))
            top = max(p.y for p in near) if near else sh.y + 8
            pb = Build()
            n = Vector((sgn * 0.45, 1, 0))
            ru, rv = 8 + 0.9 * k, 9 + 0.9 * k
            ctr = Vector((sh.x + sgn * 3, top - 2.5, sh.z))
            pb.dome(ctr, n, FWD, ru, rv, 5 + 0.7 * k, c["plate"])
            pb.band(ctr + n.normalized() * 0.4, n, FWD, ru - 0.2, rv - 0.2, 1.6, 1.0, c["trim"])
            if k >= 3:
                for i in range(2 if k == 3 else 3):
                    t = (i + 1) / (3 if k == 3 else 4)
                    p = ctr + n.normalized() * (4 + 0.6 * k) + Vector((0, 0, (t - 0.5) * rv * 1.2))
                    pb.spike(p, n + Vector((sgn * 0.3, 0, 0)), 5 + 0.8 * k, 1.5, c["trim"])
            if k >= 4:  # second, lower plate
                pb.dome(ctr + Vector((sgn * 4, -4, 0)), Vector((sgn, 0.35, 0)), FWD, ru * 0.75, rv * 0.85, 3, c["plate"])
            if k >= 5:
                for i in range(3):
                    pb.crystal(ctr + Vector((sgn * 2, 12 + 3 * i, (i - 1) * 6)), (sgn * 0.3, 1, 0), 3.5, 1.1, c["gem"])
            out["clavicle_" + side] = pb
    return out


def arms_piece(model, r):
    k, c = RARITIES.index(r), colors(r)
    out = {}
    for side, sgn in (("l", 1), ("r", -1)):
        a0 = bone(model, "lowerarm_" + side)[0]
        a1 = bone(model, "hand_" + side)[0]
        L = abs(a1.x - a0.x)
        xs = sorted((a0.x + sgn * L * 0.3, a0.x + sgn * L * 0.85))
        # some sets skin the forearm armour to the hand or the upper arm: fall back to everything in that range
        pts = pick(points(model, "arms", {"lowerarm_" + side}, 0.5), x=xs) or pick(points(model, "arms"), x=xs)
        cy = sum(p.y for p in pts) / len(pts)
        cz = sum(p.z for p in pts) / len(pts)
        ry = max(abs(p.y - cy) for p in pts)
        rz = max(abs(p.z - cz) for p in pts)
        x = a0.x + sgn * L * 0.62
        b = Build()
        w = L * (0.35 + 0.03 * k)
        b.band((x, cy, cz), (1, 0, 0), UP, ry + 0.6, rz + 0.6, w, 1.3, c["plate"])
        for e in (-1, 1):
            b.band((x + e * w / 2, cy, cz), (1, 0, 0), UP, ry + 1.6, rz + 1.6, 1.4, 0.9, c["trim"])
        if k >= 2:
            b.gem((x, cy + ry + 2.2, cz), UP, 1.5 + 0.3 * k, 1.4, c["gem"])
        if k >= 3:
            for i in range(2 if k < 5 else 3):
                b.spike((x + (i - 0.5 * (1 if k < 5 else 2)) * w * 0.35, cy + ry * 0.4, cz - rz - 1.2), (0, 0.4, -1), 4 + 0.6 * k, 1.2, c["trim"])
        if k >= 4:  # fin along the forearm
            b.spike((x - sgn * w * 0.4, cy + ry + 1.5, cz), (-sgn * 1, 0.5, 0), 7 + k, 1.5, c["trim"])
        if k >= 5:
            for i in range(3):
                a = 2 * math.pi * i / 3
                b.crystal((x + sgn * 3, cy + math.cos(a) * (ry + 6), cz + math.sin(a) * (rz + 6)), (sgn, 0.2, 0), 2.6, 0.9, c["gem"])
        out["lowerarm_" + side] = b
    return out


def legs_piece(model, r):
    k, c = RARITIES.index(r), colors(r)
    legs = points(model, "legs")
    out = {}
    for side in ("l", "r"):
        kn = bone(model, "calf_" + side)[0]
        near = pick(legs, x=(kn.x - 6, kn.x + 6), y=(kn.y - 4, kn.y + 5))
        zf = max(p.z for p in near) if near else kn.z + 6
        b = Build()
        ctr = Vector((kn.x, kn.y + 1, zf - 0.5))
        b.dome(ctr, FWD, UP, 4.5 + 0.5 * k, 5.5 + 0.5 * k, 2.5 + 0.3 * k, c["plate"], seg=10, rings=3)
        b.band(ctr + FWD * 0.2, FWD, UP, 4.4 + 0.5 * k, 5.4 + 0.5 * k, 1.2, 0.8, c["trim"])
        if k >= 2:
            b.gem(ctr + FWD * (2.4 + 0.3 * k), FWD, 1.2 + 0.2 * k, 1.2, c["gem"])
        if k >= 3:
            b.spike(ctr + Vector((0, 4 + 0.4 * k, 1)), (0, 0.6, 1), 3.5 + 0.6 * k, 1.2, c["trim"])
        shin = pick(points(model, "legs", {"calf_" + side}, 0.5), y=(kn.y - 16, kn.y - 6))
        if k >= 4 and shin:
            cx = sum(p.x for p in shin) / len(shin)
            czs = sum(p.z for p in shin) / len(shin)
            rx = max(abs(p.x - cx) for p in shin)
            rz = max(abs(p.z - czs) for p in shin)
            b.band((cx, kn.y - 11, czs), UP, (1, 0, 0), rx + 0.6, rz + 0.6, 4, 1.1, c["trim"])
        if k >= 5:
            for i in range(2):
                b.crystal((kn.x + (i - 0.5) * 9, kn.y - 4, zf + 6), (0, 1, 0.3), 2.8, 1.0, c["gem"])
        out["calf_" + side] = b
    if k >= 2:  # belt buckle
        pel = bone(model, "pelvis")[0]
        yb = pel.y - 3
        near = pick(legs, x=(-6, 6), y=(yb - 3, yb + 3))
        zf = max(p.z for p in near) if near else pel.z + 12
        b = Build()
        b.slab((0, yb, zf + 0.5), FWD, (1, 0, 0), 7 + k, 5 + 0.6 * k, 1.2, c["trim"])
        b.gem((0, yb, zf + 1.2), FWD, 1.3 + 0.2 * k, 1.1, c["gem"])
        out["pelvis"] = b
    return out


def amulet_piece(faction, r):
    """Pendant on the chest, fitted to the bulkiest chest of the faction (it hangs over any of them)."""
    k, c = RARITIES.index(r), colors(r)
    models = [HERO[faction]] + [m for _, m in SETS[faction]]
    s3 = bone(models[0], "spine_03")[0]
    ya = s3.y + 9
    zf = max(max((p.z for p in pick(points(m, "chest"), y=(ya - 3, ya + 3), x=(-5, 5))), default=s3.z) for m in models)
    b = Build()
    ctr = Vector((0, ya - 3, zf + 1.0))
    for s in (-1, 1):  # chain
        top = Vector((s * 9, ya + 9, zf - 7))
        b.slab((ctr + top) / 2, FWD, top - ctr, (top - ctr).length, 0.9, 0.9, c["steel"] if k < 3 else c["trim"])
    b.dome(ctr, FWD, UP, 3 + 0.45 * k, 3 + 0.45 * k, 1.0, c["trim"] if k else (0.6, 0.42, 0.22), seg=8, rings=2)
    b.gem(ctr + FWD * 0.8, FWD, 1.6 + 0.35 * k, 1.5, c["gem"])
    if k >= 3:
        for i in range(6):
            a = 2 * math.pi * i / 6
            b.spike(ctr + Vector((math.cos(a), math.sin(a), 0)) * (3 + 0.45 * k), (math.cos(a), math.sin(a), 0), 1.8 + 0.4 * k, 0.6, c["trim"])
    if k >= 4:
        for s in (-1, 1):
            b.spike(ctr + Vector((s * 3.5, 1.5, 0)), (s, 0.6, 0), 5 + k, 1.0, c["trim"])
    if k >= 5:
        for i in range(3):
            b.crystal(ctr + Vector(((i - 1) * 5, 8, 3)), (0, 1, 0.2), 2.4, 0.8, c["gem"])
    return {"spine_03": b}


def ring_piece(faction, r):
    """A ring on the right middle finger (the hand that holds the weapon), with a glow above the hand on rare+."""
    k, c = RARITIES.index(r), colors(r)
    models = [HERO[faction]] + [m for _, m in SETS[faction]]
    f0 = bone(models[0], "middle_01_r")[0]
    pts = sum((points(m, "arms", {"middle_01_r"}, 0.5) for m in models), [])
    hb = bone(models[0], "hand_r")[0]
    d = (f0 - hb).normalized()
    if pts:
        cen = sum(pts, Vector()) / len(pts)
        rad = max((p - cen - d * d.dot(p - cen)).length for p in pts)
    else:
        cen, rad = f0, 2.5
    b = Build()
    b.band(cen, d, UP, rad + 0.2, rad + 0.2, 1.6 + 0.2 * k, 0.6, c["trim"] if k else (0.6, 0.42, 0.22), seg=10)
    b.gem(cen + UP * (rad + 1.0), UP, 0.9 + 0.2 * k, 1.0, c["gem"])
    if k >= 5:
        for i in range(3):
            a = 2 * math.pi * i / 3
            b.crystal(cen + Vector((0, math.cos(a), math.sin(a))) * (rad + 5), d, 1.8, 0.6, c["gem"])
    return {"middle_01_r": b}


# ---------- Blender objects ----------

def materials():
    out = {}
    for name, glow in (("armor_body", False), ("armor_glow", True)):
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        nt.nodes.clear()
        outn = nt.nodes.new("ShaderNodeOutputMaterial")
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Metallic"].default_value = 0.0 if glow else 0.5
        bsdf.inputs["Roughness"].default_value = 0.2 if glow else 0.45
        if glow:
            nt.links.new(vc.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 2.5
        nt.links.new(bsdf.outputs["BSDF"], outn.inputs["Surface"])
        out[glow] = m
    return out


def to_object(b, name, col, mats, at):
    me = bpy.data.meshes.new(name)
    # mesh space (cm, Y up, front +Z) -> Blender (m, Z up, front -Y)
    me.from_pydata([(p.x / 100, -p.z / 100, p.y / 100) for p in b.verts], [], [f[0] for f in b.faces])
    me.materials.append(mats[False])
    me.materials.append(mats[True])
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    for poly, (_, color, glow) in zip(me.polygons, b.faces):
        poly.material_index = 1 if glow else 0
        poly.use_smooth = False
        lc = (*rg.lin(color), 1.0)
        for li in poly.loop_indices:
            attr.data[li].color = lc
    me.color_attributes.active_color = attr
    me.validate()
    ob = bpy.data.objects.new(name, me)
    ob.location = at
    col.objects.link(ob)
    return ob


def collection(name, parent):
    c = bpy.data.collections.get(name)
    if c:
        for ob in list(c.objects):
            me = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if me and me.users == 0:
                bpy.data.meshes.remove(me)
    else:
        c = bpy.data.collections.new(name)
        parent.children.link(c)
    return c


def build():
    root = bpy.data.collections.get("Armor") or bpy.data.collections.new("Armor")
    if root.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(root)
    mats = materials()
    items = []  # (glb name, [objects])
    for fi, faction in enumerate(SETS):
        col = collection("Armor_" + faction, root)
        for si, (set_id, model) in enumerate(SETS[faction]):
            for k, r in enumerate(RARITIES):
                if k == 0:
                    continue
                at = (-3.0 + 1.2 * k, -24.0 - 2.5 * si - 9.0 * fi, 0.0)
                for slot, fn in (("head", head_piece), ("chest", chest_piece), ("arms", arms_piece), ("legs", legs_piece)):
                    glb = f"armor_{set_id}_{slot}_{r}_{faction}"
                    obs = [to_object(b, f"{glb}__{bn}", col, mats, at) for bn, b in fn(model, r).items()]
                    items.append((glb, obs))
        for k, r in enumerate(RARITIES):
            at = (-3.0 + 1.2 * k, -24.0 - 7.5 - 9.0 * fi, 0.0)
            for slot, fn in (("amulet", amulet_piece), ("ring", ring_piece)):
                glb = f"armor_{slot}_{r}_{faction}"
                items.append((glb, [to_object(b, f"{glb}__{bn}", col, mats, at) for bn, b in fn(faction, r).items()]))
    return items


def main():
    items = build()
    if SAVE_AS:
        bpy.ops.wm.save_as_mainfile(filepath=SAVE_AS, copy=True)
        print("saved", SAVE_AS)
    for glb, obs in items:
        rg.export_glb(obs, glb)
    print("armor pieces:", len(items))


if __name__ == "__main__":
    main()
