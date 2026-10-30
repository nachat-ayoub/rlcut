import '../scripts/register-ts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { classic, copyPreset, clamp, time, duration, filename } = await import('../src/lib/presets.ts');
const { renderToStaticMarkup } = await import('react-dom/server');
const { createElement } = await import('react');
const { Composition } = await import('../src/components/Composition.tsx');
const { Timeline } = await import('../src/components/Timeline.tsx');
const { FlashInspector } = await import('../src/components/FlashInspector.tsx');
const { ProjectHome } = await import('../src/components/ProjectHome.tsx');
const { MusicLibrary } = await import('../src/components/MusicLibrary.tsx');

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
  assert.equal(time(3661.25), '1 h 1 min 1.25 s');
  assert.equal(filename('C:\\videos\\play.mp4'), 'play.mp4');
});
test('preview boundaries preserve gameplay aspect and apply boost scale', () => {
  const p = structuredClone(classic); p.boost.scale = 2;
  const html = renderToStaticMarkup(createElement(Composition, {
    video: { width: 1920, height: 1080 }, preview: { source:'data:image/png;base64,', composed:'data:image/png;base64,' }, preset:p, before:false, guides:true, layer:'boost', setLayer:()=>{}, change:()=>{}, busy:false, importVideo:()=>{}, quality:1080,
  }));
  assert.match(html, /width:100%;height:31\.640625%/);
  assert.match(html, /width:24%;height:13\.5%/);
  assert.doesNotMatch(html, /Resize gameplay/);
  assert.match(html, /Resize boost/);
});
test('empty workspace has an actionable import control', () => {
  const html = renderToStaticMarkup(createElement(Composition, {video:null, importVideo:()=>{}}));
  assert.match(html, /Import gameplay/);
  assert.match(html, /MP4/);
});
test('desktop updates expose check, verified download, progress and install actions', async () => {
  const [app, commands] = await Promise.all([readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'), readFile(new URL('../src-tauri/src/commands.rs', import.meta.url), 'utf8')]);
  for (const action of ['check_update','download_update','update_progress','install_update']) {
    assert.match(app, new RegExp(`['"]${action}['"]`));
    assert.match(commands, new RegExp(`fn ${action}`));
  }
  assert.match(commands, /SHA256SUMS/);
  assert.match(commands, /rlcut-Windows-x86_64-portable\.zip/);
  assert.match(commands, /rlcut-Linux-x86_64\.AppImage/);
});
test('timeline exposes video/music lanes, edge trims, zoom and clip volume', () => {
  const html = renderToStaticMarkup(createElement(Timeline, {
    duration: 20, sourceDurations:[20], timestamp: 2, segments: [{id:'a',start:0,end:8,volume:.5,colorFix:0}], music:null, markers:{video:[],music:[]}, texts:[], textTracks:[], selectedTextId:null, playing:false, playbackReady:true,
    canUndo:false, canRedo:false, onSeek:()=>{}, onPlay:()=>{}, onEdit:()=>{}, onTextEdit:()=>{}, onTextSplit:()=>{}, onTextDelete:()=>{}, onTextSelect:()=>{}, onAddText:()=>{}, onAddTextTrack:()=>{}, onDeleteTextTrack:()=>{}, onMarker:()=>{}, onSelectionChange:()=>{}, onUndo:()=>{}, onRedo:()=>{}, onImportVideo:()=>{}, onImportMusic:()=>{},
  }));
  for (const label of ['Append video','Add music','Timeline zoom','Show selected clip volume','Trim or extend video clip from left','Trim or extend video clip from right']) assert.match(html, new RegExp(label));
});

test('timeline effects expose fast placement and contextual controls', () => {
  const effect = { id:'fx', kind:'darkGray', timing:'duration', scope:'all', time:1, duration:4, intensity:.82, color:'#ffffff', easing:'easeOut' };
  const inspector = renderToStaticMarkup(createElement(FlashInspector, { value:effect, onChange:()=>{}, onDelete:()=>{}, onPreview:()=>{} }));
  for (const label of ['Black &amp; white','Impact flash','Raggeo','Timeline range','Whole clip','Resize the effect directly on the timeline','Layer placement','Top · include text','Remove effect']) assert.match(inspector, new RegExp(label));
});

test('music library exposes native YouTube search and saved views', () => {
  const html = renderToStaticMarkup(createElement(MusicLibrary, {favorites:[],installed:[],onFavoritesChange:()=>{},onInstalledChange:()=>{},onClose:()=>{},onChooseLocal:async()=>null,onUseInstalled:async()=>false}));
  for (const label of ['Find your soundtrack','Search songs, edits, phonk, creators','Choose local audio','Favorites','Downloaded','Search YouTube']) assert.match(html, new RegExp(label));
  assert.doesNotMatch(html, /API key/);
});

test('black-and-white preview filters rendered video without backdrop filters', () => {
  const html = renderToStaticMarkup(createElement(Composition, {
    video: { width:1920, height:1080 }, playbackPath:'', proxyPreparing:false, segments:[{id:'a',start:0,end:2,volume:1,colorFix:0}], effects:[{id:'gray',kind:'darkGray',timing:'duration',scope:'all',time:0,duration:1,intensity:1,color:'#fff',easing:'ease'}], texts:[], preview:null, preset:classic, before:false, guides:false, layer:null, setLayer:()=>{}, change:()=>{}, importVideo:()=>{}, quality:1080, playing:false, timestamp:.5, onTimestamp:()=>{}, onPlayingChange:()=>{}, onTextSelect:()=>{}, onTextChange:()=>{},
  }));
  assert.match(html, /filter:grayscale\(1\) brightness\(0\.6\) contrast\(1\.35\)/);
  assert.doesNotMatch(html, /backdrop-filter/);
});

test('raggeo grading and gameplay separation shadow render in the live composition', () => {
  const html = renderToStaticMarkup(createElement(Composition, {
    video: { width:1920, height:1080 }, playbackPath:'', proxyPreparing:false, segments:[{id:'a',start:0,end:2,volume:1,colorFix:0}], effects:[{id:'raggeo',kind:'raggeo',timing:'duration',scope:'video',time:0,duration:1,intensity:1,color:'#fff',easing:'ease'}], texts:[], preview:null, preset:{...classic,gameplay:{...classic.gameplay,shadow:true}}, before:false, guides:false, layer:null, setLayer:()=>{}, change:()=>{}, importVideo:()=>{}, quality:1080, playing:false, timestamp:.5, onTimestamp:()=>{}, onPlayingChange:()=>{}, onTextSelect:()=>{}, onTextChange:()=>{},
  }));
  assert.match(html, /brightness\(0\.88\) contrast\(1\.32\) saturate\(1\.78\) hue-rotate\(-8deg\)/);
  assert.match(html, /gameplay-frame-shadow/);
});

test('project cards expose a duplicate action', () => {
  const project = {version:1,id:'p',name:'Edit',createdAt:1,updatedAt:1,videoPaths:[],segments:[],music:null,markers:{video:[],music:[]},preset:classic,quality:1080,fps:60,outputFolder:'',outputName:'edit.mp4'};
  const html = renderToStaticMarkup(createElement(ProjectHome, {projects:[project],busy:false,onDismissAlert:()=>{},onNew:()=>{},onOpen:()=>{},onDelete:()=>{},onDuplicate:()=>{},onImport:()=>{},onExport:()=>{},onRename:()=>{},onSettings:()=>{}}));
  assert.match(html, /aria-label="Duplicate Edit"/);
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

const { resizeCrop, snapAxis, anchor } = await import('../src/lib/geometry.ts');
test('durations use readable units with sane rounding', () => {
  assert.equal(duration(3661.25), '1 h 1 min 1 s');
  assert.equal(duration(24.82), '25 s');
  assert.equal(duration(81.31), '1 min 21 s');
  assert.equal(duration(59.8), '1 min 0 s');
});
test('all crop corners resize while preserving the opposite corner and source bounds', () => {
  const r = { x: .2, y: .3, width: .4, height: .4 };
  for (const c of ['nw', 'ne', 'sw', 'se']) {
    const n = resizeCrop(r, c, .1, .1);
    assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.width <= 1 && n.y + n.height <= 1);
    assert.ok(Math.abs((c.includes('w') ? n.x + n.width : n.x) - (c.includes('w') ? .6 : .2)) < 1e-10);
    assert.ok(Math.abs((c.includes('n') ? n.y + n.height : n.y) - (c.includes('n') ? .7 : .3)) < 1e-10);
    const bounded = resizeCrop(r, c, -5, 5);
    assert.ok(bounded.width >= .00199 && bounded.height >= .00199);
  }
});
test('drag snaps to center and sides independently, with matching alignment anchors', () => {
  assert.deepEqual(snapAxis(.493, .2, .01), { position: .5, guide: .5 });
  assert.deepEqual(snapAxis(.105, .2, .01), { position: .1, guide: 0 });
  assert.deepEqual(snapAxis(.895, .2, .01), { position: .9, guide: 1 });
  assert.equal(snapAxis(.4, .2, .01).guide, null);
  assert.equal(anchor(.2, 0), .1);
  assert.equal(anchor(.2, .5), .5);
  assert.equal(anchor(.2, 1), .9);
});
test('deselected composition has no labels or resize boxes', () => {
  const html = renderToStaticMarkup(createElement(Composition, { video: {width:1920,height:1080}, preview:{source:'x',composed:'y'}, preset:classic, before:false,guides:true,layer:null,setLayer:()=>{},change:()=>{},quality:1080 }));
  assert.doesNotMatch(html, /resize-handle/);
  assert.doesNotMatch(html, /GAMEPLAY|BOOST/);
});
const { CropEditor } = await import('../src/components/CropEditor.tsx');
test('boost dialog keeps the focused cutout workflow visible without scrolling', () => {
  const html = renderToStaticMarkup(createElement(CropEditor, {source:'x',preset:classic,aspect:16/9,onApply:()=>{},onCancel:()=>{}}));
  for (const label of ['Source zoom','Boost cutout result','Visible','Shape','Soft edge','New selection','Apply cutout']) assert.ok(html.includes(label), label);
  assert.equal((html.match(/Resize boost crop/g) || []).length, 4);
});

const { Dropdown } = await import('../src/components/Dropdown.tsx');
test('dropdown uses the app combobox rather than native select chrome', () => {
  const html = renderToStaticMarkup(createElement(Dropdown, { label:'Default FPS', value:60, options:[{value:30,label:'30 FPS'},{value:60,label:'60 FPS'}], onChange:()=>{} }));
  assert.match(html, /role="combobox"/);
  assert.match(html, /aria-label="Default FPS"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /60 FPS/);
  assert.doesNotMatch(html, /<select|<option/);
});

test('preview geometry agrees with native export fixtures', async t => {
  const { readFile } = await import('node:fs/promises');
  const { scene } = await import('../src/lib/compositor.ts');
  let raw;
  try { raw = await readFile(new URL('../.checks/scene-fixtures.json', import.meta.url), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') { t.skip('Generate scene fixtures with the native geometry example'); return; } throw e; }
  const fixtures = JSON.parse(raw);
  for (const item of fixtures) assert.deepEqual(scene(item.video, item.preset, item.scene.width, item.scene.height), item.scene);
});

test('edited clock seeks across cuts and never lands inside deleted source intervals', async () => {
  const { editedToSource, sourceToEdited, editedDuration, trimBounds } = await import('../src/lib/timeline.ts');
  const segments = [{start:2,end:4}, {start:7,end:9}];
  assert.equal(editedDuration(segments),4);
  assert.equal(editedToSource(segments,0),2);
  assert.equal(editedToSource(segments,2),7);
  assert.equal(editedToSource(segments,2.5),7.5);
  assert.equal(editedToSource(segments,99),9);
  assert.equal(sourceToEdited(segments,5),2);
  assert.equal(sourceToEdited(segments,8),3);
  assert.deepEqual(trimBounds(segments, 0, 12), { start: { min: 0, max: 3.95 }, end: { min: 2.05, max: 12 } });
  assert.deepEqual(trimBounds(segments, 1, 12), { start: { min: 0, max: 8.95 }, end: { min: 7.05, max: 12 } });
});


test('native commands send timeline ranges without editor IDs', async () => {
  const previous = globalThis.window;
  const calls = [];
  globalThis.window = { __TAURI__: { core: { invoke: async (command, args) => { calls.push({ command, args }); } } } };
  const segments = [{ id: 'editor-only-id', start: 0, end: 12 }];
  try {
    const { invoke } = await import('../src/lib/native.ts');
    for (const command of ['playback_open', 'playback_control', 'start_export']) await invoke(command, { session: 7, segments });
    for (const call of calls) {
      assert.deepEqual(call.args.segments, [{ start: 0, end: 12, volume: 1, color_fix: 0 }]);
      assert.equal(call.args.session, 7);
    }
    assert.equal(segments[0].id, 'editor-only-id');
  } finally { globalThis.window = previous; }
});
