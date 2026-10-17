#!/bin/sh
# Rebuilds both frog skins + GLBs from public/assets/models/human_murloc.glb (never modified).
# usage: sh run_paint.sh   (scratch posmap path below: edit if the session scratchpad is gone)
set -e
BL="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
D="C:/Unity proj/WorldOfWarcry-Web/Art/Source/murloc_frog_recolor"
M="C:/Unity proj/WorldOfWarcry-Web/public/assets/models"
SP="${SCRATCH:-C:/Users/User/AppData/Local/Temp/claude/C--Unity-proj-WorldOfWarcry-Web/8fa5bf45-8571-4e8e-9250-876f490a3f5d/scratchpad}"
[ -f "$D/orig_img1.png" ] || python "$D/extract_skin.py" "$M/human_murloc.glb" "$D/orig_img1.png"
[ -f "$SP/posmap.npz" ] || "$BL" -b --factory-startup -P "$D/bake.py" -- "$M/human_murloc.glb" "$SP/posmap.npz"
"$BL" -b --factory-startup -P "$D/paint.py" -- "$D/orig_img1.png" "$SP/posmap.npz" "$D" 2>&1 | grep -v INFO | tail -3
python "$D/glb_swap.py" "$M/human_murloc.glb" "$D/skin_dartfrog.png" "$M/murloc_dartfrog.glb" murloc_skin_dartfrog
python "$D/glb_swap.py" "$M/human_murloc.glb" "$D/skin_treefrog.png" "$M/murloc_treefrog.glb" murloc_skin_treefrog
