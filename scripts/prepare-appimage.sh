#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
stage=.runtime/appimage-tools
mkdir -p "$stage/notices" "$stage/gstreamer-1.0"
mkdir -p "$stage/gstreamer-scanner"
for tool in ffmpeg ffprobe; do
  cp "$(command -v "$tool")" "$stage/$tool"
  chmod 755 "$stage/$tool"
done
cp /usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner "$stage/gstreamer-scanner/"
# The native engine uses GStreamer for decoding, audio and the media clock. Explicitly stage the
# playback elements because linuxdeploy cannot discover dynamically loaded plugins.
gst_dir=/usr/lib/x86_64-linux-gnu/gstreamer-1.0
# Plugin naming differs between Ubuntu 22.04 and newer GStreamer versions.
converters=(videoconvert videoscale)
if [[ -f "$gst_dir/libgstvideoconvertscale.so" ]]; then converters=(videoconvertscale); fi
rm -f "$stage/gstreamer-1.0/"*.so
for plugin in app autodetect coreelements playback audioconvert audioresample volume pulseaudio libav isomp4 typefindfunctions videorate audiofx audioparsers ogg wavparse flac id3demux "${converters[@]}"; do
  file="$gst_dir/libgst$plugin.so"
  [[ -f "$file" ]] || { echo "Missing playback plugin: $file" >&2; exit 1; }
  cp "$file" "$stage/gstreamer-1.0/"
done
python3 scripts/check-tools.py "$stage"
cp THIRD_PARTY_NOTICES.md "$stage/notices/THIRD_PARTY_NOTICES.md"
# Preserve the Ubuntu package copyright notices for the tools and libraries.
if command -v dpkg-query >/dev/null; then
  dpkg-query -W ffmpeg > "$stage/notices/package-version.txt"
  for file in /usr/share/doc/ffmpeg/copyright; do
    [[ ! -f "$file" ]] || cp "$file" "$stage/notices/ffmpeg-copyright"
  done
  for library in "$stage/gstreamer-1.0/"*.so "$stage/gstreamer-scanner/gst-plugin-scanner"; do
    original="$gst_dir/$(basename "$library")"
    if [[ "$library" == *gst-plugin-scanner ]]; then
      original=/usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner
    fi
    owner="$(dpkg-query -S "$original" | head -n 1 | cut -d ':' -f 1)"
    cp "/usr/share/doc/$owner/copyright" "$stage/notices/$owner-copyright"
    dpkg-query -W "$owner" >> "$stage/notices/package-version.txt"
  done
  # Include notices for the FFmpeg shared libraries linuxdeploy will collect.
  ldd "$stage/ffmpeg" | awk '/=> \// {print $3}' | sort -u | while read -r library; do
    owner="$(dpkg-query -S "$library" 2>/dev/null | head -n 1 | cut -d ':' -f 1 || true)"
    if [[ -n "$owner" && -f "/usr/share/doc/$owner/copyright" ]]; then
      cp "/usr/share/doc/$owner/copyright" "$stage/notices/$owner-copyright"
    fi
  done
fi
