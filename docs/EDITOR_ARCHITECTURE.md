# Editor pipeline

Linux playback is owned by a native GStreamer engine, not an HTML video element.
The application creates a playbin pipeline with a native audio sink and an RGBA
appsink. GStreamer owns decoding, audio synchronization, pause and accurate seek.
A Rust worker drains the bounded one-frame queue independently of React and
checks the kept timeline intervals. Deleted intervals trigger native seeks.

The UI requests binary frames through Tauri IPC. At most one request is in flight;
unchanged 120 Hz polls send a small header, rather than another image. Changed RGBA
buffers upload directly into a reused WebGL texture without an intermediate 2D
canvas; paused snapshots and the software compositor materialize a canvas. Frame timestamps,
readiness, errors and end-of-playback come from the native engine. Source replacement
is session-scoped; old controls cannot stop a newer player. Shutdown joins the
worker and sets the pipeline to NULL to release decoding and audio resources.

The live GPU compositor applies the background, gameplay transform and boost
crop/mask to the same decoded frame. Scene changes redraw the existing texture
source without reopening the player, transcoding a clip or waiting for a rendered
preview. Unavailable or slow graphics contexts use the software compositor.
Preview filtering and resolution prioritize interactive performance. Export uses
the original recording and the existing full-resolution FFmpeg pipeline.

Import prepares one cached, seekable SDR source, including consistent HDR tone
mapping. FFmpeg reports processed duration; the UI displays actual percentage,
elapsed time and an approximate remaining time. Cancel kills the preparation job
and removes its incomplete output. An import only replaces the current source
when preparation succeeds. Metadata probing and native decoder opening use an
activity indicator because they do not expose measurable percentage progress.

The native engine is shipped in the Linux AppImage with its decoder/audio plugins
and shared libraries. Windows/macOS native-engine packaging is pending; the old
browser playback fallback has been removed. Those installers must not be published
until the native engine/runtime has been packaged for those platforms.

This revision was compiled and given a short native-frame smoke check with the
provided recording. The full test suite and interactive acceptance testing were
skipped at the user's request. Prior browser-player test results do not validate
this native engine. Geometry fixtures and compositor/reference tools remain useful
for future regression coverage.
