# Third-party components

rlcut uses Tauri, React, Vite, TypeScript, Tailwind CSS, Lucide, serde and rfd. Preserve their applicable license notices when distributing compiled applications.

FFmpeg/FFprobe binaries are **not included** here. If you bundle them, include notices identifying the exact build/version, origin, target OS/CPU, configuration, third-party libraries, changes and applicable licenses, plus license texts and exact corresponding source/build instructions. Preserve required shared-library notices too.

The configured encoder is libx264; an FFmpeg binary enabling it includes GPL-covered components. An LGPL-only build cannot satisfy the current export configuration. Do not bundle nonredistributable `--enable-nonfree` builds. Maintain notices matching the actual binaries.

Authoritative reference: [FFmpeg license and legal considerations](https://ffmpeg.org/legal.html). Distributors must comply with the specific licenses of the builds they ship.

Linux preview playback also bundles GStreamer and selected base, good, and libav
plugins, plus the plugin scanner. Their Ubuntu package copyright notices and
versions are included under `usr/share/rlcut/video-tool-notices` in the AppImage.

## Optional RIFE AI frame interpolation

Linux AI-enabled packages include nihui/rife-ncnn-vulkan (20221029) and its
rife-v4.6 model, using ncnn for CPU neural inference. The upstream MIT license
is preserved at `usr/bin/rlcut-ai/RIFE-LICENSE` inside the AppImage. Source:
https://github.com/nihui/rife-ncnn-vulkan and https://github.com/hzwer/Practical-RIFE .
The pinned archive checksum and selected files are in `scripts/prepare-ai.py`.
This feature does not include Topaz software or claim equivalence to its models.

ncnn and its bundled dependency notices are included in `NCNN-LICENSE` beside
the RIFE license; a source copy is in `resources/licenses/NCNN-LICENSE`.
