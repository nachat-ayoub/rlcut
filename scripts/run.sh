#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
source "$PROJECT_ROOT/scripts/environment.sh"
mode="$(detect_environment)"
action="${1:-dev}"
if (($#)); then shift; fi
case "$action" in
  env) echo "$mode"; exit ;;
  dev|build|check|doctor|shell|image|appimage) ;;
  *) echo 'Usage: bash scripts/run.sh [dev|build|check|doctor|shell|image|appimage|env]' >&2; exit 2 ;;
esac
if [[ "$action" == appimage ]]; then mode=native; fi
echo "rlcut: $mode environment ($action)"
cd "$PROJECT_ROOT"
if [[ "$mode" == native ]]; then
  exec bash scripts/runtime.sh "$action" "$@"
fi
command -v docker >/dev/null || { echo 'Docker is missing. Ask school IT to enable Docker, or use RLCUT_ENV=native on a prepared laptop.' >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo 'Docker daemon is unavailable. Start the school-provided/rootless Docker service; no sudo is used by this app.' >&2; exit 1; }
image="${RLCUT_DOCKER_IMAGE:-rlcut-dev:ubuntu22.04}"
if [[ "$action" == image ]] || ! docker image inspect "$image" >/dev/null 2>&1; then
  docker build -t "$image" -f docker/Dockerfile .
fi
[[ "$action" != image ]] || exit 0
runtime="$PROJECT_ROOT/.runtime/docker"
mkdir -p "$runtime"/{home,cargo,target-ubuntu22.04,node_modules,npm}
args=(run --rm --init --shm-size=512m)
[[ ! -t 0 || ! -t 1 ]] || args+=(-it)
# Rootless container root maps to the invoking host user. Rootful Docker needs
# an explicit host UID/GID so caches, exports and presets remain user-owned.
if ! docker info --format '{{json .SecurityOptions}}' | grep -q rootless; then
  args+=(--user "$(id -u):$(id -g)")
fi
args+=(--mount "type=bind,src=$PROJECT_ROOT,dst=/workspace"
  --mount "type=bind,src=$runtime/node_modules,dst=/workspace/node_modules"
  --mount "type=bind,src=$runtime/home,dst=/home/rlcut"
  --mount "type=bind,src=$runtime/cargo,dst=/home/rlcut/.cargo"
  --mount "type=bind,src=$runtime/target-ubuntu22.04,dst=/workspace/src-tauri/target"
  --mount "type=bind,src=$runtime/npm,dst=/home/rlcut/.npm"
  -e HOME=/home/rlcut -e CARGO_HOME=/home/rlcut/.cargo
  -e LANG=C.UTF-8 -e LC_ALL=C.UTF-8
  -e RLCUT_CONTAINER=1 -e CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}")
# Limit file access to the project and an explicit media folder.
media="${RLCUT_MEDIA_DIR:-$PROJECT_ROOT/media}"
mkdir -p "$media"
media="$(cd "$media" && pwd -P)"
args+=(--mount "type=bind,src=$media,dst=/media")
if [[ "$action" == dev ]]; then
  [[ -n "${DISPLAY:-}" && -d /tmp/.X11-unix ]] || { echo 'No X11/XWayland display. Run from the graphical desktop terminal; use check for headless tests.' >&2; exit 1; }
  command -v xauth >/dev/null || { echo 'xauth is required on the host to forward the display securely.' >&2; exit 1; }
  auth="$(mktemp "$runtime/xauth.XXXXXX")"
  chmod 600 "$auth"
  trap 'rm -f "$auth"' EXIT
  # FamilyWild allows the host cookie to work with the container hostname.
  xauth nlist "$DISPLAY" | sed 's/^..../ffff/' | xauth -f "$auth" nmerge -
  [[ -s "$auth" ]] || { echo 'No X11 cookie found. Check DISPLAY and XAUTHORITY in your desktop session.' >&2; exit 1; }
  # Forward the host PulseAudio / PipeWire-Pulse socket when available. Without
  # audio forwarding, playbin may never preroll on school Docker desktops.
  pulse_socket="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/pulse/native"
  if [[ "${PULSE_SERVER:-}" == unix:* ]]; then pulse_socket="${PULSE_SERVER#unix:}"; fi
  if [[ -S "$pulse_socket" && "${RLCUT_PREVIEW_SILENT:-0}" != 1 ]]; then
    args+=(--mount "type=bind,src=$pulse_socket,dst=/tmp/rlcut-pulse-native,readonly"
      -e PULSE_SERVER=unix:/tmp/rlcut-pulse-native)
    pulse_cookie="${PULSE_COOKIE:-$HOME/.config/pulse/cookie}"
    if [[ -f "$pulse_cookie" ]]; then
      args+=(--mount "type=bind,src=$pulse_cookie,dst=/tmp/rlcut-pulse-cookie,readonly" -e PULSE_COOKIE=/tmp/rlcut-pulse-cookie)
    fi
  else
    args+=(-e RLCUT_PREVIEW_SILENT=1)
    echo 'rlcut: no preview audio socket; video playback will be silent (export audio is preserved).'
  fi
  args+=(--mount type=bind,src=/tmp/.X11-unix,dst=/tmp/.X11-unix,readonly
    --mount "type=bind,src=$auth,dst=/tmp/rlcut.xauth,readonly"
    -e "DISPLAY=$DISPLAY" -e XAUTHORITY=/tmp/rlcut.xauth -e GDK_BACKEND=x11
    -e LIBGL_ALWAYS_SOFTWARE=1 -e WEBKIT_DISABLE_DMABUF_RENDERER=1)
fi
docker "${args[@]}" "$image" bash scripts/runtime.sh "$action" "$@"
