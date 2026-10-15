"""Warrior gear by quality (docs/features/warrior): the artist's weapons from wow.blend plus procedural shields.

The blend holds sword / axe / hammer / polearm x common..mythic (collections Swords, Axes, Hammers, Polearms) in metres,
long axis along +Z. This script adds the shields in the same style (collection Shields: tower / buckler / spiked x six
qualities, palette taken from the weapons: steel, the quality's accent colour, a glowing gem, floating crystals on
mythic), optionally saves the blend, and exports every non-common weapon and every shield to
public/assets/models/<name>.glb in centimetres (Y up, like the Bitgem FBX weapons). Common weapons are the game's
existing FBX models, so they are not exported.

blender -b <wow.blend> --factory-startup --python-exit-code 1 -P tools/blender/rarity_gear.py -- [save_as.blend] [preview_dir]
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SAVE_AS = ARGS[0] if len(ARGS) > 0 and ARGS[0] else None
PREVIEW_DIR = ARGS[1] if len(ARGS) > 1 else None
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
MODELS = os.path.join(REPO, "public", "assets", "models")

RARITIES = ["common", "uncommon", "rare", "epic", "legendary", "mythic"]
WEAPON_COLLECTIONS = ["Swords", "Axes", "Hammers", "Polearms"]

# Quality palette, read off the artist's sword materials (accent metal, glowing gem); common = wood and iron.
ACCENT = {
    "common": (0.42, 0.26, 0.13), "uncommon": (0.35, 0.6, 0.38), "rare": (0.35, 0.5, 0.85),
    "epic": (0.42, 0.22, 0.7), "legendary": (1.0, 0.7, 0.2), "mythic": (0.3, 0.03, 0.05),
}
GEM = {
    "uncommon": ((0.15, 0.85, 0.2), 1.2), "rare": ((0.1, 0.4, 1.0), 1.6), "epic": ((0.6, 0.15, 1.0), 2.0),
    "legendary": ((1.0, 0.72, 0.12), 2.4), "mythic": ((1.0, 0.06, 0.08), 3.0),
}
STEEL = (0.62, 0.66, 0.72)
IRON = (0.33, 0.35, 0.38)
GOLD = (1.0, 0.72, 0.25)
LEATHER = (0.36, 0.22, 0.12)


def lin(c):
    """Palette values are display (sRGB) colours; Blender and glTF store linear ones."""
    return tuple(x ** 2.2 for x in c)


def material(name, color, metal=0.0, rough=0.5, emit=None):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*lin(color), 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*lin(emit[0]), 1)
        bsdf.inputs["Emission Strength"].default_value = emit[1]
    return m


def palette(r):
    """Materials of one quality: plate, rim, trim, gem (None for common), grip."""
    plate = material(f"shield_{r}_plate", ACCENT[r], 0.0 if r == "common" else 0.6, 0.8 if r == "common" else 0.35)
    rim = material(f"shield_{r}_rim", IRON if r in ("common", "mythic") else STEEL, 0.7, 0.4)
    trim = material(f"shield_{r}_trim", GOLD if r in ("legendary", "epic") else STEEL, 0.8, 0.3)
    gem = material(f"shield_{r}_gem", GEM[r][0], 0.0, 0.15, GEM[r]) if r in GEM else None
    grip = material(f"shield_{r}_grip", LEATHER, 0.0, 0.7)
    return {"plate": plate, "rim": rim, "trim": trim, "gem": gem or trim, "grip": grip}


class Mesh:
    """bmesh with named materials. Shield space: face toward -Y, up +Z, the grip at the origin behind the plate."""

    def __init__(self, mats):
        self.bm = bmesh.new()
        self.names = list(mats)
        self.mats = mats

    def v(self, co):
        return self.bm.verts.new(co)

    def f(self, verts, part):
        try:
            face = self.bm.faces.new(verts)
        except ValueError:
            return None
        face.material_index = self.names.index(part)
        return face

    def band(self, a, b, part):
        n = len(a)
        for i in range(n):
            j = (i + 1) % n
            self.f([a[i], a[j], b[j], b[i]], part)

    def fan(self, center, ring, part):
        n = len(ring)
        for i in range(n):
            self.f([center, ring[i], ring[(i + 1) % n]], part)

    def gem(self, at, r, depth, part="gem", seg=6):
        """Faceted cabochon on the front: a ring and a tip pointing -Y."""
        ring = [self.v((at[0] + r * math.cos(2 * math.pi * i / seg), at[1], at[2] + r * math.sin(2 * math.pi * i / seg))) for i in range(seg)]
        tip = self.v((at[0], at[1] - depth, at[2]))
        back = self.v((at[0], at[1] + 0.002, at[2]))
        self.fan(tip, ring, part)
        self.fan(back, list(reversed(ring)), part)

    def spike(self, base, direction, length, r, part="trim", seg=5):
        d = Vector(direction).normalized()
        side = d.orthogonal().normalized()
        up = d.cross(side).normalized()
        ring = [self.v(Vector(base) + r * (math.cos(2 * math.pi * i / seg) * side + math.sin(2 * math.pi * i / seg) * up)) for i in range(seg)]
        tip = self.v(Vector(base) + d * length)
        self.fan(tip, list(reversed(ring)), part)
        self.fan(self.v(Vector(base) - d * 0.005), ring, part)

    def crystal(self, at, h, r, tilt, part="gem"):
        """Floating shard: a stretched octahedron."""
        c = Vector(at)
        axis = Vector((math.sin(tilt), 0, math.cos(tilt)))
        side = Vector((math.cos(tilt), 0, -math.sin(tilt)))
        ring = [self.v(c + r * (math.cos(a) * side + math.sin(a) * Vector((0, 1, 0)))) for a in (0, math.pi / 2, math.pi, 1.5 * math.pi)]
        top, bot = self.v(c + axis * h), self.v(c - axis * h * 0.6)
        self.fan(top, ring, part)
        self.fan(bot, list(reversed(ring)), part)

    def box(self, lo, hi, part):
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        v = [self.v((x, y, z)) for z in (z0, z1) for y in (y0, y1) for x in (x0, x1)]
        for q in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
            self.f([v[i] for i in q], part)

    def finish(self, name, collection):
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for n in self.names:
            me.materials.append(self.mats[n])
        for p in me.polygons:
            p.use_smooth = False
        ob = bpy.data.objects.new(name, me)
        collection.objects.link(ob)
        return ob


def plate(m, outline, front, back, bulge, part, rim_part, rim_w, rim_h, bend=0.0):
    """A shield plate from a 2D outline (x, z): domed front (centre `bulge` m further out), flat back, a raised rim.
    `bend`: the plate curves back at the sides (tower shields), y += bend * x^2."""
    cx = sum(p[0] for p in outline) / len(outline)
    cz = sum(p[1] for p in outline) / len(outline)
    y = lambda x: front + bend * x * x
    inner = [(cx + (x - cx) * (1 - rim_w), cz + (z - cz) * (1 - rim_w)) for x, z in outline]
    outer_f = [m.v((x, y(x) - rim_h, z)) for x, z in outline]
    inner_f = [m.v((x, y(x) - rim_h, z)) for x, z in inner]
    inner_d = [m.v((x, y(x), z)) for x, z in inner]
    mid = [m.v((cx + (x - cx) * 0.5, y(cx + (x - cx) * 0.5) - bulge * 0.7, cz + (z - cz) * 0.5)) for x, z in inner]
    centre = m.v((cx, y(cx) - bulge, cz))
    outer_b = [m.v((x, back + bend * x * x, z)) for x, z in outline]
    m.band(outer_b, outer_f, rim_part)       # side wall
    m.band(outer_f, inner_f, rim_part)       # rim top
    m.band(inner_f, inner_d, rim_part)       # rim inner wall
    m.band(inner_d, mid, part)               # plate
    m.fan(centre, mid, part)
    m.fan(m.v((cx, back, cz)), list(reversed(outer_b)), rim_part)  # back
    return inner


def rounded_rect(w, h, r, seg=3):
    pts = []
    for cx, cz, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return pts


def circle(r, seg=16):
    return [(r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg)) for i in range(seg)]


def heater(w, h, seg=6):
    """Heater shield outline: flat top, sides curving into a point at the bottom."""
    pts = [(w / 2, h * 0.45), (-w / 2, h * 0.45)]
    for i in range(seg + 1):
        t = i / seg
        pts.append((-w / 2 * (1 - t ** 1.6), h * 0.45 - h * 0.95 * math.sin(t * math.pi / 2)))
    for i in range(seg - 1, 0, -1):
        t = i / seg
        pts.append((w / 2 * (1 - t ** 1.6), h * 0.45 - h * 0.95 * math.sin(t * math.pi / 2)))
    return pts


def grip(m):
    m.box((-0.03, 0.012, -0.12), (0.03, 0.05, 0.12), "grip")


def decorate(m, r, k, centre, size, top):
    """Quality details: gem (uncommon+), rivets (rare+), side spikes (epic+), crown (legendary+), shards (mythic)."""
    if k >= 1:
        m.gem(centre, size * (0.13 + 0.02 * k), size * 0.12)
    if k >= 2:
        for i in range(8):
            a = 2 * math.pi * (i + 0.5) / 8
            p = (centre[0] + size * 0.32 * math.cos(a), centre[1] + 0.004, centre[2] + size * 0.32 * math.sin(a))
            m.box((p[0] - 0.012, p[1] - 0.02, p[2] - 0.012), (p[0] + 0.012, p[1], p[2] + 0.012), "trim")
    if k >= 4:
        for dx in (-0.6, 0, 0.6):
            m.spike((dx * size * 0.5, centre[1] + 0.02, top - 0.02), (dx * 0.4, 0, 1), size * (0.22 if dx == 0 else 0.15), 0.03)
    if k >= 5:
        for i, (dx, dz, tilt) in enumerate(((-0.75, 0.55, -0.3), (0.8, 0.4, 0.35), (-0.85, -0.3, 0.2), (0.7, -0.5, -0.25))):
            m.crystal((dx * size, centre[1] - 0.05, centre[2] + dz * size), size * 0.14, size * 0.04, tilt)


def tower(r, k):
    m = Mesh(palette(r))
    w, h = 0.66, 1.08
    outline = rounded_rect(w, h, 0.08)
    plate(m, outline, -0.03, 0.0, 0.02, "plate", "rim", 0.09, 0.012, bend=0.22)
    # a vertical and a horizontal band, wood planks on common
    m.box((-0.035, -0.075, -h / 2 + 0.05), (0.035, -0.035, h / 2 - 0.05), "rim" if k < 4 else "trim")
    m.box((-w / 2 + 0.06, -0.075, 0.12), (w / 2 - 0.06, -0.045, 0.19), "rim" if k < 4 else "trim")
    decorate(m, r, k, (0, -0.075, 0.155), 0.42, h / 2)
    if k >= 3:
        for sx in (-1, 1):
            m.spike((sx * (w / 2 - 0.02), -0.04, -h / 2 + 0.12), (sx, -0.3, -0.4), 0.12, 0.03)
    grip(m)
    return m


def buckler(r, k):
    m = Mesh(palette(r))
    plate(m, circle(0.29, 16), -0.03, 0.0, 0.06, "plate", "rim", 0.12, 0.014)
    # steel boss in the middle (the gem sits on it)
    m.gem((0, -0.085, 0), 0.08, 0.035, part="rim", seg=8)
    decorate(m, r, k, (0, -0.115, 0), 0.5, 0.29)
    if k >= 3:
        for i in range(4):
            a = 2 * math.pi * i / 4 + math.pi / 4
            m.spike((0.27 * math.cos(a), -0.03, 0.27 * math.sin(a)), (math.cos(a), -0.2, math.sin(a)), 0.1, 0.025)
    grip(m)
    return m


def spiked(r, k):
    m = Mesh(palette(r))
    w, h = 0.6, 0.78
    outline = heater(w, h)
    plate(m, outline, -0.03, 0.0, 0.03, "plate", "rim", 0.1, 0.014)
    # rim spikes on every quality, more with the quality; a long central spike
    n = 4 + k
    for i in range(n):
        t = (i + 0.5) / n
        idx = int(t * (len(outline) - 1))
        x, z = outline[idx]
        d = Vector((x, 0, z - (-0.05))).normalized()
        m.spike((x, -0.02, z), (d.x, -0.15, d.z), 0.07 + 0.01 * k, 0.022, part="rim" if k < 4 else "trim")
    m.spike((0, -0.05, 0.02), (0, -1, 0), 0.12 + 0.02 * k, 0.04, part="rim" if k < 2 else "trim")
    if k >= 1:
        for sx in (-1, 1):
            m.gem((sx * 0.13, -0.065, 0.16), 0.04 + 0.005 * k, 0.03)
    decorate(m, r, max(0, k - 1) if k < 5 else k, (0, -0.06, -0.15), 0.38, h * 0.45)
    grip(m)
    return m


SHIELDS = {"shield_tower": tower, "shield_buckler": buckler, "shield_spiked": spiked}


def build_shields():
    col = bpy.data.collections.get("Shields")
    if col:
        for ob in list(col.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
    else:
        col = bpy.data.collections.new("Shields")
        bpy.context.scene.collection.children.link(col)
    out = []
    for row, (name, fn) in enumerate(SHIELDS.items()):
        for k, r in enumerate(RARITIES):
            ob = fn(r, k).finish(f"{name}_{r}", col)
            # laid out in a grid below the weapons, like the artist's rows
            ob.location = (-2.6 + 1.3 * k, -16.0 - 2.2 * row, 0.7)
            out.append(ob)
    return out


def _linked(bsdf, socket):
    links = bsdf.inputs[socket].links
    return links[0].from_node if links else None


def _sample(img, uv, cache):
    """Nearest texel of `img` at `uv` (wrapped), as linear RGB."""
    px = cache.get(img.name)
    if px is None:
        px = cache[img.name] = list(img.pixels)
    w, h = img.size
    x = int((uv[0] % 1.0) * w) % w
    y = int((uv[1] % 1.0) * h) % h
    i = (y * w + x) * 4
    c = px[i:i + 3]
    return c if img.colorspace_settings.name != "sRGB" else [v ** 2.2 for v in c]


def _mix(node, a):
    """Blender's MixRGB on linear colours: COLOR keeps A's value with B's hue and saturation, MULTIPLY multiplies."""
    import colorsys
    by_id = {i.identifier: i for i in node.inputs}
    fac = (by_id.get("Factor_Float") or by_id["Fac"]).default_value
    b = list((by_id.get("B_Color") or by_id["Color2"]).default_value)[:3]
    if node.blend_type == "COLOR":
        h, s_, _ = colorsys.rgb_to_hsv(*b)
        _, _, v = colorsys.rgb_to_hsv(*a)
        r = colorsys.hsv_to_rgb(h, s_, v)
    elif node.blend_type == "MULTIPLY":
        r = [x * y for x, y in zip(a, b)]
    else:
        r = b
    return [x + (y - x) * fac for x, y in zip(a, r)]


