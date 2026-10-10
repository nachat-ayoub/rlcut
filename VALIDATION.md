# Validation — 2026-10-10

## Standalone AppImage delivered

`dist/rlcut.AppImage` is a 128.45 MiB x86_64 release build made on Ubuntu 22.04.
Docker was used only as the build toolchain. The artifact bundles GTK/WebKit,
FFmpeg/FFprobe 4.4.2 and their libraries; it runs natively, without Docker or sudo.
Use `./dist/rlcut.AppImage --appimage-extract-and-run` on hosts without FUSE.

Verified directly on the school host: the AppImage runtime responds, both bundled
video executables run, and the application resolves its GTK/WebKit libraries from
the bundle with no missing dependencies. The app requires GLIBC 2.34 or newer;
this Ubuntu 22.04 host provides 2.35. All four real video cases also pass with the
bundled FFmpeg version. Export uses compatible CFR arguments and an explicit
video duration to prevent padded audio extending clips on older FFmpeg.

Manual application interaction is left to the user's requested self-test.

## Earlier development checks

Tested on the 1337 school PC `e1r5p2.1337.ma`, using its existing rootless
Docker service. No host system packages were installed. The development image
uses Ubuntu 24.04, Node 22.23.3, Rust 1.99.0 and FFmpeg/FFprobe 6.1.1.

Passed:

- Automatic environment selection: eight cases, including school hostnames,
  goinfre paths, ordinary laptop paths and explicit overrides; Bash syntax checks.
- Frontend formatting, ESLint, six frontend tests, TypeScript and Vite production build.
- npm dependency audit: zero vulnerabilities after updating the two affected
  transitive dependencies with a fresh package cache. The old host npm cache
  contained stale metadata; no dependency overrides were needed.
- Rust formatting and Clippy with desktop features, all targets and warnings denied.
- 21 Rust unit tests, plus a real Rust import/preview/cache/export-worker test.
- Four real FFmpeg integration cases: 480/720/1080 output, 30/60 FPS, audio/silent
  clips, 4K/portrait sources, circular/elliptical masks and decoded-frame similarity.
  These tests execute the production graph and production export arguments.
- Native Tauri development build and startup inside Docker. X11 reports a
  visible 1366×720 app window; WebKit's network and rendering processes run.
- Created `media/rlcut-test.mp4`, a three-second synthetic clip with audio.

The real backend test caught a non-square output sample aspect ratio inherited
from FFmpeg's scaling. The shared graph now resets SAR to 1:1 at its output,
verified by exact re-imported dimensions and FFprobe assertions.

The Docker/native launcher keeps dependency caches separate, supplies the native
libraries/FFmpeg on the school PC, forwards an X11 cookie without privileged mode,
and uses GTK file dialogs rather than requiring the host's desktop portal.

Manual UI interaction (file dialogs, dragging/resizing, preset editing and export
buttons), native laptop execution, Windows/macOS builds and installer smoke tests
remain user/target-machine checks. The successful backend and desktop startup
checks do not certify every UI interaction. See RUNNING.md for the manual test guide.

## Editor and HDR export update (2026-10-10)

Added readable time units, four-corner source/layer resizing, detailed source and composition zoom, transactional boost settings with masked cutout preview, deselection, center-origin position controls, center/edge snapping, and nine-way alignment.

The supplied Rocket League recording is 1280×720, 59.94 FPS, 10-bit YUV, limited-range BT.2020/PQ. Its washed-out export came from treating HDR values as SDR. Source and composition now share linear-light Hable tone mapping into limited-range BT.709; exported files explicitly carry BT.709 color metadata. HUD masking stays in planar YUV with alpha rather than converting the entire composition through RGB.

A two-second 1080p/60 export from the supplied clip took 18.982 seconds with one filter thread and 12.944 seconds with four (31.8% less time on this machine). All 120 decoded video frames were pixel-identical between thread counts. The encoded frame differed from the lossless composition preview by 0.948/255 mean absolute RGB error. The encoder preset and CRF are unchanged. This is a short-sample measurement, not a guaranteed speedup on other hardware. HDR-to-SDR tone mapping necessarily compresses HDR luminance into the SDR display range.

Validation for this update: 11 frontend tests; TypeScript, ESLint, frontend formatting and production build; 21 Rust unit tests plus the real import/cache/export-worker integration test; desktop Clippy with warnings denied; and six real FFmpeg regressions covering SDR, portrait/4K inputs, audio/CFR/duration, plus PQ and HLG color fidelity. All passed. Interactive browser verification was unavailable because this session exposes no browser surface; interaction math and rendered controls were checked through tests.

Rebuilt `dist/rlcut.AppImage` (128.44 MiB, executable). The AppImage runtime and its bundled FFprobe/FFmpeg were tested natively on the 42 host; HDR probing and one-frame tone mapping succeeded without Docker or host FFmpeg installation.
