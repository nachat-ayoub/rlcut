#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
arch="${1:?usage: prepare-macos-tools.sh <x64|arm64>}"
version=b6.1.1
stage="$root/.runtime/macos/tools"
mkdir -p "$stage/notices"

case "$arch" in
  x64)
    ffmpeg_sha=ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894
    ffprobe_sha=fa3add0ce901f7241abe0dfc0155d958fc834aca3f8ce61f87cc712ae669c1e0
    macho_arch=x86_64
    ;;
  arm64)
    ffmpeg_sha=a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584
    ffprobe_sha=bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64
    macho_arch=arm64
    ;;
  *)
    echo "Unsupported macOS architecture: $arch" >&2
    exit 1
    ;;
esac

fetch() {
  local name="$1" expected="$2" output="$stage/$1"
  curl --fail --location --retry 3 \
    "https://github.com/eugeneware/ffmpeg-static/releases/download/$version/$name-darwin-$arch" \
    --output "$output"
  printf '%s  %s\n' "$expected" "$output" | shasum -a 256 --check
  chmod 755 "$output"
  lipo -archs "$output" | tr ' ' '\n' | grep -qx "$macho_arch"
}

fetch ffmpeg "$ffmpeg_sha"
fetch ffprobe "$ffprobe_sha"
cp "$root/THIRD_PARTY_NOTICES.md" "$stage/notices/THIRD_PARTY_NOTICES.md"
cat > "$stage/notices/build-source.txt" <<EOF
FFmpeg static release: $version
Source and license information: https://github.com/eugeneware/ffmpeg-static/releases/tag/$version
Target architecture: $macho_arch
EOF

echo "Prepared verified macOS $arch video tools."
