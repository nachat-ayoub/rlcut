# rlcut — Codex handoff

Updated: 2026-10-11. This file records context and the next direction; no application
code was changed as part of this handoff.

## Next priority: fix visible playback FPS

**The user reports that preview playback currently feels like approximately
10 FPS. This is an observation, not an instrumented measurement. The minimum
acceptable result is sustained 30 FPS of visibly changing, composed video.**

The next session should investigate and improve playback performance on the
user's Ubuntu laptop. Do not declare success based on decoder FPS, timer frequency,
render-call counts, or an isolated headless test. Measure distinct video frames
actually presented in the running desktop editor, including after packaging.
Aim for 60 FPS where practical, but 30 FPS is the minimum requirement for the
representative recording and normal template settings.

The user wants immediate, smooth editing. Moving/resizing gameplay or boost,
changing crop/mask/feather, background blur/brightness, and scrubbing should remain
interactive. Do not replace this experience with a full-clip render that must
finish after every edit. Preserve audio synchronization, accurate seeks, timeline
cuts, and export quality. Investigate the bottleneck before another architecture
rewrite; if the frame transport/render path must change, keep the native media
clock and bounded queues.

## Current code version and status

- Code baseline: `4423b75` — **Fix native timeline arguments and initial playhead**.
- Previous architecture commit: `097733a` — **Add native playback and import progress**.
- Both were pushed to `origin/main` in `nachat-ayoub/rlcut`.
- The import argument error was `unknown field id, expected start or end`.
  UI segments contain IDs for selection/history; Rust's strict `Segment` schema
  accepts only `start` and `end`. `src/lib/native.ts` now strips UI IDs at the IPC
  boundary for playback open/control and export. Keep IDs in the UI state.
- Imported clips now start paused at **0 seconds**, rather than halfway through.
- The user acknowledged that fix, but then reported poor playback FPS.
  Treat performance as unresolved; smooth end-to-end playback is not established.
- Linux artifacts were rebuilt into `dist/rlcut.AppImage` and `dist/rlcut`.
  `dist/` is ignored and is not available from GitHub after a fresh clone.

## Current architecture

This is a Rust/Tauri 2 desktop app with React 19/TypeScript controls and a live
canvas/WebGL compositor. It makes Rocket League portrait shorts with a blurred
background, sharp gameplay, and a separate cropped boost HUD.

```text
Original recording
  → one cached FFmpeg SDR/H.264/AAC preparation
  → native GStreamer playbin: decoding + audio sink + media clock
  → bounded RGBA appsink queue
  → Rust worker / latest frame
  → Tauri binary IPC (pull, one request in flight)
  → source canvas / live GPU or software composition
  → visible edited result
```

- `src-tauri/native/player.c`: GStreamer bridge. `playbin` owns audio/decoding;
  the video sink converts/scales to RGBA and uses `appsink` with `sync=true`,
  `max-buffers=1`, `drop=true`. Stable public appsink functions are declared in
  this bridge; `build.rs` compiles it against GStreamer core headers and links
  the versioned appsink runtime library.
- `src-tauri/src/video/player.rs`: pipeline lifetime, play/pause, accurate seek,
  kept-segment handling, frame cache, sequence IDs, errors and end state.
- `src-tauri/src/commands.rs`: owns a native worker polling every 8 ms;
  session-scoped `playback_open/control/frame/close` commands. Native operations
  use a shared player mutex. Frame IPC is async and executes blocking work away
  from the UI thread. Captured frames have a maximum dimension of 768 pixels.
- `src/lib/native-playback.ts`: serializes controls, polls binary frame packets,
  converts RGBA to `ImageData`, writes the source canvas, and invokes composition.
  Polling targets 60 Hz, but awaits IPC and synchronous drawing before scheduling
  the next request. That target does **not** establish actual 60 FPS.
- `src/components/Composition.tsx`: source session lifetime is separate from scene
  edits and compositor replacement. There is **no hidden HTML video decoder**.
  Paused snapshots supply the boost crop dialog. Edits redraw the cached source.
- `src/lib/gpu-compositor.ts`: uploads the source canvas as a texture; uses GPU
  blur passes, gameplay transform, crop and circle/ellipse/feather masks.
- `src/lib/compositor.ts`: common geometry, GPU selection, fallback and software
  renderer. Software playing preview is 360 pixels wide; paused/GPU preview is
  larger. The current GPU fallback is aggressive: after the first frame, a draw
  taking more than 20 ms can switch to CPU. Review this policy with measurements.
- `src/lib/timeline.ts`: maps between source time and edited time. Keep this
  consistent with native playback and full-quality export.
- `src-tauri/src/video/decoder.rs`: prepares/caches one seekable SDR source,
  tone-maps HDR, supports cancellation, cleans partial output, and reports FFmpeg
  processed duration. Import UI shows actual percentage, elapsed time, approximate
  remaining time, and Cancel. Probing/opening use an activity indicator.
- Export uses the original recording and the existing FFmpeg geometry/filter
  pipeline. Preview resolution is adaptive; export remains full output resolution
  with the existing quality settings. Preserve the previous HDR/color fixes.

See also [editor architecture](docs/EDITOR_ARCHITECTURE.md).

