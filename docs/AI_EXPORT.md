# Optional AI export (Linux x86_64)

Export offers two independent options, both off by default and reset when opening a project:

* **AI smooth export** uses RIFE v4.6 to generate intermediate frames. Select 60 FPS for 30 FPS footage, or 120 FPS for 60 FPS footage. All resolutions, including **1080 × 1920**, remain available. Enabling smoothing preserves the chosen resolution.
* **AI upscale ×2** uses the compact Real-ESRGAN anime-video-v3 neural model to double the selected export dimensions: 480 × 854 → 960 × 1708; 720 × 1280 → 1440 × 2560; **1080 × 1920 → 2160 × 3840**. It does not first reduce the selected resolution. It works with or without smoothing. The model was trained for animation and may change game textures, HUD text or fine details.

Preview is unchanged. Native source detail cannot be recreated perfectly; these are open-source neural models, not Topaz's proprietary restoration engine. AI can introduce artifacts. Check fast ball movement, HUDs and tile edges before sharing. Timeline cuts are not interpolated across. 120 FPS output requires suitable player/display support; some upload services cap playback at 60 FPS.

## Reusing prepared AI video

The first enhanced export prepares a silent video without text, then renders text and audio in a separate finishing pass. Completed results are cached across app launches. Changing text, fonts, music, clip volume or the destination reuses the AI video. Changing source files, clip ranges, layout, color correction, FPS, resolution, AI options, models or app version prepares a new result. Failed/canceled preparation is never reused. Settings → Clear AI cache removes prepared results; older entries are pruned at 4 GiB (the current result is retained). Cache storage follows `XDG_CACHE_HOME`, otherwise `~/.cache/io.rlcut.desktop/ai-exports-v4`.

## Memory versus time

The export processes one frame at a time. RIFE sees overlapping 640px cores with a 64px context halo (at most 768 × 768 pixels); overlapping predictions are feathered together. Upscaling uses 256px cores with 32px context and crops to each core. This bounds inference memory independently of full-frame resolution while avoiding the heavy process and context overhead of very small tiles. Fast motion can extend beyond tile context and cause local inconsistencies; blending reduces seams but cannot guarantee their absence.

Enhancement processes use half the available CPU threads, bounded to 1–4, at nice priority 15. A persistent CPU helper loads each model once per job and runs tiles directly in memory, avoiding per-tile process startup, repeated model loading and PNG tile I/O. The helper has a 3 GiB address-space cap. No GPU is used for neural inference. The cap is not a total-app RAM budget: decoders, encoders and the UI need additional memory. `RLCUT_AI_THREADS=1..4` overrides the default thread count. Processing can still be slow on an old CPU, especially when smoothing and 2× upscaling are combined. There is no measured performance guarantee for an Intel HD 5500 laptop. To bound waiting, after 40 minutes from export start the app stops neural inference and finishes remaining frames with frame blending and bicubic upscaling. Completed neural frames are retained; a visible warning is saved with the cache and shown again on reuse. This can produce a visible quality change and blending can cause ghosting. At 45 minutes, unfinished enhanced exports stop with an error and preserve existing outputs. The deadline bounds processing rather than guaranteeing a successful export on every machine, especially for 4K/120 FPS output.

The app pauses preview playback for AI exports. It renders a high-quality intermediate MP4, then streams decoded frames through optional interpolation and/or upscaling into the final encoder. Only a few full-frame PNGs are kept on disk; no clip-sized frame sequence is extracted. The completed video is cached. Disk still needs room for the intermediate and final videos. Cancellation kills the helper's entire process group, and removes temporary files. Existing inputs and outputs remain protected until final publication. A forced application/OS termination can leave `.rlcut-*.partial*` files for later manual cleanup.

## Development and packaging

Install CMake, a C++17 compiler, pkg-config and libpng development headers. On Linux, `bash scripts/run.sh dev` prepares the AI runtime automatically when it is missing; set `RLCUT_SKIP_AI_SETUP=1` to opt out. You can also run `python3 scripts/prepare-ai.py` directly. It stages checksum-pinned RIFE, builds a CPU-only static ncnn helper, and extracts only the required Real-ESRGAN x2 model from a checksum-pinned upstream archive. No model conversion, Python runtime, account, GPU driver or model download is needed on the user's laptop.

The helper source is `native/ai-cpu.cpp`; its reproducible build is `scripts/prepare-ai-cpu.py`. CMake explicitly disables ncnn tests, tools, examples, benchmarks and Vulkan. RIFE inference runs directly in the CPU-only helper; the legacy RIFE executable and loader remain bundled for runtime compatibility. `RLCUT_AI_DIR` can override the staged directory for development. All required helper/model files must exist before the AI toggles become available.

The Linux release workflow builds an AppImage and single-file FUSE-independent launcher on Ubuntu 22.04. **Publish existing Linux build** can recover a completed build using its run ID and matching tag; it verifies the source commit and SHA256SUMS before publishing without rebuilding or executing tests.

Sources: https://github.com/nihui/rife-ncnn-vulkan (20221029, rife-v4.6), https://github.com/Tencent/ncnn (20220729), https://github.com/xinntao/Real-ESRGAN (v0.2.5.0 archive, realesr-animevideov3-x2). Licenses are bundled in `usr/bin/rlcut-ai` and recorded in THIRD_PARTY_NOTICES.md.
