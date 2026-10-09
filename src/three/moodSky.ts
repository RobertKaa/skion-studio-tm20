import * as THREE from 'three';
import type { LightingPreset } from '../previewEnvironment';

export type MoodSky = THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

/** One sky shared by the visible circuit and each venue's reflection capture. */
export function createMoodSky(): MoodSky {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
      sunColor: { value: new THREE.Color() }, sunDirection: { value: new THREE.Vector3() }, night: { value: 0 } },
    vertexShader: `varying vec3 vDirection;
      void main() { vDirection = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 zenith, horizon, sunColor, sunDirection; uniform float night;
      varying vec3 vDirection;
      void main() {
        vec3 dir = normalize(vDirection);
        float height = max(dir.y, 0.0);
        vec3 color = mix(horizon, zenith, pow(height, 0.45));
        float alignment = max(dot(dir, sunDirection), 0.0);
        color += sunColor * pow(alignment, 36.0) * (1.0 - night) * 0.4;
        color += sunColor * smoothstep(0.9995, 0.9998, alignment) * mix(5.0, 1.0, night);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  }));
  sky.frustumCulled = false;
  return sky;
}

export function applyMoodSky(sky: MoodSky, preset: LightingPreset) {
  sky.material.uniforms.zenith.value.setHex(preset.sky);
  sky.material.uniforms.horizon.value.setHex(preset.horizon);
  sky.material.uniforms.sunColor.value.setHex(preset.sunColor);
  sky.material.uniforms.sunDirection.value.set(...preset.sunPosition).normalize();
  sky.material.uniforms.night.value = preset.headlights ? 1 : 0;
}