## Performance investigation direction — hypotheses, not findings

Start by measuring decode/queue rate, IPC latency and throughput, frame copies,
`putImageData`, GPU upload/composition cost, CPU fallback, and React updates.
Compare the actual GPU renderer/driver and GStreamer plugins in native development
and in the AppImage. The school PC and the laptop may behave differently.

A 768 × 432 RGBA frame contains about 1.33 MB. Transferring 60 such frames each
second involves about 80 MB/s of payload before copies. The current path includes
native allocation/copy, IPC transport, `ImageData`/canvas upload, and composition;
these are plausible costs, not yet identified as the cause. Inspect rather than
assuming decoding is slow. Also check timer scheduling, mutex contention, shader
warm-up, the fallback threshold, and unnecessary paused work/snapshots.

Existing `canvas.compositionStats` records render calls and draw costs. It excludes
some upstream costs and can count repeated frames or resize/edit redraws. Use
native sequence IDs and end-to-end presentation timing to distinguish actual
moving-video FPS from render frequency. Avoid hiding the issue through a counter
that says 60 while the picture changes at 10 FPS.

If transport copies are the bottleneck, consider a more direct native render
surface or efficient frame/texture transport. Validate the chosen route on the
laptop and packaged app before claiming the playback problem is solved.

## Validation performed and limits

The user had only about half an hour and explicitly allowed skipping the full
suite for the native-engine rewrite; they intended to test it manually.

- Rust/frontend compilation and lint completed during the rewrite.
- A short native C decoder smoke check on the provided recording produced a
  paused frame after a seek and 123 advancing decoded frames over about two
  seconds. This did **not** test Tauri IPC, visible composition, or real speakers.
- That decoder-only check missed the segment-ID IPC mismatch. A focused frontend
  regression now checks range serialization for open, control and export without
  mutating UI IDs; it passed.
- The latest AppImage build succeeded. The full native-editor acceptance suite
  was not run. Old headless browser-player results do not validate this engine.
- Existing frontend geometry/export regression coverage and compositor reference
  tools remain available. The retired browser video/loopback playback path and
  its integration harness were removed.

For the FPS work, prioritize a short real-app reproduction and useful measurements.
Use checks appropriate to the actual change; avoid another hour of broad testing
while the user is waiting. Check playback, pause/resume, seek, live edits, cuts,
reimport and audio timing in the running editor before packaging the final fix.

## Reproduction recording and environment

The recording used in this session was:

`Rocket League_20261009234357.mp4` — approximately 23.36 s, 1280 × 720,
59.94 FPS, with audio and PQ HDR metadata.

School-machine path:
`/home/anachat/goinfre/trash/Rocket League_20261009234357.mp4`.
An ignored local copy also existed under `.checks/original-gameplay.mp4`.
Neither is committed. Bring the recording to the laptop separately, or choose a
representative similar recording and record its properties in the measurements.

The previous checkout was `/goinfre/anachat/rlcut` on a 42/1337 school PC without
sudo. Docker was used for build/development dependencies, **not to run the
standalone exported app**. The scripts detect school hostnames and goinfre paths;
normal Ubuntu laptop checkouts use the native environment. `RLCUT_ENV=native`
overrides detection if needed. Do not assume school paths/caches exist on the laptop.

For laptop setup, follow [RUNNING.md](RUNNING.md). Native prerequisites include
current Rust, Node 22.12+, GTK/WebKit development libraries, FFmpeg, GStreamer
core development headers, and base/good/libav plugins. Typical commands after setup:

```sh
git pull --ff-only
RLCUT_ENV=native npm run desktop
RLCUT_ENV=native bash scripts/run.sh build --bundles appimage
```

The build exports `dist/rlcut.AppImage` and the complete single-file `dist/rlcut`.
The latter handles extraction on Linux without requiring FUSE. Copy/run the app
without neighboring FFmpeg files or Docker. Required tools/plugins are bundled;
AppImage extraction into temporary storage is normal runtime behavior.

**Native engine packaging currently supports Linux only.** Windows/macOS native
runtime integration and packaging are pending; the old browser fallback was
removed. Do not publish the earlier Windows installer as if native playback there
were supported. Cross-platform support remains an outstanding project requirement.

## User priorities to preserve

- Fast, smooth playback of the edited result; minimum 30 visible FPS.
- Immediate layer edits, without a full-clip preparation after each change.
- Clear, honest loading progress and cancellation; import playhead starts at zero.
- Crop/resize from all corners, zoom, deselection outside the video, center-based
  position controls, and snapping/alignment.
- Boost dialog contains the relevant boost configuration and cutout preview.
- Consistent source/preview/export colors and unchanged export quality.
- Existing branding: `public/branding/logo.png`, `assets/branding/icon.png`,
  generated platform icons under `src-tauri/icons/`.
- Self-contained Linux executable/AppImage, school Docker build support and native
  laptop development. Push completed changes with a short informative commit.

Suggested next-session request: "Read CODEX_HANDOFF.md. Measure and fix the visible
preview FPS to at least 30 on my Ubuntu laptop while retaining immediate editing,
then rebuild the AppImage and report the observed end-to-end performance."
