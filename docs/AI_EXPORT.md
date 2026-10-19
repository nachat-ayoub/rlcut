# Optional AI smooth export (Linux x86_64)

Enable **AI smooth export** in Export. Nothing changes in the preview or a normal export. The toggle starts disabled each session. Enabling it selects 480p and chooses 60 FPS for footage below 50 FPS, otherwise 120 FPS. Choose 720p only when more memory is available. 1080p remains available with AI off.

RIFE v4.6 generates a midpoint between adjacent rendered frames, doubling 30→60 or 60→120 FPS. Choose 120 FPS for a 60 FPS PS5 recording to avoid first reducing it to 30 FPS. The final encoder uses CRF 17 and gentle sharpening. This is real neural frame interpolation, not Topaz's proprietary restoration or AI super-resolution; it cannot reconstruct lost source detail. Fast balls, HUDs and internal scene cuts can produce artifacts. Timeline cuts are never interpolated across. 120 FPS files also depend on player/display support; some upload services cap playback at 60 FPS.

## Low-pressure processing

AI export pauses preview playback. All enhancement subprocesses share one allowed CPU core with nice priority 15, and FFmpeg/RIFE use one compute thread. RIFE runs on CPU (`-g -1`), with a 1.5 GiB per-process virtual-memory cap, and an idle interval between frame pairs. 480p is the recommended starting point for Intel HD 5500 laptops. Higher resolutions, long clips and older CPUs may take much longer than real time; no fixed runtime is promised.

The pipeline first renders the edited composition/audio to a high-quality temporary MP4, then streams frames through a decoder, RIFE and the final encoder. It keeps two source PNGs and one AI PNG, rather than extracting the entire clip. Disk use still includes the intermediate and final MP4. Cancellation kills/reaps subprocesses and removes the temporary video and frame directory. AI failure leaves existing destination/source files intact. A killed/crashed application can leave `.rlcut-*.partial*` files in the chosen output directory; these can be removed when no export is running.

The limits reduce contention; they cannot guarantee an old laptop never becomes warm or runs low on memory. If a memory limit is reached, export fails with diagnostics rather than removing the limit. Close other heavy apps and use 480p. The GPU is not used for AI inference; the normal UI may still use graphics acceleration.

## Development and packaging

Run `python3 scripts/prepare-ai.py` once, then restart the app. It downloads the upstream Linux archive at build time, checks its pinned SHA-256, and extracts only the binary, RIFE v4.6 model and MIT license into ignored `.runtime/ai`. No Python is needed in the distributed app. `RLCUT_AI_DIR` can point to an equivalent directory for development.

`bash scripts/prepare-appimage.sh` stages AI along with FFmpeg/GStreamer. The Linux release workflow builds on Ubuntu 22.04, publishes the AppImage, a FUSE-independent single-file launcher and SHA256SUMS as GitHub Release assets. Create a new `v*` tag after the workflow is on the default branch, or dispatch **Linux AppImage release** with an existing tag. No tests are executed by this release workflow.

Upstream: https://github.com/nihui/rife-ncnn-vulkan · RIFE model: https://github.com/hzwer/Practical-RIFE . Release archive: 20221029; model: rife-v4.6. MIT license is included in the AI directory. See THIRD_PARTY_NOTICES.md for media dependencies.

If publication fails after a successful build, **Publish existing Linux build** can reuse the artifact without recompiling. Supply the original run ID and matching version tag. It verifies the artifact commit against the tag and checks SHA256SUMS before uploading the files. A `release-publish-vX.Y.Z-RUNID` branch creation is an equivalent automation trigger; it does not run tests or build application code.
