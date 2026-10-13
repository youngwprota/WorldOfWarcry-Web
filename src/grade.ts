// Mobile-game colour grade: every built-in three.js material gets extra saturation and a little contrast
// right before the output colour-space conversion. Patches the shared shader chunk, so it costs a few ALU ops
// per pixel and no extra render pass. Must be imported before the first material compiles.
import * as THREE from 'three';

export const GRADE = { saturation: 1.2, contrast: 1.08 };

THREE.ShaderChunk.colorspace_fragment = /* glsl */ `
{
  vec3 c = gl_FragColor.rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, ${GRADE.saturation.toFixed(3)});
  // contrast around mid-grey in linear space (0.18), keeps highlights from clipping too fast
  c = 0.18 * pow(max(c, 0.0) / 0.18, vec3(${GRADE.contrast.toFixed(3)}));
  gl_FragColor.rgb = c;
}
${THREE.ShaderChunk.colorspace_fragment}`;
