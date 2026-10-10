import '../scripts/register-ts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { classic, copyPreset, clamp, time, filename } = await import('../src/lib/presets.ts');
const { renderToStaticMarkup } = await import('react-dom/server');
const { createElement } = await import('react');
const { Composition } = await import('../src/components/Composition.tsx');

test('duplicating presets preserves all values and isolates nested edits', () => {
  const original = structuredClone(classic), copy = copyPreset(classic);
  assert.notEqual(copy.id, classic.id);
  assert.deepEqual(copy.boost, classic.boost);
  copy.boost.crop.x = 0.2;
  copy.boost.scale = 2;
  copy.background.blur = 80;
  assert.deepEqual(classic, original);
});
test('positions clamp and timestamps support long recordings', () => {
  assert.equal(clamp(-0.2), 0);
  assert.equal(clamp(1.2), 1);
  assert.equal(time(3661.25), '1:01:01.25');
  assert.equal(filename('C:\\videos\\play.mp4'), 'play.mp4');
});
test('preview boundaries preserve gameplay aspect and apply boost scale', () => {
  const p = structuredClone(classic); p.boost.scale = 2;
  const html = renderToStaticMarkup(createElement(Composition, {
    video: { width: 1920, height: 1080 }, preview: { source:'data:image/png;base64,', composed:'data:image/png;base64,' }, preset:p, before:false, guides:true, layer:'boost', setLayer:()=>{}, change:()=>{}, busy:false, importVideo:()=>{}, quality:1080,
  }));
  assert.match(html, /width:100%;height:31\.640625%/);
  assert.match(html, /width:24%;height:13\.5%/);
  assert.match(html, /Resize gameplay/);
  assert.match(html, /Resize boost/);
});
test('empty workspace has an actionable import control', () => {
  const html = renderToStaticMarkup(createElement(Composition, {video:null, importVideo:()=>{}}));
  assert.match(html, /Import gameplay/);
  assert.match(html, /MP4/);
});

test('native drag/drop uses the Tauri 2 webview API and only imports dropped paths', async () => {
  const old = globalThis.window;
  const received = [];
  let stopped = false;
  globalThis.window = { __TAURI__: {
    webview: { getCurrentWebview: () => ({ onDragDropEvent: async handler => {
      handler({ payload: { type: 'enter', paths: ['/hover.mp4'] } });
      handler({ payload: { type: 'drop', paths: ['/actual video.mp4'] } });
      return () => { stopped = true; };
    } }) },
  } };
  try {
    const { onDrop } = await import('../src/lib/native.ts');
    const stop = await onDrop(paths => received.push(...paths));
    assert.deepEqual(received, ['/actual video.mp4']);
    stop();
    assert.equal(stopped, true);
  } finally { globalThis.window = old; }
});

test('absent desktop runtime produces an actionable error', async () => {
  const old = globalThis.window;
  globalThis.window = {};
  try {
    const { invoke } = await import('../src/lib/native.ts');
    await assert.rejects(invoke('import_video', { path: '/video.mp4' }), /npm run desktop/);
  } finally { globalThis.window = old; }
});
