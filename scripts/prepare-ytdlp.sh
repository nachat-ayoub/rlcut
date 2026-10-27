#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

version=2026.10.26
digest=e51e69e89489f199530f13d32a4342da3ddb2cf34842f364603a066db05afbf3
folder=.runtime/yt-dlp
target="$folder/yt-dlp"

if [[ -x "$target" && "$(sha256sum "$target" | awk '{print $1}')" == "$digest" ]]; then
  exit 0
fi

command -v curl >/dev/null || { echo 'curl is required to prepare the YouTube audio helper.' >&2; exit 1; }
command -v python3 >/dev/null || { echo 'python3 is required to run the YouTube audio helper.' >&2; exit 1; }
mkdir -p "$folder"
temporary="$(mktemp "$folder/yt-dlp.XXXXXX")"
trap 'rm -f "$temporary"' EXIT
curl -L --fail --silent --show-error \
  "https://github.com/yt-dlp/yt-dlp/releases/download/$version/yt-dlp" \
  -o "$temporary"
actual="$(sha256sum "$temporary" | awk '{print $1}')"
[[ "$actual" == "$digest" ]] || { echo "yt-dlp checksum mismatch: $actual" >&2; exit 1; }
chmod 755 "$temporary"
mv "$temporary" "$target"
trap - EXIT
echo "rlcut: prepared yt-dlp $version for music previews."
