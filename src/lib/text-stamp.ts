import type { TextOverlay } from '../types';
import { invoke } from './native';

const loadedFaces = new Map<string, Promise<void>>();

// Use WebKit's font shaping/variation selection, just like the editor. FFmpeg's
// drawtext opens variable Google fonts at their default axis values instead.
export async function stampText(text: TextOverlay, width: number, height: number, quality: number): Promise<{ renderedPath: string; renderedX: number; renderedY: number }> {
  const variants: Array<[string, string, string]> = [
    [text.fontPath, '400', 'normal'], [text.fontBoldPath, '700', 'normal'],
    [text.fontBlackPath, '900', 'normal'], [text.fontItalicPath, '400', 'italic'],
    [text.fontBoldItalicPath, '700', 'italic'], [text.fontBlackItalicPath, '900', 'italic'],
  ];
  await Promise.all(variants.filter(([path]) => path).map(([path, weight, style]) => {
    const key = JSON.stringify([text.fontFamily, path, weight, style]);
    let loading = loadedFaces.get(key);
    if (!loading) {
      // Export text must not depend on WebKit's asset URL loader. After a long
      // export is canceled that loader can reject a perfectly valid local font
      // with the generic "A network error occurred" message. Read the local
      // bytes through Tauri and give FontFace an in-memory source instead.
      loading = invoke<number[]>('load_font_bytes', { path })
        .then(bytes => new FontFace(text.fontFamily, new Uint8Array(bytes).buffer, { weight, style }).load())
        .then(loaded => { document.fonts.add(loaded); })
        .catch(error => { loadedFaces.delete(key); throw error; });
      loadedFaces.set(key, loading);
    }
    return loading;
  }));
  const factor = width / quality;
  const size = text.fontSize * factor;
  const font = `${text.italic ? 'italic' : 'normal'} ${text.fontWeight} ${size}px ${JSON.stringify(text.fontFamily)}`;
  await document.fonts.load(font, text.text || ' ');
  await document.fonts.ready;
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', width: `${width}px`, height: `${height}px`, visibility: 'hidden', pointerEvents: 'none' });
  const box = document.createElement('div');
  box.className = 'composition-text';
  Object.assign(box.style, {
    left: '0', top: '0', width: `${text.boxWidth * 100}%`,
    fontFamily: text.fontFamily, fontSize: `${size}px`, fontWeight: String(text.fontWeight),
    fontStyle: text.italic ? 'italic' : 'normal', letterSpacing: `${text.letterSpacing * factor}px`,
    lineHeight: String(text.lineHeight), textAlign: text.align,
  });
  const span = document.createElement('span');
  span.textContent = text.text; box.append(span); host.append(box); document.body.append(host);
  try {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot render export text');
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    const metrics = ctx.measureText('Mg');
    const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent;
    const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent;
    const bounds = box.getBoundingClientRect();
    const node = span.firstChild;
    const range = document.createRange();
    const lines: Array<{ text: string; x: number; y: number }> = [];
    if (node) {
      let offset = 0, first = 0, top: number | undefined;
      const add = (end: number) => {
        if (end <= first) return;
        range.setStart(node, first); range.setEnd(node, end);
        const rect = range.getBoundingClientRect();
        lines.push({
          text: text.text.slice(first, end).replace(/\n/g, ''), x: rect.left - bounds.left - bounds.width / 2,
          y: rect.top - bounds.top - bounds.height / 2 + (rect.height - ascent - descent) / 2 + ascent
        });
      };
      for (const char of text.text) {
        range.setStart(node, offset); range.setEnd(node, offset + char.length);
        const rect = range.getBoundingClientRect();
        if (char === '\n') { add(offset); first = offset + 1; top = undefined; }
        else if (top !== undefined && Math.abs(rect.top - top) > 1) { add(offset); first = offset; top = rect.top; }
        else top = rect.top;
        offset += char.length;
      }
      add(offset);
    }
    ctx.translate(width * text.x, height * text.y);
    ctx.rotate(text.rotation * Math.PI / 180); ctx.scale(text.scale, text.scale);
    ctx.globalAlpha = 1;
    if (text.backgroundOpacity > 0) {
      ctx.globalAlpha = text.backgroundOpacity; ctx.fillStyle = text.backgroundColor;
      ctx.fillRect(-bounds.width / 2, -bounds.height / 2, bounds.width, bounds.height); ctx.globalAlpha = 1;
    }
    ctx.lineJoin = 'round';
    ctx.lineWidth = text.strokeWidth * factor * (text.strokePosition === 'outside' ? 2 : text.strokePosition === 'inside' ? .5 : 1);
    const letterSpacing = text.letterSpacing * factor;
    const nativeSpacing = Reflect.has(ctx, 'letterSpacing');
    if (nativeSpacing) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${letterSpacing}px`;
    const draw = (value: string, x: number, y: number, stroke: boolean, target = ctx) => {
      if (nativeSpacing || letterSpacing === 0) {
        if (stroke) target.strokeText(value, x, y); else target.fillText(value, x, y);
      } else {
        let advance = 0;
        // Legacy WebKit lacks Canvas letterSpacing. Preserve shaped advances.
        const chars = Array.from(value);
        for (let i = 0; i < chars.length; i++) {
          if (stroke) target.strokeText(chars[i], x + advance, y); else target.fillText(chars[i], x + advance, y);
          advance = target.measureText(chars.slice(0, i + 1).join('')).width + (i + 1) * letterSpacing;
        }
      }
    };
    const paint = (color: string, strokeColor: string, dx = 0, dy = 0, target = ctx) => {
      target.fillStyle = color; target.strokeStyle = strokeColor;
      for (const line of lines) {
        if (target.lineWidth > 0 && text.strokeWidth > 0 && text.strokePosition === 'outside') draw(line.text, line.x + dx, line.y + dy, true, target);
        draw(line.text, line.x + dx, line.y + dy, false, target);
        if (target.lineWidth > 0 && text.strokeWidth > 0 && text.strokePosition !== 'outside') draw(line.text, line.x + dx, line.y + dy, true, target);
        if (text.underline) {
          const length = target.measureText(line.text).width + (nativeSpacing ? 0 : Math.max(0, Array.from(line.text).length - 1) * letterSpacing);
          target.fillRect(line.x + dx, line.y + dy + size * .08, length, Math.max(1, size * .055));
        }
      }
    };
    if (text.shadowEnabled) {
      if (text.shadowBlur <= 0) paint(text.shadowColor, text.shadowColor, text.shadowX * factor, text.shadowY * factor);
      else {
        const shadow = document.createElement('canvas'); shadow.width = width; shadow.height = height;
        const shadowCtx = shadow.getContext('2d');
        if (!shadowCtx) throw new Error('Cannot render text shadow');
        shadowCtx.setTransform(ctx.getTransform()); shadowCtx.font = ctx.font;
        shadowCtx.textBaseline = ctx.textBaseline; shadowCtx.lineWidth = ctx.lineWidth; shadowCtx.lineJoin = ctx.lineJoin;
        if (nativeSpacing) shadowCtx.letterSpacing = ctx.letterSpacing;
        paint(text.shadowColor, text.shadowColor, text.shadowX * factor, text.shadowY * factor, shadowCtx);
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.shadowColor = text.shadowColor; ctx.shadowBlur = text.shadowBlur * factor * text.scale * 2;
        // Move the source outside the canvas; retain only its blurred shadow.
        ctx.shadowOffsetX = width * 2; ctx.drawImage(shadow, -width * 2, 0);
        ctx.restore(); shadow.width = shadow.height = 0;
      }
    }
    paint(text.color, text.strokeColor);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'destination-in'; ctx.globalAlpha = text.opacity;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, width, height);
    // Crop transparent margins so FFmpeg retains only the title pixels rather
    // than a full-resolution frame for every text clip on a low-memory machine.
    let left = width, top = height, right = -1, bottom = -1;
    {
      const rgba = ctx.getImageData(0, 0, width, height).data;
      for (let i = 3; i < rgba.length; i += 4) {
        if (rgba[i] === 0) continue;
        const pixel = (i - 3) / 4, x = pixel % width, y = Math.floor(pixel / width);
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    if (right < left) { left = top = right = bottom = 0; }
    const cropped = document.createElement('canvas');
    cropped.width = right - left + 1; cropped.height = bottom - top + 1;
    const cropCtx = cropped.getContext('2d');
    if (!cropCtx) throw new Error('Cannot prepare export text image');
    cropCtx.drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    canvas.width = canvas.height = 0;
    const blob = await new Promise<Blob>((resolve, reject) => cropped.toBlob(value => value ? resolve(value) : reject(new Error('Cannot encode export text')), 'image/png'));
    const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
    cropped.width = cropped.height = 0;
    return { renderedPath: await invoke<string>('save_text_stamp', { bytes }), renderedX: left, renderedY: top };
  } finally { host.remove(); }
}
