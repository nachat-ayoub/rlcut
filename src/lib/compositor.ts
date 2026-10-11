import type { Preset, Video } from '../types';
import { GPUCompositor } from './gpu-compositor';
export type PixelRect = { x: number; y: number; width: number; height: number };
export type Scene = { width: number; height: number; background: PixelRect; gameplay: PixelRect; boost: PixelRect; crop: PixelRect };
const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
// This is the export geometry contract: source pixels for crop, output pixels
// for layers, even dimensions, and center-based positions. Cross-language
// conformance fixtures exercise it against Rust's geometry() implementation.
export function scene(video: Pick<Video, 'width' | 'height'>, preset: Preset, width: number, height: number): Scene {
  const sw = video.width, sh = video.height;
  const cover = Math.max(width / sw, height / sh) * preset.background.scale;
  const bw = Math.ceil(sw * cover / 2) * 2, bh = Math.ceil(sh * cover / 2) * 2;
  const gw = even(width * preset.gameplay.scale), gh = even(gw * sh / sw);
  const b = preset.boost, ow = even(width * b.width * b.scale), oh = even(height * b.height * b.scale);
  const cx = Math.floor(sw * b.crop.x / 2) * 2, cy = Math.floor(sh * b.crop.y / 2) * 2;
  return {
    width, height,
    background: { width: bw, height: bh, x: Math.round((bw - width) * preset.background.x), y: Math.round((bh - height) * preset.background.y) },
    gameplay: { width: gw, height: gh, x: roundSigned(width * preset.gameplay.x - gw / 2), y: roundSigned(height * preset.gameplay.y - gh / 2) },
    boost: { width: ow, height: oh, x: roundSigned(width * b.x - ow / 2), y: roundSigned(height * b.y - oh / 2) },
    crop: { x: cx, y: cy, width: Math.min(even(sw * b.crop.width), Math.floor((sw - cx) / 2) * 2), height: Math.min(even(sh * b.crop.height), Math.floor((sh - cy) / 2) * 2) },
  };
}
// Rust rounds half away from zero; JS rounds negative halves toward zero.
const roundSigned = (n: number) => { const rounded = Math.round(Math.abs(n)); return rounded === 0 ? 0 : Math.sign(n) * rounded; };
export function blurRadii(sigma: number): number[] {
  if (sigma <= 0) return [0, 0, 0];
  let lower = Math.floor(Math.sqrt(4 * sigma * sigma + 1));
  if (lower % 2 === 0) lower--;
  const upper = lower + 2;
  const count = Math.round((12 * sigma * sigma - 3 * lower * lower - 12 * lower - 9) / (-4 * lower - 4));
  return Array.from({ length: 3 }, (_, i) => ((i < count ? lower : upper) - 1) / 2);
}
// Three separable box passes approximate a Gaussian in O(pixels), independent
// of blur radius. Only the small background surface is read back; foreground
// and HUD stay sharp and are drawn by the browser's native canvas renderer.
function box(input: Uint8ClampedArray, output: Uint8ClampedArray, w: number, h: number, radius: number, horizontal: boolean) {
  const length = horizontal ? w : h, lines = horizontal ? h : w;
  const stride = horizontal ? 4 : w * 4, lineStride = horizontal ? w * 4 : 4;
  const diameter = radius * 2 + 1;
  for (let line = 0; line < lines; line++) {
    for (let c = 0; c < 3; c++) {
      const base = line * lineStride + c;
      let sum = 0;
      for (let i = -radius; i <= radius; i++) sum += input[base + Math.min(length - 1, Math.max(0, i)) * stride];
      for (let i = 0; i < length; i++) {
        output[base + i * stride] = sum / diameter;
        sum += input[base + Math.min(length - 1, i + radius + 1) * stride] - input[base + Math.max(0, i - radius) * stride];
      }
    }
  }
  for (let i = 3; i < output.length; i += 4) output[i] = 255;
}
class CPUCompositor {
  private ctx: CanvasRenderingContext2D;
  private background = document.createElement('canvas');
  private hud = document.createElement('canvas');
  private frame = document.createElement('canvas');
  private scratch = new Uint8ClampedArray(0);
  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('The editor could not create its composition canvas.');
    this.ctx = ctx;
  }
  draw(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, video: Pick<Video, 'width' | 'height'>, preset: Preset, quality: number, before = false, playing = false) {
    const width = playing ? 360 : Math.min(720, Math.max(480, Math.round((this.canvas.clientWidth || 480) / 2) * 2));
    const height = before ? even(width * video.height / video.width) : even(width * (quality === 480 ? 854 / 480 : 16 / 9));
    if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
    // Capture once: all layers see precisely the same decoded frame, and
    // WebKit does not need to download the video texture three separate times.
    if (this.frame.width !== sourceWidth || this.frame.height !== sourceHeight) { this.frame.width = sourceWidth; this.frame.height = sourceHeight; }
    this.frame.getContext('2d', { alpha: false })!.drawImage(source, 0, 0);
    source = this.frame;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = playing ? 'low' : 'high';
    if (before) { ctx.drawImage(source, 0, 0, width, height); return; }
    const plan = scene(video, preset, width, height), bg = plan.background;
    // A low-resolution blurred layer gives predictable performance on school
    // GPUs and on software-rendered desktops, without Canvas.filter support.
    const ratio = preset.background.blur > 0 ? Math.min(1, (playing ? 72 : 96) / width) : 1;
    const bw = Math.max(2, Math.round(width * ratio)), bh = Math.max(2, Math.round(height * ratio));
    if (this.background.width !== bw || this.background.height !== bh) { this.background.width = bw; this.background.height = bh; }
    const back = this.background.getContext('2d', { willReadFrequently: true })!;
    back.drawImage(source, bg.x / bg.width * sourceWidth, bg.y / bg.height * sourceHeight, width / bg.width * sourceWidth, height / bg.height * sourceHeight, 0, 0, bw, bh);
    if (preset.background.blur > 0 || preset.background.brightness !== 0) {
      const image = back.getImageData(0, 0, bw, bh);
      if (this.scratch.length !== image.data.length) this.scratch = new Uint8ClampedArray(image.data.length);
      for (const radius of blurRadii(preset.background.blur * bw / 1080)) {
        if (radius === 0) continue;
        box(image.data, this.scratch, bw, bh, radius, true);
        box(this.scratch, image.data, bw, bh, radius, false);
      }
      // FFmpeg eq adds brightness to limited-range luma before RGB conversion.
      const offset = preset.background.brightness * 255 * 255 / 219;
      for (let i = 0; i < image.data.length; i += 4) { image.data[i] += offset; image.data[i + 1] += offset; image.data[i + 2] += offset; }
      back.putImageData(image, 0, 0);
    }
    ctx.drawImage(this.background, 0, 0, width, height);
    const gp = plan.gameplay;
    ctx.drawImage(source, gp.x, gp.y, gp.width, gp.height);
    if (!preset.boost.enabled) return;
    const b = plan.boost, crop = plan.crop;
    if (crop.width < 2 || crop.height < 2) return;
    if (this.hud.width !== b.width || this.hud.height !== b.height) { this.hud.width = b.width; this.hud.height = b.height; }
    const hud = this.hud.getContext('2d')!;
    hud.clearRect(0, 0, b.width, b.height);
    hud.drawImage(source, crop.x / video.width * sourceWidth, crop.y / video.height * sourceHeight, crop.width / video.width * sourceWidth, crop.height / video.height * sourceHeight, 0, 0, b.width, b.height);
    hud.save(); hud.globalCompositeOperation = 'destination-in';
    const rx = preset.boost.shape === 'circle' ? Math.min(b.width, b.height) / 2 : b.width / 2;
    const ry = preset.boost.shape === 'circle' ? rx : b.height / 2;
    hud.translate(b.width / 2, b.height / 2); hud.scale(rx, ry);
    if (preset.boost.feather > 0) {
      const gradient = hud.createRadialGradient(0, 0, 1 - preset.boost.feather, 0, 0, 1);
      gradient.addColorStop(0, '#fff'); gradient.addColorStop(1, '#ffffff00'); hud.fillStyle = gradient;
      hud.fillRect(-b.width / rx, -b.height / ry, b.width * 2 / rx, b.height * 2 / ry);
    } else { hud.beginPath(); hud.arc(0, 0, 1, 0, Math.PI * 2); hud.fillStyle = '#fff'; hud.fill(); }
    hud.restore();
    ctx.drawImage(this.hud, b.x, b.y);
  }
}

