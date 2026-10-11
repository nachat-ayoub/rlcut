# rlcut

Offline Rocket League vertical clip editor, built with Tauri 2, Rust, React,
TypeScript, Vite, Tailwind CSS, Lucide, FFmpeg and FFprobe. No accounts, uploads,
watermarks or subscriptions.

## Open the app

Linux: double-click the exported `dist/rlcut` executable. The entire app and its video tools are inside this one file; no terminal command, Docker, FFmpeg installation, or FUSE setup is required.

Windows: the installer packaging command produces `dist/rlcut-setup.exe`, including video tools and the offline WebView2 installer. Install once, then launch from the Start menu. Windows builds require a Windows packaging machine; the Windows installer workflow is configured but has not been run in this Linux session.

## Features

Import MP4/MOV/MKV/WebM via native picker or drag/drop and play an optimized
native preview. The scrollable two-lane timeline supports zoom, seeking, split,
ripple delete, reversible edge trimming and independent source-audio volume for
every video segment; the music lane is reserved for the catalog workflow below.
Configure a blurred cover background, undistorted gameplay and a synchronized
boost HUD crop. Select the HUD visually; move/resize source selection and
composition layers; adjust independent width/height, **boost scale**,
circular/elliptical masks and feathering. Manage immutable built-in and
auto-saved custom presets; import/export validated JSON. Export full clips as
H.264 MP4 with edited source audio converted to AAC, progress/ETA, cancellation
and output opening.

Future music search, curated beat-drop/hit markers, marker-to-highlight snapping,
offline caching and audio mixing are specified in the
[edit music library roadmap](docs/MUSIC_LIBRARY_ROADMAP.md). The catalog backend
will remain separate from the desktop application.

The reference informed the lower-left circular HUD and blurred framing. Classic RL Short preserves the complete gameplay frame at 1× as required by the brief; increase gameplay scale (approximately 2.5× for 16:9 input) to approach the enlarged look in the reference. Screenshot captions and player controls are not added. The default boost crop is an initial guess and should be corrected for your HUD.

## Requirements and development

**Start here: [RUNNING.md](RUNNING.md)** covers automatic school-PC Docker mode,
native Ubuntu laptop mode, media folders, first-launch testing and troubleshooting.
Use `bash scripts/run.sh dev` (or `npm run desktop`) on either machine. The
launcher detects school hostnames / goinfre paths and supports `RLCUT_ENV=native`
or `RLCUT_ENV=docker` overrides. No host sudo is used in Docker mode.

Use Node **22.12+**, current stable Rust (**1.85+** declared minimum; current Tauri dependencies may require newer), and FFmpeg **4.4+** / FFprobe. Tauri CLI 2 is included as an npm development dependency. FFmpeg needs libx264, AAC, scale, crop, gblur, geq, overlay, zscale and tonemap. Python 3 runs video integration tests. Install Rust's rustfmt and clippy components.

Install the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/). Ubuntu 24.04:

```sh
sudo apt update
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev \
  libssl-dev librsvg2-dev libayatana-appindicator3-dev patchelf ffmpeg gstreamer1.0-libav gstreamer1.0-plugins-base gstreamer1.0-plugins-good
npm ci
npm run desktop
```

On Ubuntu 22.04, install the same desktop libraries and use its repository FFmpeg 4.4 build.

Windows: install Visual Studio Build Tools with Desktop development with C++, Rust MSVC and WebView2; put matching FFmpeg/FFprobe on PATH. macOS: install Xcode Command Line Tools, Rust and FFmpeg (e.g. `brew install ffmpeg`). The automatic launcher is intended for Linux; on Windows use `npm ci` followed by `npm run desktop:native` directly, or `npm run desktop:build:windows` to package the complete installer.

```sh
npm run dev             # browser UI development view
npm run build           # TypeScript + production frontend
npm run desktop         # native Tauri window, starts Vite automatically
npm run desktop:build   # release executable and installers on the host OS
npm run doctor          # tool versions in the automatically selected environment
npm run check           # complete verification in that environment
```

