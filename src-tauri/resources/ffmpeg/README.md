# Target-specific tools

Optional offline installer resources: add `ffmpeg` and `ffprobe` (`.exe` on Windows), required dynamic libraries, applicable licenses/notices and exact corresponding source/build documentation. Preserve executable permissions on Unix. No tools are downloaded at runtime.

Use a redistributable GPL-enabled build with libx264. Match the target OS/architecture; never reuse an incompatible host binary. See the root README and THIRD_PARTY_NOTICES.md. Check with `python3 scripts/check-tools.py src-tauri/resources/ffmpeg` before building.
