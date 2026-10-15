"""Renders preview PNGs of a retargeted .blend (peasant mesh + armature with the new action), Workbench.
The .blend is the one saved by retarget_mixamo.py; the pose is the Blender-side truth, the three-side check
is tools/clip-pose-dump.mjs on the exported FBX.

blender -b --factory-startup --python-exit-code 1 -P tools/blender/preview_clip.py -- \
    <retargeted.blend> <out_dir> <name> <frame0-based,frame,...> [3q|side|front]
Frames are 0-based clip frames (clip frame i = action start + i).
"""
import os
import sys

import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1:]
BLEND, OUT_DIR, NAME, FRAMES = ARGS[:4]
VIEW = ARGS[4] if len(ARGS) > 4 else "3q"
os.makedirs(OUT_DIR, exist_ok=True)

bpy.ops.wm.open_mainfile(filepath=BLEND)
char = next(o for o in bpy.data.objects if o.type == "ARMATURE")
act = char.animation_data.action
f0 = int(act.frame_range[0])

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.render.resolution_x, scene.render.resolution_y = 640, 640
sh = scene.display.shading
sh.light = "STUDIO"
sh.color_type = "MATERIAL"
scene.world = bpy.data.worlds.new("w")
scene.world.color = (0.55, 0.62, 0.7)
cam_data = bpy.data.cameras.new("cam")
cam_data.lens = 70
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam
target = Vector((0, -0.2, 0.9))
pos = {"3q": Vector((-3.4, -3.8, 1.4)), "side": Vector((-5.2, -0.2, 1.1)), "front": Vector((0.0, -5.2, 1.2))}[VIEW]
cam.location = pos
cam.rotation_euler = (target - pos).to_track_quat("-Z", "Y").to_euler()

for fr in [int(x) for x in FRAMES.split(",")]:
    scene.frame_set(f0 + fr + 1)  # frame_set to the current frame is a no-op, force re-evaluation
    scene.frame_set(f0 + fr)
    hp = char.matrix_world @ char.pose.bones["hand_r"].head
    print("[pose] frame", fr, "hand_r three-space cm", tuple(round(v * 100) for v in (hp.x, hp.z, -hp.y)))
    scene.render.filepath = os.path.join(OUT_DIR, f"{NAME}_{VIEW}_f{fr:02d}.png")
    bpy.ops.render.render(write_still=True)