Browser mode explicitly reports that native video actions require the desktop runtime. Production embeds all frontend assets and uses no server or internet connection.

## Usage

1. Choose Classic RL Short or create a custom copy on first launch.
2. Import gameplay. Scrub to a frame with a visible boost meter.
3. Click **Select boost area**. Draw, move or resize the rectangle around the HUD and **Apply crop**; Cancel leaves the composition unchanged.
4. Adjust background, gameplay and boost controls. Layer guides expose dragging and corner resize handles. **Boost scale** multiplies both configured dimensions; width and height also remain individually adjustable.
5. In the timeline, drag a clip edge inward to trim or outward to restore source
   footage. Split/ripple-delete clips, zoom or horizontally scroll the ruler, and
   set selected video-clip volume to 0% when music should replace gameplay audio.
6. Set resolution, FPS, folder and an `.mp4` filename, then export. Existing videos are never overwritten. Open the completed file/folder or cancel and discard incomplete output.

Ctrl/⌘ O imports; Ctrl/⌘ E exports; ←/→ steps one nominal frame; Shift ←/→ jumps one second; Escape closes a dialog. VFR stepping uses nominal timestamps rather than indexed decoder frames.

Settings save default quality/FPS/folder/preset with themed dropdown menus. Presets/settings use versioned JSON in Tauri's platform app-data directory for `io.rlcut.desktop`; previews use app-cache. Writes keep a settings backup. Corrupt configurations are reported and retained; explicitly reset settings to resume saving.

## Architecture

```text
src/
  App.tsx                 workspace and native job lifecycle
  components/             controls, composition gestures, source crop editor
  lib/                    Tauri bridge and immutable preset copying
  types/                  IPC contracts
src-tauri/src/
  commands.rs             native dialogs and validated command boundary
  model.rs                versioned schemas, finite/range validation, defaults
  settings/               platform storage and backup
  presets/                bounded, validated JSON sharing
  video/
    binaries.rs           compatible executable discovery
    metadata.rs           FFprobe, sample aspect ratio and rotation
    geometry.rs           shared background/gameplay/HUD filter builder
    args.rs               structured encoder arguments and progress parser
    preview.rs            superseded-job cancellation and bounded PNG cache
    export.rs             worker, progress, cancellation and safe publication
```

Preview and export both call the same `filter_graph` Rust function. Source crop values are display-frame fractions. Gameplay/HUD X/Y are layer centers as canvas fractions. Background X/Y choose the crop position in excess scaled pixels (0 left/top, 0.5 center, 1 right/bottom). Gameplay width = canvas width × scale; height derives from source aspect. Boost width/height = independent canvas fractions × boost scale. Circle masks inscribe a true circle using the smaller pixel dimension; ellipses fill the configured bounding rectangle. Feather is an inward fraction of mask radius.

FFmpeg autorotation and display normalization handle rotation/non-square sample pixels before splitting. Canvas/layers use even pixels; derived gameplay height has at most one pixel of rounding. Background rounds upward to ensure cover. Blur 30 maps to Gaussian sigma 30 at output width 1080 and scales proportionally with preview/export width.

The final composition resets sample aspect ratio to 1:1 after scaling/overlays.
This keeps exported canvas dimensions correct in players and on re-import.

Previews render at 360 × 640, or 240 × 428 for 480p. Cache keys include source path/modification time, timestamp, preset and quality. One preview process runs at a time; obsolete processes are killed. Cached PNGs are bounded to 128 files / 256 MiB. Only reduced preview images enter frontend memory.

Exports use structured process arguments, no shell. Resolution options: 480 × 854 (explicit approximate 9:16), 720 × 1280 and 1080 × 1920. libx264 CRF 20 / medium; AAC 192 kbps when audio exists, padded with silence if shorter than video and trimmed at the video end. 30/60 CFR uses duplication/drop, no interpolation. The worker parses machine-readable microsecond progress, keeps the UI responsive and estimates remaining time when enough progress exists.

