# Run and test rlcut

## Your current 42 / 1337 PC (no sudo)

From a terminal in your graphical desktop:

```sh
cd /home/anachat/goinfre/rlcut
bash scripts/run.sh env       # should print docker
bash scripts/run.sh doctor    # builds the image on first use, checks tools
bash scripts/run.sh dev       # opens the actual Tauri desktop app
```

If Node/npm is installed on the host, `npm run desktop` does the same thing.
Only Docker, Bash and xauth are needed on the school host. The image installs
Node 22, current stable Rust, GTK/WebKit, Python and FFmpeg inside Ubuntu 22.04.
It uses the existing Docker service and never runs host sudo. The first launch
downloads packages and compiles Rust; allow several minutes and several GB of
free space in goinfre. Later launches reuse the image and build caches.

Place a recording in the project's `media/` folder before launching. In the
app's file picker, open `/media` (or `/workspace/media`) and select it. Select
`/media` as the export folder too. Files there are your real host files, so the
export appears in `/home/anachat/goinfre/rlcut/media/`.

To use another folder without copying videos:

```sh
RLCUT_MEDIA_DIR=/absolute/path/to/your/clips bash scripts/run.sh dev
```

That folder appears as `/media` inside the app. The project appears as
`/workspace`. Other host folders are not mounted. Drag/drop paths from a host
file manager may not match these container paths; use the app's **Import video**
picker in Docker mode. To play an export or open its folder, use your host file
manager; the container does not include your host desktop's video player.

Presets and settings persist under `.runtime/docker/home/.local/share/`; Cargo,
Node dependencies and compiled artifacts persist under `.runtime/docker/`.
These are separate from your laptop's native dependencies and settings. Keep
presets by exporting them as JSON before moving machines or clearing caches.

### Playback on school PCs

Preview uses a small SDR H.264 proxy, not the raw 4K recording. The Docker launcher forwards the host PulseAudio/PipeWire-Pulse Unix socket and optional cookie when available. If no socket is available, it selects silent preview so the missing audio device cannot block video preroll; exports retain their audio. The UI shows when preview is silent.

To force silent preview while diagnosing audio/socket problems:

```sh
RLCUT_PREVIEW_SILENT=1 bash scripts/run.sh dev
```

Decoder waits now time out after 15 seconds and show **Retry playback** rather than spinning forever. Report the visible error if retry fails. Clear the preview cache in Settings to rebuild a proxy. Restart the launcher after pulling these changes; Docker audio mounts are established at launch.

### Software graphics and preview FPS

On Linux, rlcut now selects software compatibility automatically when no readable `/dev/dri/renderD*` node is available. This sets the software GL, WebKit compositing and DMA-BUF workarounds before GTK/WebKit starts. You can force it explicitly with one variable:

```sh
RLCUT_SOFTWARE_RENDERING=1 ./rlcut-Linux-x86_64.AppImage
```

`RLCUT_SOFTWARE_RENDERING=0` disables automatic selection for troubleshooting; explicitly supplied graphics environment variables remain respected. Software mode uses a 480px native frame source (rather than 640px), scales before RGBA conversion, reuses a native frame buffer and skips idle paused decoding work. CPU composition adapts its playing canvas between 224px and 360px wide based on observed frame work; pausing restores the larger composition canvas. The blurred background uses a smaller surface and refreshes up to 30 Hz, while gameplay and HUD continue at the available frame cadence. Color correction uses a lookup table, HUD masks are cached, and static text avoids frame-driven React renders. Source-timed polling backs off while paused and retries quickly when a playing frame is not yet ready.

The preview's **FPS · CPU/GPU** badge measures newly composed frames once per second; the sidebar shows the actual app version. This is user-visible instrumentation, not a claim of measured performance on the 42 PC. The timeline cursor follows the native position independently of the slower general React updates; edit actions read the current position. Preview tradeoffs do not change export resolution, FPS, effects or AI processing.

## Your Ubuntu laptop (native, no Docker)

Use Ubuntu 24.04 or later. Install the native prerequisites once:

```sh
sudo apt update
sudo apt install build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev \
  libssl-dev librsvg2-dev libayatana-appindicator3-dev libpng-dev cmake patchelf ffmpeg python3 curl \
  gstreamer1.0-libav gstreamer1.0-plugins-base gstreamer1.0-plugins-good
```

