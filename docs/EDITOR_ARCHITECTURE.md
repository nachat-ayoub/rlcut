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

Timeline video segments store ordered source in/out points and per-segment gain.
The editor packs them without gaps, so deletion and edge trims ripple later clips.
Trim handles may expand only into unused source ranges between neighboring clips,
which makes an accidental trim reversible without creating overlapping media.
Native playback changes playbin gain at segment boundaries; export applies the
same gain before audio concatenation. The music lane stores independent ordered source intervals and gain. It supports
the same trim, split, ripple-delete, selection and history controls as video.
A second native audio pipeline follows the video clock in edited time, including
seeks and cuts. FFmpeg trims/joins both lanes, mixes their gains and limits peaks.
Deleting music never changes the video intervals. The catalog/marker plan remains
in `MUSIC_LIBRARY_ROADMAP.md`.

Each lane has one editable peak marker stored in source time, so ripple edits and
restored source ranges keep the marker attached to its media. Clip edges snap to
the playhead, both lane markers, and every visible video/music clip boundary.
Dragging a clip body left trims its source start; dragging right restores it while
the right edge stays anchored. During that gesture the clip's peak can snap to the
other lane's peak, providing direct gameplay-to-beat synchronization.

The saved export entrance option moves the boost only on X, from a bounding box
5 output pixels left of the canvas to the configured position with cubic ease-in-out
over the first 0.8 seconds. Video cuts join before composition, so entrance timing
starts at the edited output origin even when the first source interval is trimmed.

The native player has a 60 FPS smoke check, while the frontend/Rust suites cover
timeline mapping, trim bounds, serialization, volume filters and the real export
pipeline. Timeline selection, gain, zoom/overflow and reversible trim behavior
also receive a local browser interaction pass. A final real-recording check in the
packaged desktop app remains necessary because browser-only results do not validate
the native decoder, speakers or the user's graphics driver together.