def bake_colors(ob, me):
    """
    The artist's base colours come from a vertex colour (blades) or a character texture tinted by a Mix node
    (grips, shafts). The game loads GLB without images and reads only COLOR_0, so the final base colour of every
    corner is baked into one colour attribute and those materials export with a white base colour.
    Returns the indices of the baked material slots (empty when nothing needs baking).
    """
    plan = {}
    for i, slot in enumerate(ob.material_slots):
        m = slot.material
        bsdf = m and next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        src = bsdf and _linked(bsdf, "Base Color")
        if not src:
            continue
        if src.type == "VERTEX_COLOR":
            plan[i] = ("vcol", me.color_attributes.get(src.layer_name) or me.color_attributes[0], None)
        elif src.type in ("MIX", "MIX_RGB"):
            tex = next((l.from_node for inp in src.inputs if inp.enabled for l in inp.links if l.from_node.type == "TEX_IMAGE"), None)
            if tex and tex.image:
                plan[i] = ("tex", tex.image, src)
        elif src.type == "TEX_IMAGE" and src.image:
            plan[i] = ("tex", src.image, None)
    if not plan:
        return []
    vcols = {id(v[1]): [list(d.color) for d in v[1].data] for v in plan.values() if v[0] == "vcol"}
    uv = me.uv_layers.active.data if me.uv_layers.active else None
    cache = {}
    out = [(1.0, 1.0, 1.0, 1.0)] * len(me.loops)
    for poly in me.polygons:
        p = plan.get(poly.material_index)
        if not p:
            continue
        for li in poly.loop_indices:
            if p[0] == "vcol":
                c = vcols[id(p[1])][li][:3]
            else:
                c = _sample(p[1], uv[li].uv, cache) if uv else [0.5, 0.5, 0.5]
                if p[2]:
                    c = _mix(p[2], c)
            out[li] = (*c, 1.0)
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
    attr = me.color_attributes.new("bake", "FLOAT_COLOR", "CORNER")
    for li, c in enumerate(out):
        attr.data[li].color = c
    me.color_attributes.active_color = attr
    # the exporter writes the render colour as COLOR_0 (white when unset) and the active one after it
    me.color_attributes.render_color_index = me.color_attributes.active_color_index
    return list(plan)


