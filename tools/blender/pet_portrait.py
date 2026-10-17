"""Pet portrait: blender -b --factory-startup -P pet_portrait.py -- in.glb out.png yaw front pitch"""
import bpy, sys, math, zlib, struct, numpy as np
from mathutils import Vector
args = sys.argv[sys.argv.index('--')+1:]
glb, out = args[:2]
YAW = float(args[2]); FRONT = float(args[3]); PITCH = float(args[4]) if len(args) > 4 else 15
CONTRAST = 1.15
DARKEN = 0.0
S = 512
K = 3  # supersample: render at S*K, outline at full res, then box-downsample
N = S * K
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
sc = bpy.context.scene
objs = [o for o in sc.objects if o.type == 'MESH']
root = bpy.data.objects.new('root', None); sc.collection.objects.link(root)
for o in sc.objects:
    if o.parent is None and o is not root: o.parent = root
root.rotation_mode = 'XYZ'
root.rotation_euler = (math.radians(PITCH), 0, math.radians(YAW))
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
pts = [e.matrix_world @ v.co for o in objs for e in [o.evaluated_get(dg)] for v in e.to_mesh().vertices]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
# portrait: keep the verts nearest the camera side (head) by projected x share FRONT of the width
w = hi.x - lo.x
sel = [p for p in pts if (p.x - lo.x) / w <= FRONT] if FRONT > 0 else [p for p in pts if (hi.x - p.x) / w <= -FRONT]
lo = Vector((min(p.x for p in sel), min(p.y for p in pts), min(p.z for p in sel)))
hi = Vector((max(p.x for p in sel), max(p.y for p in pts), max(p.z for p in sel)))
c0 = lo
ctr = (c0 + hi) / 2
size = max(hi.x - c0.x, hi.z - c0.z) * 1.12
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam)
cam.data.type = 'ORTHO'; cam.data.ortho_scale = size
cam.location = (ctr.x, lo.y - 1000, ctr.z); cam.data.clip_end = 100000; cam.rotation_euler = (math.radians(90), 0, 0)
sc.camera = cam
for rot, e in (((50, 0, 30), 4), ((60, 0, -120), 2)):
    l = bpy.data.objects.new('l', bpy.data.lights.new('l', 'SUN')); l.data.energy = e
    l.rotation_euler = [math.radians(a) for a in rot]; sc.collection.objects.link(l)
sc.world = bpy.data.worlds.new('w'); sc.world.use_nodes = True
sc.world.node_tree.nodes['Background'].inputs[0].default_value = (0.35, 0.35, 0.38, 1)
sc.render.engine = 'BLENDER_EEVEE'
sc.render.film_transparent = True
sc.render.resolution_x = sc.render.resolution_y = N
sc.view_settings.view_transform = 'Standard'
# thin inner lines so every small part gets its own contour
sc.render.use_freestyle = False
sc.render.line_thickness_mode = 'ABSOLUTE'; sc.render.line_thickness = 0.6 * K
fs = sc.view_layers[0].freestyle_settings
ls = fs.linesets[0] if len(fs.linesets) else fs.linesets.new('lines')
if ls.linestyle is None: ls.linestyle = bpy.data.linestyles.new('ink')
ls.select_by_visibility = True
ls.select_silhouette = ls.select_border = ls.select_material_boundary = True; ls.select_crease = False
ls.linestyle.color = (0, 0, 0); ls.linestyle.thickness = 0.6 * K
# pass 1: wide low-res mask, then fit the camera round the head side (FRONT share of the width, right side if <0)
cam.data.ortho_scale = size * 3; cam.location.x = ctr.x; cam.location.z = ctr.z
L = 256
sc.render.resolution_x = sc.render.resolution_y = L
sc.render.filepath = out + '.mask.png'; bpy.ops.render.render(write_still=True)
mk = bpy.data.images.load(out + '.mask.png'); mk.colorspace_settings.name = 'Non-Color'
al = np.array(mk.pixels[:]).reshape(L, L, 4)[..., 3] > 0.05
ys, xs = np.nonzero(al)
x0, x1 = xs.min(), xs.max()
cut = (x1 - (x1 - x0) * -FRONT) if FRONT < 0 else (x0 + (x1 - x0) * FRONT)
keep = (xs >= cut) if FRONT < 0 else (xs <= cut)
hx0, hx1, hy0, hy1 = xs[keep].min(), xs[keep].max(), ys[keep].min(), ys[keep].max()
px2w = cam.data.ortho_scale / L
cx = cam.location.x + ((hx0 + hx1) / 2 - L / 2) * px2w
side = max(hx1 - hx0, hy1 - hy0) * 1.1
cz = cam.location.z + ((hy0 + hy1) / 2 - L / 2) * px2w
cam.data.ortho_scale = side * px2w
cam.location.x = cx; cam.location.z = cz
sc.render.resolution_x = sc.render.resolution_y = N
tmp = out + '.raw.png'
sc.render.filepath = tmp; bpy.ops.render.render(write_still=True)
img = bpy.data.images.load(tmp); img.colorspace_settings.name = 'Non-Color'
px = np.array(img.pixels[:]).reshape(N, N, 4)
a = px[..., 3]
m = a > 0.05
# see-through parts (orb glass) read too solid at icon size: thin them out
GLASS = 0.45
glass = a < 0.98
a = np.where(glass, a * GLASS, a)
if DARKEN:
    ys, xs = np.nonzero(m)
    r = np.hypot(np.arange(N)[:, None] - ys.mean(), np.arange(N)[None, :] - xs.mean())
    k = np.clip(1 - r / r[m].max(), 0, 1)[..., None] * DARKEN
    px[..., :3] = np.where(glass[..., None], px[..., :3] * (1 - k), px[..., :3])
    a = np.where(glass, np.minimum(a * (1 + k[..., 0]), 1), a)
    a = np.where(glass & m, 1 - (1 - a) * 0.5, a)  # glass half as see-through
# outer outline: dilate the weapon mask by R px (disc), drawn under the weapon
R = 5 * K
mp = np.pad(m, R)
d = m.copy()
for dy in range(-R, R + 1):
    for dx in range(-R, R + 1):
        if dx * dx + dy * dy <= R * R: d |= mp[R + dy:R + dy + N, R + dx:R + dx + N]
rgb = np.clip((px[..., :3] - 0.5) * CONTRAST + 0.5, 0, 1)
# weapon over its black outline (outline only outside the weapon, so see-through parts like orb glass keep their alpha)
o = (d & ~m).astype(float)
A = a + o * (1 - a)
res = np.dstack([rgb * a[..., None], A])  # premultiplied
res = res.reshape(S, K, S, K, 4).mean((1, 3))
res[..., :3] /= np.maximum(res[..., 3:], 1e-6)

def png(path, rgb):
    hgt, w, c = rgb.shape
    rows = (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)[::-1]  # Blender rows go bottom-up
    raw = b''.join(b'\0' + r.tobytes() for r in rows)
    ch = lambda t, dd: struct.pack('>I', len(dd)) + t + dd + struct.pack('>I', zlib.crc32(t + dd))
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, hgt, 8, 6 if c == 4 else 2, 0, 0, 0))
                           + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b''))
png(out, res)
