# Optional AI export (Linux x86_64)

Both AI options start off. Export always reads the original recordings, independently of the smaller preview proxies.

## Video first, AI second, text and audio last

The first AI export renders the selected cuts, layout and color correction into a silent composition. AI processes that video, then a finishing pass adds text, clip audio and music. Text stays crisp at the final resolution. Completed AI videos are cached across app launches; text, font, music, volume and destination edits reuse the cache. Changes to sources, ranges, layout, color, FPS, resolution, AI options, model or app version prepare a new result. Incomplete/failed results are never cached. Settings → Clear AI cache removes prepared videos. Old entries are pruned at 4 GiB, retaining the current result. Storage uses `XDG_CACHE_HOME`, otherwise `~/.cache/io.rlcut.desktop/ai-exports-v4`.

## Upscaling choices

**AI upscale / enhance** offers two models:

* **Fast · compact video model:** Real-ESRGAN animevideov3 ×2. Trained for animation; it can alter game textures/HUDs.
* **Upscayl Lite · general images:** the unmodified `upscayl-lite-4x` model shipped with Upscayl v2.15.0. Its native ×4 prediction is resized inside each tile to the requested ×2 result. This bounds full-frame memory and does not construct a full ×4 frame. Lite is lighter than Upscayl's larger image models; it is not necessarily faster than the compact video model on a CPU.

The default **Keep selected size** mode processes a half-width/half-height composition. For 1080 × 1920 output, the AI input is **540 × 960**, not the raw PS5 4K recording. This reduces AI input pixels by four relative to the previous ×2 enlargement path. The final image remains 1080 × 1920. Reconstruction trades native source detail for learned detail: a normal export may look better when the recording is already sharp. Compare before committing to a long render.

**Double selected size** retains the previous behavior: AI processes the selected composition dimensions and doubles them, up to 2160 × 3840. It does not run the model on the original 4K source dimensions.

## Smoothing and time

**AI smooth export** uses RIFE v4.6 to generate intermediate frames. Choose 60 FPS for 30 FPS footage or 120 FPS for 60 FPS footage. Smoothing is optional and separate from upscaling. Cuts are never interpolated across. Combining smoothing and upscaling increases work. Upload services may cap playback at 60 FPS.

Every requested frame receives neural processing. The previous 40-minute blending/scaling fallback and 45-minute abort are removed. The app remains cancellable and shows frame/tile progress, elapsed time and an estimate based on completed work. There is no measured speed guarantee for the user's laptop or school PC. A ten-second 60 FPS clip has 600 output frames: seven seconds per frame is 70 minutes, while thirty minutes requires an average below three seconds per frame plus rendering/encoding time.

## CPU and memory limits

A persistent CPU-only ncnn worker loads each model once per job. Tiles are processed in memory; only a few full-frame PNGs are kept on disk. Fast PNG writing reduces IPC overhead. Exact duplicate input PNGs reuse one previous enhanced frame rather than repeating inference. No sequence of decoded frames is retained.

Parallelism happens inside neural layers, using half the available CPU threads bounded to 1–4, at nice priority 15. `RLCUT_AI_THREADS=1..4` overrides the default. Starting several full-frame workers would duplicate model buffers and compete for the same old CPU, so inference keeps one frame in flight. The helper has a 3 GiB address-space cap; UI, decoder and encoder memory is additional. Responsiveness still depends on total available RAM and other applications. Preview playback pauses during AI export.

RIFE uses overlapping 640px cores with a 64px context halo; upscaling uses 256px cores with 32px context. Blending/cropping reduces tile seams. AI can still introduce flicker, motion errors, hallucinated texture and HUD artifacts. These open-source models do not reproduce Topaz's proprietary restoration.

Cancellation kills the process group and removes job temporary files. Original inputs and existing outputs are protected until publication. Forced OS/app termination can leave `.rlcut-*.partial*` files for manual cleanup.

## Development and packaging

Install CMake, a C++17 compiler, pkg-config and libpng development headers. `bash scripts/run.sh dev` prepares missing Linux AI assets automatically; `RLCUT_SKIP_AI_SETUP=1` skips setup. `python3 scripts/prepare-ai.py` stages checksum-pinned RIFE and builds the CPU helper with `scripts/prepare-ai-cpu.py`. Both upscaling models are pinned by checksum, bundled with licenses and require no account, GPU driver, Python runtime or model downloads on the user's machine. Upscayl normally uses Vulkan; this app runs its Lite weights in the CPU-only helper instead.

CMake disables ncnn tests, examples, tools, benchmarks and Vulkan. The legacy RIFE executable/loader remain bundled for compatibility. `RLCUT_AI_DIR` overrides the runtime directory. The AppImage builds on Ubuntu 22.04, then a separate host job verifies checksums and publishes it using current GitHub CLI. **Publish existing Linux build** can recover artifacts after verifying their source commit matches the selected tag.