def white_copy(m):
    """`m` for export after baking: white base colour, no colour links (the vertex colour carries the colour)."""
    w = m.copy()
    bsdf = next(n for n in w.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    for sock in ("Base Color", "Emission Color"):
        for l in list(bsdf.inputs[sock].links):
            w.node_tree.links.remove(l)
    bsdf.inputs["Base Color"].default_value = (1, 1, 1, 1)
    return w


def export_glb(obs, name):
    """Copies of `obs` (one object or a list) at the origin, scaled to centimetres, written as one GLB without images.
    Colours are baked (bake_colors) and normals recalculated outward: some of the artist's faces point inward and the
    game culls back faces. Each object becomes a node with the object's own name."""
    obs = obs if isinstance(obs, (list, tuple)) else [obs]
    temps, whites = [], {}  # whites: original material name -> (original, white copy)
    for ob in obs:
        node = ob.name
        ob.name = node + "__src"
        me = ob.data.copy()
        tmp = bpy.data.objects.new(node, me)
        bpy.context.scene.collection.objects.link(tmp)
        me.transform(ob.matrix_world.copy().to_3x3().to_4x4())  # rotation/scale only: the location is dropped
        me.transform(Matrix.Scale(100, 4))
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(me)
        bm.free()
        for i in bake_colors(tmp, me):
            orig = me.materials[i]
            key = orig.name
            if key not in whites:
                whites[key] = (orig, white_copy(orig))
            me.materials[i] = whites[key][1]
        temps.append((ob, node, tmp))
    # the GLB takes material names: the white copies get the originals' names for the export
    for key, (orig, w) in whites.items():
        orig.name = key + "__src"
        w.name = key
    bpy.ops.object.select_all(action="DESELECT")
    for _, _, tmp in temps:
        tmp.select_set(True)
    bpy.context.view_layer.objects.active = temps[0][2]
    path = os.path.join(MODELS, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_image_format="NONE", export_materials="EXPORT",
                              export_vertex_color="ACTIVE" if whites else "NONE", export_normals=True,
                              export_animations=False)
    for ob, node, tmp in temps:
        me = tmp.data
        bpy.data.objects.remove(tmp, do_unlink=True)
        bpy.data.meshes.remove(me)
        ob.name = node
    for key, (orig, w) in whites.items():
        bpy.data.materials.remove(w)
        orig.name = key
    print("wrote", path, os.path.getsize(path))


def preview(objs, path):
    scene = bpy.context.scene
    for o in scene.objects:
        o.hide_render = o not in objs
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    cam_data = bpy.data.cameras.new("preview_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = max(mx.x - mn.x, mx.z - mn.z) * 1.1
    cam = bpy.data.objects.new("preview_cam", cam_data)
    scene.collection.objects.link(cam)
    ctr = (mn + mx) / 2
    cam.location = (ctr.x + 1.5, mn.y - 6, ctr.z + 1.2)
    cam.rotation_euler = (Vector(ctr) - cam.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = cam
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = 1600, 900
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


def main():
    shields = build_shields()
    if SAVE_AS:
        bpy.ops.wm.save_as_mainfile(filepath=SAVE_AS, copy=True)
        print("saved", SAVE_AS)
    for c in WEAPON_COLLECTIONS:
        for ob in bpy.data.collections[c].objects:
            if not ob.name.endswith("_common"):
                export_glb(ob, ob.name)
    for ob in shields:
        export_glb(ob, ob.name)
    if PREVIEW_DIR:
        os.makedirs(PREVIEW_DIR, exist_ok=True)
        preview(shields, os.path.join(PREVIEW_DIR, "shields.png"))


if __name__ == "__main__":
    main()
