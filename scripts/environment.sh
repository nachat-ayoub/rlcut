#!/usr/bin/env bash
# Sourced by the launcher and its tests. No system changes.
detect_environment() {
  local mode="${RLCUT_ENV:-auto}" host="${RLCUT_HOSTNAME:-$(hostname)}"
  case "$mode" in
    docker|native) printf '%s\n' "$mode"; return ;;
    auto) ;;
    *) echo 'RLCUT_ENV must be auto, docker or native.' >&2; return 1 ;;
  esac
  # School hostnames are authoritative even when the checkout is outside goinfre.
  # Also recognize goinfre checkouts; Ubuntu laptops normally live under /home.
  case "$host" in
    *.1337.ma|*.42.fr|*.42.*|*.1337.*) echo docker; return ;;
  esac
  case "${RLCUT_PROJECT_PATH:-$PROJECT_ROOT}" in
    /goinfre/*|*/goinfre/*) echo docker ;;
    *) echo native ;;
  esac
}
