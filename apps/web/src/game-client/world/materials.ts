import { DataTexture, DoubleSide, MeshBasicMaterial, MeshLambertMaterial, MeshToonMaterial, NearestFilter, RedFormat } from 'three';
import { type TextureId, textureFor, textureTile } from './textures';

/*
 * Shared world materials. Ground and wall textures are mapped by world position instead of UVs
 * (the face's dominant axis picks the plane), so a texture keeps its real-world scale on every
 * floor patch, block and wall, however big or turned, and instanced props need no per-size UVs.
 */

const worldUv = new Map<string, MeshLambertMaterial>();

export interface WorldUvOptions {
  /** Drawn over the ground (a patch draped on a slope): pulled forward so it never flickers through. */
  decal?: boolean;
  /** Both faces drawn (the sides under a floating floor). */
  doubleSided?: boolean;
}

/**
 * A Lambert material whose texture repeats every `textureTile(id)` metres in world space,
 * optionally tinted (the ground outside the floor is a duller copy of a surface).
 */
export function worldUvMaterial(id: TextureId, tint = '#ffffff', options: WorldUvOptions = {}): MeshLambertMaterial {
  const key = `${id}:${tint}:${options.decal ? 'd' : ''}${options.doubleSided ? '2' : ''}`;
  let material = worldUv.get(key);
  if (!material) {
    material = new MeshLambertMaterial({
      map: textureFor(id),
      color: tint,
      ...(options.decal && { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      ...(options.doubleSided && { side: DoubleSide }),
    });
    const scale = 1 / textureTile(id);
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uWorldUvScale = { value: scale };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldUvPos;\nvarying vec3 vWorldUvNormal;')
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vec4 worldUvPos = vec4(transformed, 1.0);
          vec3 worldUvNormal = objectNormal;
          #ifdef USE_INSTANCING
            worldUvPos = instanceMatrix * worldUvPos;
            worldUvNormal = mat3(instanceMatrix) * worldUvNormal;
          #endif
          vWorldUvPos = (modelMatrix * worldUvPos).xyz;
          vWorldUvNormal = mat3(modelMatrix) * worldUvNormal;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uWorldUvScale;\nvarying vec3 vWorldUvPos;\nvarying vec3 vWorldUvNormal;')
        .replace(
          '#include <map_fragment>',
          `vec3 worldUvN = abs(normalize(vWorldUvNormal));
          vec2 worldUv = worldUvN.y >= max(worldUvN.x, worldUvN.z) ? vWorldUvPos.xz : (worldUvN.x >= worldUvN.z ? vWorldUvPos.zy : vWorldUvPos.xy);
          diffuseColor *= texture2D(map, worldUv * uWorldUvScale);`,
        );
    };
    material.customProgramCacheKey = () => `world-uv-${scale}`;
    worldUv.set(key, material);
  }
  return material;
}

let ramp: DataTexture | null = null;
/** The same three-step toon ramp the characters use, so props and players shade alike. */
function toonRamp(): DataTexture {
  if (!ramp) {
    ramp = new DataTexture(new Uint8Array([100, 175, 255]), 3, 1, RedFormat);
    ramp.minFilter = ramp.magFilter = NearestFilter;
    ramp.needsUpdate = true;
  }
  return ramp;
}

let toon: MeshToonMaterial | null = null;
/** Toon shading with per-vertex colours (and per-instance tints): every prop model shares it. */
export function propMaterial(): MeshToonMaterial {
  toon ??= new MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp() });
  return toon;
}

let glow: MeshBasicMaterial | null = null;
/** Unlit, for parts that give off light: lamp bulbs, screens, light strips. */
export function glowMaterial(): MeshBasicMaterial {
  glow ??= new MeshBasicMaterial({ vertexColors: true, toneMapped: false, fog: false });
  return glow;
}
