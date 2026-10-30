import { type HeightField, PROPS, type WorldLayout, buildHeightField, heightAt } from '@volleyland/game-core';
import { textureBase } from './textures';
import { THEME_LOOKS } from './themes';

/** Below this height a prop is low cover: throws fly over it (projectiles fly at about 1.2 m). */
export const LOW_COVER_HEIGHT = 0.95;

/**
 * Draw a world from above onto a canvas: floor, painted regions and props, oriented the way
 * players see it (+z up, +x to the left, because the game camera looks along +z). `scale` is
 * pixels per metre; the floor's centre lands at the canvas centre.
 */
export function drawWorldMap(ctx: CanvasRenderingContext2D, layout: WorldLayout, scale: number, lowCoverHeight = LOW_COVER_HEIGHT): void {
  const { width, height } = ctx.canvas;
  const look = THEME_LOOKS[layout.theme];
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.translate(width / 2, height / 2);
  ctx.scale(-scale, -scale); // +x left, +z up

  ctx.fillStyle = textureBase(layout.floor);
  ctx.fillRect(-layout.halfWidth, -layout.halfDepth, layout.halfWidth * 2, layout.halfDepth * 2);

  for (const r of layout.regions) {
    ctx.save();
    ctx.translate(r.x, r.z);
    // A turn of θ about y maps local x to (cos θ, −sin θ) on the floor: a canvas rotation of −θ here.
    ctx.rotate((-r.rotation * Math.PI) / 180);
    ctx.fillStyle = textureBase(r.surface);
    ctx.beginPath();
    if (r.shape === 'rect') ctx.rect(-r.width / 2, -r.depth / 2, r.width, r.depth);
    else ctx.ellipse(0, 0, r.width / 2, r.depth / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const field = buildHeightField(layout);
  if (field) {
    // Hill shading lit from the top left of the map, so hills and hollows read at a glance.
    const shade = hillShade(field, Math.max(0.5, 1 / scale));
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(shade, -layout.halfWidth, -layout.halfDepth, layout.halfWidth * 2, layout.halfDepth * 2);
  }

  for (const p of layout.props) {
    ctx.fillStyle = p.height < lowCoverHeight ? look.map.low : look.map.prop;
    ctx.beginPath();
    if (PROPS[p.kind].shape === 'circle') {
      ctx.arc(p.x, p.z, p.width / 2, 0, Math.PI * 2);
    } else {
      ctx.save();
      ctx.translate(p.x, p.z);
      ctx.rotate((-p.rotation * Math.PI) / 180);
      ctx.rect(-p.width / 2, -p.depth / 2, p.width, p.depth);
      ctx.restore();
    }
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Light and shadow for hilly ground, one pixel per `step` metres: a canvas covering the floor with
 * pixel (i, j) at x = −halfWidth + i·step, z = −halfDepth + j·step (the map's transform turns it).
 */
function hillShade(field: HeightField, step: number): HTMLCanvasElement {
  const width = -field.originX * 2;
  const depth = -field.originZ * 2;
  const cols = Math.max(1, Math.min(512, Math.round(width / step)));
  const rows = Math.max(1, Math.min(512, Math.round(depth / step)));
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(cols, rows);
  const sx = width / cols;
  const sz = depth / rows;
  // Light from +x and +z (the map's top left), 45° up.
  const light = { x: 0.5, y: Math.SQRT1_2, z: 0.5 };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = field.originX + (i + 0.5) * sx;
      const z = field.originZ + (j + 0.5) * sz;
      const gx = (heightAt(field, x + sx, z) - heightAt(field, x - sx, z)) / (2 * sx);
      const gz = (heightAt(field, x, z + sz) - heightAt(field, x, z - sz)) / (2 * sz);
      const n = 1 / Math.hypot(gx, 1, gz);
      const lit = (-gx * light.x + light.y - gz * light.z) * n - light.y; // 0 on level ground
      const k = (j * cols + i) * 4;
      const shadow = lit < 0;
      image.data[k] = image.data[k + 1] = image.data[k + 2] = shadow ? 0 : 255;
      image.data[k + 3] = Math.min(150, Math.abs(lit) * (shadow ? 420 : 260));
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
