# Third-party components

rlcut uses Tauri, React, Vite, TypeScript, Tailwind CSS, Lucide, serde and rfd. Preserve their applicable license notices when distributing compiled applications.

FFmpeg/FFprobe binaries are **not included** here. If you bundle them, include notices identifying the exact build/version, origin, target OS/CPU, configuration, third-party libraries, changes and applicable licenses, plus license texts and exact corresponding source/build instructions. Preserve required shared-library notices too.

The configured encoder is libx264; an FFmpeg binary enabling it includes GPL-covered components. An LGPL-only build cannot satisfy the current export configuration. Do not bundle nonredistributable `--enable-nonfree` builds. Maintain notices matching the actual binaries.

Authoritative reference: [FFmpeg license and legal considerations](https://ffmpeg.org/legal.html). Distributors must comply with the specific licenses of the builds they ship.

Linux preview playback also bundles GStreamer and selected base, good, and libav
plugins, plus the plugin scanner. Their Ubuntu package copyright notices and
versions are included under `usr/share/rlcut/video-tool-notices` in the AppImage.