Install current stable Rust from [rustup](https://rustup.rs/) and Node 22.12+
from [Node.js](https://nodejs.org/). Ensure `cargo`, `rustc`, `node`, `npm`,
`ffmpeg` and `ffprobe` are on PATH. Rust 1.75 from Ubuntu 22.04 is too old.
Ubuntu 22.04 ships a compatible FFmpeg version.

For Rust (no sudo):

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/rlcut-rustup.sh
sh /tmp/rlcut-rustup.sh -y --profile minimal --component rustfmt --component clippy
source "$HOME/.cargo/env"
```

If you already use nvm, run `nvm install 22` and `nvm use 22` for Node.

In your project directory:

```sh
bash scripts/run.sh env       # native for ordinary /home/... laptop paths
bash scripts/run.sh doctor
bash scripts/run.sh dev
```

The launcher runs `npm ci` when dependencies are missing or the lockfile changes.
The Tauri CLI is a project dependency; a separate `cargo install tauri-cli` is
unnecessary. Native mode uses your ordinary file picker and app-data directory.
On Linux, the first dev launch also prepares the optional AI export runtime in
`.runtime/ai`; later launches reuse it. This downloads the pinned RIFE archive
and builds the local CPU helper, so the first launch can take a while. Set
`RLCUT_SKIP_AI_SETUP=1` to start without preparing AI.

## Detection and overrides

School hostnames ending in `.1337.ma`, `.42.fr`, `.42.*` or `.1337.*`, and project
paths inside `goinfre`, choose Docker automatically. All other paths/hosts choose
native. A laptop checkout in a folder named `goinfre` also chooses Docker; force
native in that case:

```sh
RLCUT_ENV=native bash scripts/run.sh dev
RLCUT_ENV=docker bash scripts/run.sh dev
```

The same override works with `npm run desktop`, `npm run desktop:build`,
`npm run doctor` and `npm run check`.

## Test the app

1. Choose **Use default preset** at first launch.
2. Import a short MP4 from `/media` on the school PC (any folder on the laptop).
3. Check that metadata and a composed frame appear. Scrub to a frame with the
   boost meter visible, and switch before/after.
4. Choose **Select boost area**, draw around the original HUD, then **Apply crop**.
5. Change blur, gameplay scale and boost position/size. Edits to Classic create
   a custom preset; the built-in stays unchanged.
6. For the enlarged look in the supplied screenshot, try gameplay scale around
   2.5 for 16:9 footage. The default 1.0 preserves the complete horizontal frame.
   Captions in the reference are not an implemented feature.
7. Start with a 480p / 30 FPS export to `/media` and a new `.mp4` filename.
   Watch progress, then play the result from the host file manager. Check motion,
   boost animation, original audio and the portrait dimensions.
8. Test a silent clip and cancel a longer export. Cancellation should remove
   the hidden partial output. Exporting to an existing filename should fail safely.
9. Close and reopen the app; confirm your custom preset/settings survived.

No footage yet? Generate a three-second test clip:

```sh
bash scripts/run.sh shell -c 'ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=30:duration=3 -f lavfi -i sine=frequency=440:duration=3 -c:v libx264 -preset ultrafast -c:a aac -shortest /media/test.mp4'
```

This command works in Docker mode. In native mode, replace `/media/test.mp4`
with a folder you own, for example `media/test.mp4` after `mkdir -p media`.

## Automated checks and builds

```sh
bash scripts/run.sh check     # frontend, Rust, native compile and real FFmpeg tests
bash scripts/run.sh build    # release executable/installers
bash scripts/run.sh shell    # tools in the selected environment
bash scripts/run.sh image    # explicitly rebuild the Docker image
```

Docker build artifacts appear in `.runtime/docker/target-ubuntu22.04/release/bundle/`;
native artifacts appear in `src-tauri/target/release/bundle/`. Linux packages
built in Ubuntu 22.04 target Ubuntu 22.04 and newer compatible systems; Windows/macOS packages
need builds on those operating systems. The packaged AppImage bundles its runtime libraries and FFmpeg/FFprobe,
so it runs directly on the school PC without Docker or system installation.

`npm run dev` opens only the frontend development view; video import/export
requires the Tauri app launched with the commands above.

## Troubleshooting

- **Docker daemon unavailable:** run `docker info` in your terminal. Start the
  school's provided/rootless Docker service if stopped. The app cannot replace
  access to that service. Do not install system packages on the school PC.
- **No X11 display/cookie:** launch from the graphical desktop, with `DISPLAY`
  and `XAUTHORITY` from that session. Wayland requires XWayland. The launcher
  passes a temporary cookie and does not run `xhost +` or use privileged mode.
- **Blank WebKit window:** Docker uses software rendering and disables the
  DMA-BUF renderer by default, avoiding host GPU driver dependencies.
- **Missing native packages:** `doctor` reports GTK/WebKit and tool versions;
  follow the laptop prerequisites or choose Docker.
- **Slow first build / memory pressure:** compilation defaults to two jobs in
  Docker. Use `CARGO_BUILD_JOBS=1 bash scripts/run.sh dev` if needed.
- **Missing video in picker:** it must be in `media/` or `RLCUT_MEDIA_DIR`.
- **Lost settings:** do not delete `.runtime/docker/home`; export presets as
  JSON to transfer them. App paths stored in Docker refer to container mounts.

The library setup follows [Tauri's Linux prerequisites](https://v2.tauri.app/start/prerequisites/).
The shared project/media folders use [Docker bind mounts](https://docs.docker.com/engine/storage/bind-mounts/).

## Run the standalone AppImage

The packaged build is saved as `dist/rlcut.AppImage`. Docker supplies the build
tools only; the AppImage runs directly on your PC and bundles GTK/WebKit and
FFmpeg/FFprobe. Run it without FUSE or sudo:

```sh
./dist/rlcut.AppImage --appimage-extract-and-run
```

Choose your actual host video/output folders in its file picker. The AppImage
uses normal native app settings; it does not use Docker's `/media` mount.
The Linux build baseline is Ubuntu 22.04 x86_64 (this school PC).

### Editing and checking the result

- Position X/Y use the canvas center as `(0, 0)`. Values are fractions of the canvas: `-0.5` is the left/top edge and `+0.5` is the right/bottom edge. Existing saved templates retain their positions.
- Drag gameplay or boost to snap its center or edges to the canvas. Cyan lines show a snap; hold Alt to move freely. Each layer also has a nine-button alignment grid for sides, corners, and the exact center.
- Resize selected layers and the boost source crop from any of the four corners. Gameplay keeps its aspect ratio; the boost crop can change width and height independently.
- Click outside the video to clear selection and hide the handles. Click a layer to select it again.
- Use preview Zoom to inspect the composition. In **Select boost area**, source zoom goes up to 800% and scrolls toward your selected crop. The dialog includes the boost settings and a masked cutout preview; Cancel discards dialog changes, and Apply saves them together.
- PQ and HLG HDR recordings are tone-mapped to SDR BT.709 consistently in source previews, compositions, and H.264 exports. Export quality remains CRF 20 / medium, with up to four filter threads.

### Branding assets

The in-app logo lives in `public/branding/logo.png`. The original launcher artwork lives in `assets/branding/icon.png`; generate platform icons with `npx tauri icon assets/branding/icon.png --output src-tauri/icons`. The browser preview favicon is `public/branding/icon.png`, copied from the generated 128px icon. Rebuild the AppImage after changing branding assets.

### Open the packaged app

On Linux, double-click the executable `dist/rlcut`. It contains the complete AppImage and handles extraction automatically, including on school PCs without FUSE. Keep or copy this one file wherever you want; it needs no neighboring FFmpeg files, Docker, or terminal flags. The conventional `dist/rlcut.AppImage` is also exported.

On Windows, the intended end-user package is `rlcut-setup.exe`: open the installer once, then use its Start menu shortcut. The installer includes both video tools and the offline WebView2 installer. No FFmpeg or PATH setup is required. Developer packaging on a Windows machine uses `npm run desktop:build:windows`; it downloads and verifies a versioned Windows video-tool archive at build time and exports the installer to `dist/rlcut-setup.exe`. The manual GitHub Actions **Windows installer** workflow runs the same packaging process. Windows packaging has not been executed or runtime-tested from this Linux session.

The local app-menu shortcut can be installed with `bash scripts/install-shortcut.sh` after building. It creates a user-owned `rlcut` entry using the generated launcher icon, with no sudo or system-wide changes. This provides a click-to-open option on desktops whose file manager does not launch executables on double-click.

### Native playback and progress

The Linux AppImage includes the native GStreamer playback engine, H.264/AAC
plugins, and video tools. No codec installation or separate server is needed.
Import shows preparation percentage, elapsed time, estimated remaining time, and
Cancel. The first import prepares a cached SDR source; subsequent scene changes
update live, without rendering the whole clip again.

Playback displays the composed background, gameplay and boost layers. The native
engine owns decoding, audio timing, seeking and timeline cuts; the UI receives
bounded binary frames and uses GPU composition with a software fallback. Preview
resolution adapts for responsiveness; export retains original media and output
quality. See [editor architecture](docs/EDITOR_ARCHITECTURE.md).

Windows/macOS native playback packaging is pending. The earlier Windows installer
workflow has not been upgraded for this engine; do not distribute its output yet.

`Failed to load module "canberra-gtk-module"` is an optional GTK desktop sound
hook message; it is unrelated to decoding or exports.
