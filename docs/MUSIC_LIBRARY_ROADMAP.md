# Edit music library roadmap

rlcut can grow a searchable edit-music catalog without coupling the catalog
backend to the desktop editor. The catalog's useful distinction is not simply
"songs": every track carries editor-ready timing metadata for the moments that
people actually synchronize clips to.

## Intended workflow

1. Search or browse edit music inside rlcut by title, artist, mood, genre,
   duration, energy, trend, or tags such as phonk, cinematic, aggressive, clean,
   or nostalgic.
2. Preview a track before adding it. Results show licensing/source information,
   waveform, BPM, duration, and one or more curated hit markers.
3. Add the track to the music lane. Its primary hit marker—usually a beat drop,
   bass hit, transition, or recognizable viral section—is immediately visible on
   the timeline.
4. Drag the music clip so that marker snaps to the important Rocket League
   moment: a goal, flip reset, save, demolition, beat-worthy camera cut, or other
   highlight. The user aligns the meaningful moments instead of guessing from a
   raw waveform.
5. Fine-tune the music in/out points, music and gameplay volume, fades, and any
   additional markers while the native preview stays responsive.

## Separate backend contract

The music service should remain a separate deployable backend. rlcut consumes a
versioned HTTPS API and keeps editing/rendering local. A useful track response
would contain:

- stable track and audio-version IDs;
- title, artist/creator, artwork, duration, tags, mood, energy, BPM and musical key;
- preview URL and an authorized download/stream URL;
- rights/license fields, attribution requirements, territories and expiry;
- waveform peaks or a URL to a compact waveform file;
- `markers[]` with an ID, timestamp, type (`drop`, `hit`, `chorus`, `transition`,
  `beat`, or `custom`), confidence, label and whether it is the primary marker;
- optional beat-grid origin/interval data for beat snapping;
- content hash and format metadata so cached audio is reproducible.

The backend owns catalog ingestion, search, moderation, rights changes, metadata
updates and marker curation. It may calculate candidate markers automatically,
but a reviewed/creator-provided marker should outrank an inferred one. The client
should never silently substitute a different audio version because timing can
change between edits, remasters and clean versions.

## Editor data and timeline behavior

An editor project should store the selected track/version ID plus a local cached
asset reference, source in/out points, edited timeline offset, gain, fades and a
snapshot of marker timestamps. Timeline markers are positions relative to the
untrimmed audio asset; their visible positions therefore move correctly when the
music clip is trimmed or shifted.

The music lane should support the same familiar operations as the video lane:
select, move, trim from either edge, split, delete, mute, adjust gain and zoom.
Music does not ripple the video by default. A dedicated "snap hit to playhead"
action and magnetic snapping should align the primary marker to the chosen video
frame. Later enhancements can include beat-grid snapping, automatic ducking of
gameplay audio, waveform thumbnails, loop regions and multiple music/SFX lanes.

## Download, cache and offline behavior

Search needs a network connection, but an added track should be cached locally so
the current edit, preview and export continue offline. Downloads should be
checksummed, written atomically, size-limited and cancellable. Cache eviction must
not remove assets referenced by an open/saved project. If a license expires, the
UI should explain whether existing local projects may still export rather than
failing silently.

## Export and safety requirements

Export mixes the edited music with the source video's audio using explicit gain,
fades and peak-safe limiting. Muting gameplay audio must not remove the video
stream. The UI should avoid clipping when both tracks are loud and eventually
offer gameplay ducking around strong music sections.

Only expose music the application is authorized to preview and export. Preserve
attribution and license evidence with project metadata, avoid logging signed
media URLs, validate all remote metadata, restrict redirects/content types and do
not execute or trust filenames supplied by the service.

### YouTube discovery boundary

The desktop library uses `rusty_ytdl` for YouTube search and temporary audio-only
stream URLs for auditioning a result. Preview URLs stay in memory and are not stored
in projects or settings. A YouTube result can be
matched to a local audio file the user owns or is licensed to use. rlcut remembers
that association as an installed item, supports favorites, and can reuse the
local file offline. The future catalog backend can replace that manual match only
when it provides its own authorized audio URL and license metadata.

## Suggested delivery phases

1. Finish the local two-lane timeline and per-clip gameplay volume.
2. Define project persistence for audio clips and markers.
3. Add a mock/local catalog and waveform/marker UI.
4. Finalize the versioned backend API, authentication if needed, caching and
   rights behavior.
5. Add real music preview/download, marker snapping and export mixing.
6. Add beat grids, automatic highlight alignment, ducking and additional lanes.