export type CompositionStats = { frames: number; costs: number[]; backend: 'gpu' | 'cpu' };
export type CompositionCanvas = HTMLCanvasElement & { compositionStats?: CompositionStats };
function hardwareGPU() {
  const probe = document.createElement('canvas'); probe.width = 1; probe.height = 1;
  const gl = probe.getContext('webgl');
  if (!gl) return false;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return !/llvmpipe|softpipe|swiftshader|software/i.test(name);
}
export class Compositor {
  private gpu: GPUCompositor | null = null;
  private cpu: CPUCompositor | null = null;
  private stats: CompositionStats;
  private slowFrames = 0;
  constructor(private canvas: HTMLCanvasElement, forceCPU = false, forceGPU = false) {
    const gl = forceCPU || (!forceGPU && !hardwareGPU()) ? null : canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (gl) this.gpu = new GPUCompositor(canvas, gl);
    else this.cpu = new CPUCompositor(canvas);
    this.stats = { frames: 0, costs: [], backend: gl ? 'gpu' : 'cpu' };
    (canvas as CompositionCanvas).compositionStats = this.stats;
  }
  draw(source: CanvasImageSource, sourceWidth: number, sourceHeight: number, video: Pick<Video, 'width' | 'height'>, preset: Preset, quality: number, before = false, playing = false) {
    const start = performance.now();
    if (this.gpu) {
      const width = Math.min(720, Math.max(480, Math.round((this.canvas.clientWidth || 480) / 2) * 2));
      const height = before ? even(width * video.height / video.width) : even(width * (quality === 480 ? 854 / 480 : 16 / 9));
      this.gpu.draw(source, video, preset, scene(video, preset, width, height), before);
    } else this.cpu!.draw(source, sourceWidth, sourceHeight, video, preset, quality, before, playing);
    this.stats.frames++;
    if (this.stats.costs.length === 120) this.stats.costs.shift();
    const cost = performance.now() - start;
    this.stats.costs.push(cost);
    if (this.gpu && this.stats.frames > 1) {
      this.slowFrames = cost > 20 ? this.slowFrames + 1 : 0;
      if (this.slowFrames === 1) this.canvas.dispatchEvent(new Event('compositionfallback'));
    }
  }
  dispose() { this.gpu?.dispose(); }
}
