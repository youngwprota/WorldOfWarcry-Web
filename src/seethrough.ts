import * as THREE from 'three';

/**
 * Occlusion cut-out: fragments of trees/buildings between the camera and the hero are
 * dithered away so the hero (and the fight around them) is never hidden. Shadow passes use
 * depth materials, so shadows stay intact.
 */
export const seeThrough = {
  hero: { value: new THREE.Vector3() },
  cam: { value: new THREE.Vector3() },
  radius: { value: 2.6 },
};

export function applySeeThrough<T extends THREE.Material>(mat: T): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    shader.uniforms.uSeeHero = seeThrough.hero;
    shader.uniforms.uSeeCam = seeThrough.cam;
    shader.uniforms.uSeeR = seeThrough.radius;
    shader.vertexShader = 'varying vec3 vSeeW;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      `#include <project_vertex>
       vec4 seeW = vec4(transformed, 1.0);
       #ifdef USE_INSTANCING
         seeW = instanceMatrix * seeW;
       #endif
       vSeeW = (modelMatrix * seeW).xyz;`,
    );
    shader.fragmentShader = 'uniform vec3 uSeeHero;\nuniform vec3 uSeeCam;\nuniform float uSeeR;\nvarying vec3 vSeeW;\n' +
      shader.fragmentShader.replace(
        'void main() {',
        `void main() {
          vec3 ab = uSeeHero - uSeeCam;
          float t = clamp(dot(vSeeW - uSeeCam, ab) / dot(ab, ab), 0.0, 1.0);
          float d = length(vSeeW - (uSeeCam + ab * t));
          if (t < 0.96 && vSeeW.y > 0.5 && d < uSeeR) {
            float k = smoothstep(uSeeR, uSeeR * 0.55, d);
            float n = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
            if (n < k * 0.88) discard;
          }`,
      );
  };
  mat.customProgramCacheKey = () => 'see';
  return mat;
}
