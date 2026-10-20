#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
action="${1:-dev}"
shift || true
if [[ "$action" == doctor ]]; then
  for tool in node npm cargo rustc ffmpeg ffprobe; do
    if command -v "$tool" >/dev/null; then
      case "$tool" in ffmpeg|ffprobe) "$tool" -version | head -n 1 ;; *) "$tool" --version ;; esac
    else echo "MISSING: $tool"; fi
  done
  for lib in gtk+-3.0 webkit2gtk-4.1; do
    pkg-config --modversion "$lib" 2>/dev/null || echo "MISSING: $lib (see RUNNING.md)"
  done
  ldconfig -p 2>/dev/null | grep -F 'libgstreamer-1.0.so.0' >/dev/null && echo 'GStreamer runtime: available' || echo 'MISSING: GStreamer runtime (see RUNNING.md)'
  exit
fi
if [[ "$action" == shell ]]; then exec bash "$@"; fi
if [[ "$action" == appimage ]]; then
  appimage="${1:-dist/rlcut.AppImage}"
  if (($#)); then shift; fi
  [[ -f "$appimage" ]] || { echo "AppImage missing: $appimage" >&2; exit 1; }
  appimage="$(cd "$(dirname "$appimage")" && pwd)/$(basename "$appimage")"
  exec "$appimage" --appimage-extract-and-run "$@"
fi
[[ "$action" != image ]] || { echo 'image is only available in Docker mode.' >&2; exit 1; }
for tool in node npm cargo rustc ffmpeg ffprobe; do
  command -v "$tool" >/dev/null || { echo "Missing $tool. See RUNNING.md for native setup." >&2; exit 1; }
done
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<12)) { console.error("Node 22.12+ required"); process.exit(1); }'
node --input-type=module -e 'import {execFileSync} from "node:child_process"; const v=execFileSync("rustc",["--version"],{encoding:"utf8"}).match(/rustc (\d+)\.(\d+)/); if(!v||(+v[1]===1&&+v[2]<85)){console.error("Rust 1.85+ required; install current stable with rustup (see RUNNING.md)");process.exit(1)}'
if [[ "$(uname -s)" == Linux ]]; then
  for lib in gtk+-3.0 webkit2gtk-4.1; do
    pkg-config --exists "$lib" 2>/dev/null || { echo "Missing $lib. See RUNNING.md for native setup or use RLCUT_ENV=docker." >&2; exit 1; }
  done
  ldconfig -p 2>/dev/null | grep -F 'libgstreamer-1.0.so.0' >/dev/null || { echo "Missing GStreamer runtime. See RUNNING.md." >&2; exit 1; }
fi
# Reinstall only when the lock changes; node_modules is isolated in Docker.
stamp=node_modules/.rlcut-lock
lock="$(node --input-type=module -e 'import {readFileSync} from "node:fs"; import {createHash} from "node:crypto"; console.log(createHash("sha256").update(readFileSync("package-lock.json")).digest("hex"))')"
if [[ ! -f "$stamp" || "$(cat "$stamp")" != "$lock" ]]; then
  npm ci
  printf '%s' "$lock" > "$stamp"
fi
prepare_dev_ai() {
  [[ "$(uname -s)" == Linux && "${RLCUT_SKIP_AI_SETUP:-0}" != 1 ]] || return 0
  local folder=.runtime/ai
  local required=(
    rife-ncnn-vulkan rlcut-ai-cpu
    rife-v4.6/flownet.param rife-v4.6/flownet.bin
    realesr-animevideov3-x2.param realesr-animevideov3-x2.bin
  )
  local file missing=()
  for file in "${required[@]}"; do [[ -f "$folder/$file" ]] || missing+=("$file"); done
  local helper_hash
  helper_hash="$(sha256sum native/ai-cpu.cpp | awk '{print $1}')"
  [[ -f "$folder/.helper-source-sha256" && "$(cat "$folder/.helper-source-sha256")" == "$helper_hash" ]] || missing+=("helper-source")
  ((${#missing[@]})) || return 0
  for tool in python3 cmake c++ pkg-config; do command -v "$tool" >/dev/null || missing+=("tool:$tool"); done
  if ! pkg-config --exists libpng 2>/dev/null; then missing+=("library:libpng"); fi
  if printf '%s\n' "${missing[@]}" | grep -qE '^(tool|library):'; then
    echo 'rlcut: AI dev runtime is missing and cannot be prepared yet.' >&2
    echo 'Install cmake, g++, pkg-config and libpng-dev, then restart dev mode.' >&2
    return 0
  fi
  echo 'rlcut: preparing the optional AI runtime for dev mode (first run only).' >&2
  echo 'rlcut: this downloads the pinned RIFE archive and builds the local CPU helper.' >&2
  if ! python3 scripts/prepare-ai.py; then
    echo 'rlcut: AI preparation failed; starting without AI export. Retry by restarting dev mode.' >&2
  fi
}
case "$action" in
  dev)
    prepare_dev_ai
    if [[ "${RLCUT_CONTAINER:-}" == 1 ]]; then
      # A private bus supports GTK dialogs without mounting the host session bus.
      export XDG_RUNTIME_DIR=/tmp/rlcut-runtime
      mkdir -p "$XDG_RUNTIME_DIR"; chmod 700 "$XDG_RUNTIME_DIR"
      exec dbus-run-session -- npm run desktop:native -- "$@"
    fi
    exec npm run desktop:native -- "$@" ;;
  build)
    if [[ "${RLCUT_CONTAINER:-}" == 1 ]]; then export APPIMAGE_EXTRACT_AND_RUN=1; fi
    if [[ "$(uname -s)" == Linux ]]; then
      bash scripts/prepare-appimage.sh
      npm run desktop:build:native -- "$@" --config src-tauri/tauri.appimage.conf.json
      appimage="$(find src-tauri/target/release/bundle/appimage -maxdepth 1 -name 'rlcut_*_amd64.AppImage' -type f -print -quit)"
      if [[ -n "$appimage" ]]; then
        cp "$appimage" dist/rlcut.AppImage
        chmod 755 dist/rlcut.AppImage
        rustc --edition=2021 -C opt-level=2 -C strip=symbols scripts/linux-launcher.rs -o dist/rlcut
        chmod 755 dist/rlcut
        echo 'Standalone app saved to dist/rlcut (double-click) and dist/rlcut.AppImage'
      fi
    else
      npm run desktop:build:native -- "$@"
    fi ;;
  check)
    mkdir -p .checks
    npm run format:check
    npm run lint
    cargo run --quiet --manifest-path src-tauri/Cargo.toml --example scene-fixtures > .checks/scene-fixtures.json
    npm test
    npm run test:environment
    npm run test:core
    npm run build
    cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
    cargo test --manifest-path src-tauri/Cargo.toml
    cargo check --manifest-path src-tauri/Cargo.toml --features desktop
    cargo clippy --manifest-path src-tauri/Cargo.toml --features desktop --all-targets -- -D warnings
    python3 tests/pipeline.py ;;
esac