Exports encode to a hidden `.rlcut-*.partial.mp4` in the chosen folder, then publish atomically with a no-clobber hard link. Use a local filesystem supporting hard links; unsupported filesystems receive an error and partial output is removed. Cancel/failure never touches the input or another output. App close requests cancellation and joins the worker. Unexpected OS termination can leave a hidden partial file for manual removal.

## FFmpeg discovery and distribution

Discovery order: `RLCUT_FFMPEG` / `RLCUT_FFPROBE` paths, executables beside the app, packaged resources, development resources, PATH. Candidates must run `-version`. Restart after installing tools. Encoder/filter failures include diagnostics.

For a self-contained offline installer, place **both target-compatible executables** and required shared libraries in `src-tauri/resources/ffmpeg/` before building. Use `ffmpeg`/`ffprobe` on Unix and `.exe` on Windows; preserve executable permissions. Shared-library builds must resolve adjacent libraries (for example relative RPATH on Linux or @loader_path on macOS); test on a clean target machine. Tauri bundles this directory. Match OS, CPU architecture and minimum supported OS. Linux AppImage builds stage FFmpeg/FFprobe into `.runtime/appimage-tools` and deploy them in the AppImage with their dependencies; no tools are downloaded at runtime. Alternatively require separately installed tools.

The current **libx264 encoder requires a GPL-enabled FFmpeg build**; do not describe a bundled build as LGPL-only. Include applicable licenses/notices, exact corresponding source, configuration and modifications for FFmpeg and its bundled third-party libraries. Avoid `--enable-nonfree` builds for redistribution. Separate-process invocation does not remove obligations for distributed binaries. Consult the authoritative [FFmpeg license guidance](https://ffmpeg.org/legal.html) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Verify a pair with `python3 scripts/check-tools.py src-tauri/resources/ffmpeg` before packaging.

## Packaging

Build on each target host after supplying matching tool resources:

| Host | Command | Artifact |
| --- | --- | --- |
| Ubuntu x86_64 | `npm run desktop:build` | AppImage, deb, rpm |
| Windows x86_64 | `npm run desktop:build` | NSIS/MSI |
| macOS Apple Silicon | `npm run desktop:build -- --target aarch64-apple-darwin` | app/dmg |
| macOS Intel | `npm run desktop:build -- --target x86_64-apple-darwin` | app/dmg |

Artifacts are under `src-tauri/target/release/bundle` (target-specific subdirectory when `--target` is used). Install the relevant Rust target first. Produce separate macOS architecture packages with corresponding FFmpeg builds. Public installers need your platform signing/notarization credentials; see [Tauri distribution](https://v2.tauri.app/distribute/).

## Validation

```sh
npm run format
npm run format:check
npm run lint
npm test
npm run test:core
npm run test:integration
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml --features desktop
cargo clippy --manifest-path src-tauri/Cargo.toml --features desktop -- -D warnings
```

Core tests compile production Rust modules directly with rustc, without Tauri/dependency downloads: geometry, masks, preset validation, export arguments, progress, missing tools, existing-file protection and worker cancellation/cleanup. Cargo tests also cover serialization, FFprobe ratios and settings validation. Integration tests compile the actual Rust graph, generate synthetic footage, and verify resolutions, FPS, audio/silent inputs, 4K/portrait sources and preview/export pixel similarity; they explicitly skip if tools are missing. The standalone cancellation test uses a controlled worker process to exercise termination and cleanup independently of encoder availability.

See [VALIDATION.md](VALIDATION.md) for local results and limitations. CI checks native builds on Linux/Windows/macOS and real encoding on Linux. Platform installer and native interaction smoke tests remain necessary before shipping.
# rlcut

### Native preview engine

Linux playback now uses an app-owned GStreamer decoder/audio clock and bounded
binary frames, with live GPU/software composition. Scene edits do not transcode
or restart playback. Import shows measured preparation progress and supports
cancellation. See [editor architecture](docs/EDITOR_ARCHITECTURE.md).
Windows/macOS native engine packaging is pending; the earlier installer instructions
only describe the packaging infrastructure, not a working native preview there.
