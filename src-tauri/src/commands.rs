use crate::{
    model::{ExportOptions, MusicFile, MusicTrack, Preset, Segment, Video},
    presets,
    settings::{self, LibrarySong, Store},
    video::{
        binaries::Binaries,
        export::{self, Job, Progress},
        metadata, preview,
    },
};
use serde::Serialize;
use std::{
    collections::hash_map::DefaultHasher,
    collections::{HashMap, HashSet},
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::State;
pub struct AppState {
    file: PathBuf,
    cache: PathBuf,
    audio_cache: PathBuf,
    binaries: Binaries,
    videos: Mutex<HashMap<String, Video>>,
    store_lock: Mutex<()>,
    proxy_lock: Arc<Mutex<()>>,
    decoder_epoch: Arc<AtomicU64>,
    player: Arc<Mutex<PlayerSlot>>,
    preparation: Arc<Mutex<Preparation>>,
    playback_stop: Arc<AtomicBool>,
    playback_worker: Mutex<Option<std::thread::JoinHandle<()>>>,
    pub job: Arc<Mutex<Option<Arc<Job>>>>,
    pub worker: Mutex<Option<std::thread::JoinHandle<()>>>,
}
impl AppState {
    pub fn new(file: PathBuf, cache: PathBuf, binaries: Binaries) -> Self {
        let audio_cache = cache.join("music-previews");
        let _ = fs::remove_dir_all(&audio_cache);
        let _ = fs::create_dir_all(&audio_cache);
        let player = Arc::new(Mutex::new(PlayerSlot {
            session: 0,
            player: None,
        }));
        let playback_stop = Arc::new(AtomicBool::new(false));
        let slot = player.clone();
        let stop = playback_stop.clone();
        let playback_worker = std::thread::spawn(move || {
            while !stop.load(Ordering::SeqCst) {
                if let Ok(mut slot) = slot.lock() {
                    if let Some(player) = slot.player.as_mut() {
                        player.pump();
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(8));
            }
        });
        Self {
            file,
            cache,
            audio_cache,
            binaries,
            videos: Mutex::new(HashMap::new()),
            store_lock: Mutex::new(()),
            proxy_lock: Arc::new(Mutex::new(())),
            decoder_epoch: Arc::new(AtomicU64::new(0)),
            player,
            playback_stop,
            playback_worker: Mutex::new(Some(playback_worker)),
            preparation: Arc::new(Mutex::new(Preparation::default())),
            job: Arc::new(Mutex::new(None)),
            worker: Mutex::new(None),
        }
    }
    pub fn shutdown(&self) {
        self.decoder_epoch.fetch_add(1, Ordering::SeqCst);
        let _decoder_guard = self.proxy_lock.lock().ok();
        self.playback_stop.store(true, Ordering::SeqCst);
        if let Ok(mut worker) = self.playback_worker.lock() {
            if let Some(worker) = worker.take() {
                let _ = worker.join();
            }
        }
        if let Ok(mut slot) = self.player.lock() {
            slot.player.take();
        }
        if let Ok(job) = self.job.lock() {
            if let Some(j) = job.as_ref() {
                j.cancel.store(true, Ordering::SeqCst);
            }
        }
        if let Ok(mut worker) = self.worker.lock() {
            if let Some(handle) = worker.take() {
                let _ = handle.join();
            }
        };
        let _ = fs::remove_dir_all(&self.audio_cache);
    }
    fn video(&self, path: &str) -> Result<Video, String> {
        self.videos
            .lock()
            .map_err(|_| "Video state unavailable")?
            .get(path)
            .cloned()
            .ok_or_else(|| "Import this video before processing it".into())
    }
}
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Init {
    version: String,
    store: Store,
    binaries: Binaries,
    storage_error: Option<String>,
    ai_available: bool,
    preview_audio: bool,
    software_rendering: bool,
}
#[tauri::command]
pub fn initialize(state: State<AppState>) -> Init {
    let (store, error) = match settings::load(&state.file) {
        Ok(s) => (s, None),
        Err(e) => (Store::default(), Some(e)),
    };
    Init {
        version: env!("CARGO_PKG_VERSION").into(),
        store,
        binaries: state.binaries.clone(),
        storage_error: error,
        ai_available: crate::video::enhance::available(),
        preview_audio: std::env::var("RLCUT_PREVIEW_SILENT").as_deref() != Ok("1"),
        software_rendering: std::env::var("LIBGL_ALWAYS_SOFTWARE").as_deref() == Ok("1"),
    }
}
#[tauri::command]
pub fn save_store(state: State<AppState>, store: Store) -> Result<(), String> {
    let _lock = state.store_lock.lock().map_err(|_| "Settings busy")?;
    settings::save(&state.file, &store)
}
#[tauri::command]
pub async fn pick_video() -> Result<Vec<String>, String> {
    blocking(|| {
        Ok(rfd::FileDialog::new()
            .add_filter("Video", &["mp4", "mov", "mkv", "webm"])
            .pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|p| p.to_string_lossy().into())
            .collect())
    })
    .await
}
#[tauri::command]
pub async fn pick_music(state: State<'_, AppState>) -> Result<Option<MusicFile>, String> {
    let binaries = state.binaries.clone();
    blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .add_filter(
                "Audio",
                &["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "webm"],
            )
            .pick_file()
        else {
            return Ok(None);
        };
        metadata::probe_music(&binaries, &path).map(Some)
    })
    .await
}
#[tauri::command]
pub async fn import_music_path(
    state: State<'_, AppState>,
    path: String,
) -> Result<MusicFile, String> {
    let binaries = state.binaries.clone();
    blocking(move || metadata::probe_music(&binaries, &PathBuf::from(path))).await
}

fn limited(value: String, max: usize) -> String {
    value.chars().take(max).collect()
}

fn first_json_object_after<'a>(source: &'a str, marker: &str) -> Option<&'a str> {
    let marker_end = source.find(marker)? + marker.len();
    let start = marker_end + source[marker_end..].find('{')?;
    let mut depth = 0_u32;
    let mut quoted = false;
    let mut escaped = false;
    for (offset, character) in source[start..].char_indices() {
        if quoted {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == '"' {
                quoted = false;
            }
            continue;
        }
        match character {
            '"' => quoted = true,
            '{' => depth += 1,
            '}' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(&source[start..start + offset + character.len_utf8()]);
                }
            }
            _ => {}
        }
    }
    None
}

fn short_song(model: &serde_json::Value) -> Option<LibrarySong> {
    let id = model
        .pointer("/onTap/innertubeCommand/reelWatchEndpoint/videoId")?
        .as_str()?;
    if !valid_youtube_id(id) {
        return None;
    }
    let title = model
        .pointer("/overlayMetadata/primaryText/content")
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            model
                .get("accessibilityText")
                .and_then(serde_json::Value::as_str)
        })?
        .split(", ")
        .next()
        .unwrap_or("YouTube Short")
        .trim();
    let thumbnails = model
        .pointer("/onTap/innertubeCommand/reelWatchEndpoint/thumbnail/thumbnails")
        .or_else(|| model.pointer("/thumbnailViewModel/thumbnailViewModel/image/sources"))
        .and_then(serde_json::Value::as_array);
    let thumbnail = thumbnails
        .and_then(|items| {
            items
                .iter()
                .max_by_key(|item| {
                    item.get("width")
                        .and_then(serde_json::Value::as_u64)
                        .unwrap_or(0)
                        * item
                            .get("height")
                            .and_then(serde_json::Value::as_u64)
                            .unwrap_or(0)
                })
                .and_then(|item| item.get("url"))
                .and_then(serde_json::Value::as_str)
        })
        .map(str::to_owned)
        .unwrap_or_else(|| format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"));
    Some(LibrarySong {
        id: id.into(),
        title: limited(title.into(), 500),
        channel: "YouTube Shorts".into(),
        thumbnail: limited(thumbnail, 2_000),
        views: 0,
        duration: 0.,
        is_short: true,
        local_path: None,
        local_name: None,
    })
}

fn collect_short_songs(value: &serde_json::Value, songs: &mut Vec<LibrarySong>) {
    if songs.len() >= 18 {
        return;
    }
    match value {
        serde_json::Value::Object(object) => {
            if let Some(model) = object.get("shortsLockupViewModel") {
                if let Some(song) = short_song(model) {
                    songs.push(song);
                }
            }
            for child in object.values() {
                collect_short_songs(child, songs);
            }
        }
        serde_json::Value::Array(array) => {
            for child in array {
                collect_short_songs(child, songs);
            }
        }
        _ => {}
    }
}

async fn search_youtube_shorts(query: &str) -> Result<Vec<LibrarySong>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/141 Safari/537.36")
        .build()
        .map_err(|error| format!("Could not start YouTube Shorts search: {error}"))?;
    let response = client
        .get("https://www.youtube.com/results")
        .query(&[("search_query", query), ("hl", "en")])
        .send()
        .await
        .map_err(|error| format!("YouTube Shorts search failed: {error}"))?
        .error_for_status()
        .map_err(|error| format!("YouTube Shorts search failed: {error}"))?
        .text()
        .await
        .map_err(|error| format!("Could not read YouTube Shorts results: {error}"))?;
    let json = ["var ytInitialData = ", "window[\"ytInitialData\"] = "]
        .into_iter()
        .find_map(|marker| first_json_object_after(&response, marker))
        .ok_or_else(|| "YouTube did not return its Shorts results".to_string())?;
    let data: serde_json::Value = serde_json::from_str(json)
        .map_err(|error| format!("Could not understand YouTube Shorts results: {error}"))?;
    let mut songs = Vec::new();
    collect_short_songs(&data, &mut songs);
    let mut seen = HashSet::new();
    songs.retain(|song| seen.insert(song.id.clone()));
    Ok(songs)
}

#[tauri::command]
pub async fn search_youtube(query: String, shorts_only: bool) -> Result<Vec<LibrarySong>, String> {
    use rusty_ytdl::search::{SearchOptions, SearchResult, SearchType, YouTube};

    let query = query.trim();
    if query.is_empty() {
        return Err("Enter something to search for".into());
    }
    if query.chars().count() > 200 || query.chars().any(char::is_control) {
        return Err("Search must be 200 characters or fewer".into());
    }

    if shorts_only {
        return search_youtube_shorts(query).await;
    }
    // Standard search should remain useful if YouTube changes the optional
    // Shorts shelf markup. The explicit Shorts-only mode still surfaces that
    // error because returning ordinary videos there would be misleading.
    let shorts = search_youtube_shorts(query).await.unwrap_or_default();
    let youtube =
        YouTube::new().map_err(|error| format!("Could not start YouTube search: {error}"))?;
    let options = SearchOptions {
        limit: 14,
        search_type: SearchType::Video,
        safe_search: false,
    };
    let results = youtube
        .search(query, Some(&options))
        .await
        .map_err(|error| format!("YouTube search failed: {error}"))?;
    let mut seen = HashSet::new();
    let mut songs = results
        .into_iter()
        .filter_map(|result| match result {
            SearchResult::Video(video) if !video.id.is_empty() => {
                let thumbnail = video
                    .thumbnails
                    .iter()
                    .max_by_key(|thumbnail| thumbnail.width.saturating_mul(thumbnail.height))
                    .map(|thumbnail| thumbnail.url.clone())
                    .unwrap_or_else(|| {
                        format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video.id)
                    });
                Some(LibrarySong {
                    id: limited(video.id, 32),
                    title: limited(video.title, 500),
                    channel: limited(video.channel.name, 300),
                    thumbnail: limited(thumbnail, 2_000),
                    views: video.views,
                    duration: video.duration as f64 / 1_000.,
                    is_short: false,
                    local_path: None,
                    local_name: None,
                })
            }
            _ => None,
        })
        .filter(|song| seen.insert(song.id.clone()))
        .collect::<Vec<_>>();
    songs.extend(
        shorts
            .into_iter()
            .filter(|song| seen.insert(song.id.clone())),
    );
    songs.truncate(18);
    Ok(songs)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YouTubeAudioPreview {
    path: String,
}

fn valid_youtube_id(id: &str) -> bool {
    id.len() == 11
        && id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
}

fn cached_audio(cache: &Path, id: &str) -> Option<(PathBuf, String)> {
    [
        ("m4a", "audio/mp4"),
        ("webm", "audio/webm"),
        ("mp3", "audio/mpeg"),
        ("ogg", "audio/ogg"),
        ("opus", "audio/ogg"),
    ]
    .into_iter()
    .find_map(|(extension, mime)| {
        let path = cache.join(format!("{id}.{extension}"));
        path.metadata()
            .is_ok_and(|metadata| metadata.len() > 0)
            .then(|| (path, mime.into()))
    })
}

fn yt_dlp_path() -> Option<PathBuf> {
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("RLCUT_YT_DLP") {
        candidates.push(PathBuf::from(path));
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(folder) = executable.parent() {
            candidates.push(folder.join(format!("yt-dlp{suffix}")));
        }
    }
    candidates.push(
        PathBuf::from(option_env!("CARGO_MANIFEST_DIR").unwrap_or("src-tauri"))
            .join("../.runtime/yt-dlp")
            .join(format!("yt-dlp{suffix}")),
    );
    if let Some(paths) = std::env::var_os("PATH") {
        candidates.extend(
            std::env::split_paths(&paths).map(|folder| folder.join(format!("yt-dlp{suffix}"))),
        );
    }
    candidates.into_iter().find(|path| {
        path.is_file()
            && crate::video::binaries::command(path)
                .arg("--version")
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .is_ok_and(|status| status.success())
    })
}

async fn download_youtube_audio_with_ytdlp(
    cache: PathBuf,
    id: String,
    executable: PathBuf,
) -> Result<(PathBuf, String), String> {
    blocking(move || {
        fs::create_dir_all(&cache)
            .map_err(|error| format!("Could not prepare the audio preview cache: {error}"))?;
        let template = cache.join(format!("{id}.%(ext)s"));
        let url = format!("https://www.youtube.com/watch?v={id}");
        let result = crate::video::binaries::command(&executable)
            .args([
                "--no-config",
                "--no-playlist",
                "--no-part",
                "--no-cache-dir",
                "--quiet",
                "--no-warnings",
                "--format",
                "bestaudio/best",
                "--output",
            ])
            .arg(&template)
            .arg(url)
            .output()
            .map_err(|error| format!("Could not start yt-dlp: {error}"))?;
        if !result.status.success() {
            let details = String::from_utf8_lossy(&result.stderr).trim().to_string();
            return Err(if details.is_empty() {
                "yt-dlp could not download this video's audio".into()
            } else {
                format!("yt-dlp could not download this video's audio: {details}")
            });
        }
        cached_audio(&cache, &id)
            .ok_or_else(|| "yt-dlp finished without creating a playable audio file".into())
    })
    .await
}

async fn download_youtube_audio(cache: PathBuf, id: String) -> Result<(PathBuf, String), String> {
    use rusty_ytdl::{
        choose_format, Video as YouTubeVideo, VideoOptions, VideoQuality, VideoSearchOptions,
    };

    if !valid_youtube_id(&id) {
        return Err("Invalid YouTube video ID".into());
    }
    if let Some(cached) = cached_audio(&cache, &id) {
        return Ok(cached);
    }
    let yt_dlp_error = if let Some(executable) = yt_dlp_path() {
        match download_youtube_audio_with_ytdlp(cache.clone(), id.clone(), executable).await {
            Ok(downloaded) => return Ok(downloaded),
            Err(error) => Some(error),
        }
    } else {
        None
    };
    fs::create_dir_all(&cache)
        .map_err(|error| format!("Could not prepare the audio preview cache: {error}"))?;
    let options = VideoOptions {
        quality: VideoQuality::HighestAudio,
        // `rusty_ytdl` may leave the signed URL empty until its deciphering
        // pass. Filtering on `format.url` here incorrectly removed every
        // otherwise valid audio stream and caused `Format not found`.
        filter: VideoSearchOptions::Audio,
        ..Default::default()
    };
    let video = YouTubeVideo::new_with_options(&id, options.clone())
        .map_err(|error| format!("Could not prepare audio preview: {error}"))?;
    let info = video
        .get_info()
        .await
        .map_err(|error| format!("Could not load audio preview: {error}"))?;
    let format = choose_format(&info.formats, &options)
        .map_err(|error| format!("No playable audio preview is available: {error}"))?;
    let container = format.mime_type.container.to_ascii_lowercase();
    let extension = match container.as_str() {
        "mp4" => "m4a",
        "ogg" => "ogg",
        "opus" => "opus",
        _ => "webm",
    };
    let mime = format.mime_type.mime.essence_str().to_string();
    let output = cache.join(format!("{id}.{extension}"));
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    let partial = cache.join(format!(".{id}-{nonce}.partial"));
    if let Err(error) = video.download(&partial).await {
        let _ = fs::remove_file(&partial);
        let fallback = yt_dlp_error.map_or_else(
            || "Install a current yt-dlp build or restart rlcut through scripts/run.sh.".into(),
            |details| format!("yt-dlp fallback also failed: {details}"),
        );
        return Err(format!(
            "Could not prepare this audio preview: {error}. {fallback}"
        ));
    }
    if output.exists() {
        let _ = fs::remove_file(&partial);
    } else {
        fs::rename(&partial, &output).map_err(|error| {
            let _ = fs::remove_file(&partial);
            format!("Could not finish the audio preview: {error}")
        })?;
    }
    Ok((output, mime))
}

#[tauri::command]
pub async fn youtube_audio_preview(
    state: State<'_, AppState>,
    id: String,
) -> Result<YouTubeAudioPreview, String> {
    let (path, _) = download_youtube_audio(state.audio_cache.clone(), id).await?;
    Ok(YouTubeAudioPreview {
        path: path.to_string_lossy().into_owned(),
    })
}

fn convert_audio_preview(
    binaries: &Binaries,
    cache: &Path,
    path: &Path,
) -> Result<Vec<u8>, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or("Audio preview file has no extension")?;
    if !matches!(
        extension.as_str(),
        "m4a" | "mp3" | "webm" | "ogg" | "opus" | "wav" | "aac" | "flac"
    ) {
        return Err("Unsupported audio preview format".into());
    }
    let metadata = path
        .metadata()
        .map_err(|error| format!("Could not open the audio preview: {error}"))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > 1024 * 1024 * 1024 {
        return Err("Audio preview must be a non-empty file smaller than 1 GB".into());
    }
    fs::create_dir_all(cache)
        .map_err(|error| format!("Could not prepare the audio preview cache: {error}"))?;
    let mut key = DefaultHasher::new();
    path.canonicalize()
        .unwrap_or_else(|_| path.to_path_buf())
        .hash(&mut key);
    metadata.len().hash(&mut key);
    metadata.modified().ok().hash(&mut key);
    let output = cache.join(format!(".browser-preview-{:x}.mp3", key.finish()));
    if !output.metadata().is_ok_and(|value| value.len() > 0) {
        let partial = output.with_extension("partial.mp3");
        let result = crate::video::binaries::command(binaries.ffmpeg()?)
            .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"])
            .arg(path)
            .args([
                "-map",
                "0:a:0",
                "-vn",
                "-ac",
                "2",
                "-ar",
                "48000",
                "-c:a",
                "libmp3lame",
                "-q:a",
                "0",
                "-write_xing",
                "1",
            ])
            .arg(&partial)
            .output()
            .map_err(|error| {
                format!("Could not start the safe audio preview converter: {error}")
            })?;
        if !result.status.success() {
            let _ = fs::remove_file(&partial);
            let details = String::from_utf8_lossy(&result.stderr).trim().to_string();
            return Err(if details.is_empty() {
                "Could not convert this audio into a safe preview".into()
            } else {
                format!("Could not convert this audio into a safe preview: {details}")
            });
        }
        fs::rename(&partial, &output).map_err(|error| {
            let _ = fs::remove_file(&partial);
            format!("Could not finish the safe audio preview: {error}")
        })?;
    }
    let bytes = fs::read(&output)
        .map_err(|error| format!("Could not read the safe audio preview: {error}"))?;
    if bytes.len() <= 128 || bytes.len() > 256 * 1024 * 1024 {
        return Err("The converted audio preview has an invalid size".into());
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn audio_preview_bytes(
    state: State<'_, AppState>,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    let binaries = state.binaries.clone();
    let cache = state.audio_cache.clone();
    let bytes =
        blocking(move || convert_audio_preview(&binaries, &cache, Path::new(&path))).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn save_youtube_audio(
    state: State<'_, AppState>,
    id: String,
    title: String,
    folder: String,
) -> Result<MusicFile, String> {
    if !valid_youtube_id(&id) {
        return Err("Invalid YouTube video ID".into());
    }
    let safe_name = title
        .chars()
        .filter(|character| character.is_alphanumeric() || matches!(character, ' ' | '-' | '_'))
        .take(120)
        .collect::<String>();
    let stem = safe_name
        .trim()
        .trim_matches(|character| matches!(character, '.' | '-'))
        .trim();
    let stem = if stem.is_empty() {
        "YouTube audio"
    } else {
        stem
    }
    .to_string();
    let folder = PathBuf::from(folder);
    if !folder.is_dir() {
        return Err("Choose an existing Music Library folder in Settings".into());
    }
    let binaries = state.binaries.clone();
    let output = folder.join(format!("{stem} [{id}].mp3"));
    if output.is_file() {
        return blocking(move || metadata::probe_music(&binaries, &output)).await;
    }
    let legacy = ["webm", "m4a", "opus", "ogg"]
        .into_iter()
        .map(|extension| folder.join(format!("{stem} [{id}].{extension}")))
        .find(|path| path.is_file());
    let source = match legacy.as_ref() {
        Some(path) => path.clone(),
        None => {
            download_youtube_audio(state.audio_cache.clone(), id.clone())
                .await?
                .0
        }
    };
    blocking(move || {
        let partial = output.with_file_name(format!(".{stem}.rlcut-partial.mp3"));
        let result = crate::video::binaries::command(binaries.ffmpeg()?)
            .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"])
            .arg(&source)
            .args([
                "-map",
                "0:a:0",
                "-vn",
                "-ac",
                "2",
                "-ar",
                "48000",
                "-c:a",
                "libmp3lame",
                "-b:a",
                "320k",
                "-id3v2_version",
                "3",
                "-write_xing",
                "1",
            ])
            .arg(&partial)
            .output()
            .map_err(|error| format!("Could not convert the downloaded audio to MP3: {error}"))?;
        if !result.status.success() {
            let _ = fs::remove_file(&partial);
            let details = String::from_utf8_lossy(&result.stderr).trim().to_string();
            return Err(if details.is_empty() {
                "Could not convert the downloaded audio to MP3".into()
            } else {
                format!("Could not convert the downloaded audio to MP3: {details}")
            });
        }
        if output.exists() {
            fs::remove_file(&output)
                .map_err(|error| format!("Could not replace the saved audio: {error}"))?;
        }
        fs::rename(&partial, &output).map_err(|error| {
            let _ = fs::remove_file(&partial);
            format!("Could not finish saving the audio file: {error}")
        })?;
        let music = metadata::probe_music(&binaries, &output)?;
        if let Some(legacy) = legacy {
            let _ = fs::remove_file(legacy);
        }
        Ok(music)
    })
    .await
}
#[tauri::command]
pub async fn music_waveform(state: State<'_, AppState>, path: String) -> Result<Vec<f32>, String> {
    let binaries = state.binaries.clone();
    blocking(move || metadata::audio_waveform(&binaries, &PathBuf::from(path))).await
}
#[tauri::command]
pub async fn pick_folder() -> Result<Option<String>, String> {
    blocking(|| {
        Ok(rfd::FileDialog::new()
            .pick_folder()
            .map(|p| p.to_string_lossy().into()))
    })
    .await
}
#[tauri::command]
pub async fn project_thumbnails(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<Vec<Option<String>>, String> {
    let binaries = state.binaries.clone();
    let cache = state.cache.clone();
    blocking(move || {
        Ok(paths
            .iter()
            .map(|path| preview::thumbnail(&binaries, &PathBuf::from(path), &cache).ok())
            .collect())
    })
    .await
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontOption {
    family: String,
    path: String,
}
#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<FontOption>, String> {
    blocking(|| {
        let output = std::process::Command::new("fc-list")
            .arg("--format=%{family[0]}|%{file}\n")
            .output()
            .map_err(|e| format!("Could not list system fonts: {e}"))?;
        if !output.status.success() {
            return Err("fontconfig could not list system fonts".into());
        }
        let mut fonts = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                let (family, path) = line.split_once('|')?;
                (!family.trim().is_empty() && std::path::Path::new(path).is_file()).then(|| {
                    FontOption {
                        family: family.trim().into(),
                        path: path.into(),
                    }
                })
            })
            .collect::<Vec<_>>();
        fonts.sort_by_key(|font| font.family.to_lowercase());
        fonts.dedup_by(|a, b| a.family.eq_ignore_ascii_case(&b.family));
        Ok(fonts)
    })
    .await
}
#[tauri::command]
pub async fn load_font_bytes(path: String) -> Result<Vec<u8>, String> {
    blocking(move || {
        let path = PathBuf::from(path);
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .ok_or("Font file has no supported extension")?;
        if !matches!(extension.as_str(), "ttf" | "otf" | "ttc" | "woff" | "woff2") {
            return Err("Font file has no supported extension".into());
        }
        let metadata = std::fs::metadata(&path)
            .map_err(|error| format!("Could not open the selected font: {error}"))?;
        if !metadata.is_file() || metadata.len() == 0 || metadata.len() > 10_000_000 {
            return Err("Font file is empty or too large".into());
        }
        let bytes = std::fs::read(path)
            .map_err(|error| format!("Could not read the selected font: {error}"))?;
        let signature = bytes.get(..4).ok_or("Font file is incomplete")?;
        if signature != b"OTTO"
            && signature != b"ttcf"
            && signature != b"wOFF"
            && signature != b"wOF2"
            && signature != [0, 1, 0, 0]
        {
            return Err("The selected file is not a supported font".into());
        }
        Ok(bytes)
    })
    .await
}
#[tauri::command]
pub async fn save_text_stamp(state: State<'_, AppState>, bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() < 33
        || bytes.len() > 16 * 1024 * 1024
        || &bytes[..8] != b"\x89PNG\r\n\x1a\n"
        || &bytes[12..16] != b"IHDR"
    {
        return Err("Invalid text image".into());
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().unwrap());
    let height = u32::from_be_bytes(bytes[20..24].try_into().unwrap());
    if width == 0
        || height == 0
        || width > 4320
        || height > 7680
        || u64::from(width) * u64::from(height) > 34_000_000
    {
        return Err("Text image exceeds the size limit".into());
    }
    let folder = state.cache.join("text-stamps");
    blocking(move || {
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        // Discard abandoned stamps from canceled dialogs/crashed apps, never a recent export.
        if let Ok(entries) = std::fs::read_dir(&folder) {
            for entry in entries.flatten() {
                if entry
                    .metadata()
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.elapsed().ok())
                    .is_some_and(|age| age.as_secs() > 7 * 86400)
                {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
        let path = folder.join(format!("{}.png", presets::id()));
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}
#[tauri::command]
pub async fn save_google_font(
    state: State<'_, AppState>,
    family: String,
    variant: String,
    bytes: Vec<u8>,
) -> Result<FontOption, String> {
    if bytes.is_empty() || bytes.len() > 10_000_000 {
        return Err("Google font file is empty or too large".into());
    }
    let safe = family
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect::<String>();
    if safe.is_empty() {
        return Err("Invalid font family".into());
    }
    let safe_variant = match variant.as_str() {
        "regular" | "bold" | "black" | "italic" | "boldItalic" | "blackItalic" => variant,
        _ => return Err("Invalid font variant".into()),
    };
    let folder = state.cache.join("fonts");
    blocking(move || {
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let path = folder.join(format!("{safe}-{safe_variant}.woff2"));
        std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
        Ok(FontOption {
            family,
            path: path.to_string_lossy().into(),
        })
    })
    .await
}
#[tauri::command]
pub async fn import_video(state: State<'_, AppState>, path: String) -> Result<Video, String> {
    state.decoder_epoch.fetch_add(1, Ordering::SeqCst);
    let b = state.binaries.clone();
    let v = blocking(move || {
        b.ffmpeg()?;
        metadata::probe(&b, &PathBuf::from(path))
    })
    .await?;
    state
        .videos
        .lock()
        .map_err(|_| "Video state busy")?
        .insert(v.path.clone(), v.clone());
    Ok(v)
}
#[tauri::command]
pub async fn create_proxy(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let video = state.video(&path)?;
    let binaries = state.binaries.clone();
    let proxy_dir = state.cache.join("proxies");
    let lock = state.proxy_lock.clone();
    let epoch = state.decoder_epoch.clone();
    let ticket = epoch.fetch_add(1, Ordering::SeqCst) + 1;
    let progress = state.preparation.clone();
    if let Ok(mut p) = progress.lock() {
        *p = Preparation::default();
    }
    let path = blocking(move || {
        let _guard = lock.lock().map_err(|_| "Decoder preparation unavailable")?;
        crate::video::decoder::prepare_progress(
            &binaries,
            &video,
            &proxy_dir,
            &epoch,
            ticket,
            |percent, elapsed, remaining| {
                if epoch.load(Ordering::SeqCst) == ticket {
                    if let Ok(mut p) = progress.lock() {
                        *p = Preparation {
                            percent,
                            elapsed,
                            remaining,
                        };
                    }
                }
            },
        )
    })
    .await?;
    Ok(path.to_string_lossy().into_owned())
}
#[tauri::command]
pub async fn create_timeline_proxy(
    state: State<'_, AppState>,
    paths: Vec<String>,
) -> Result<String, String> {
    if paths.is_empty() || paths.len() > 100 {
        return Err("A project needs between 1 and 100 video clips".into());
    }
    let videos = paths
        .iter()
        .map(|path| state.video(path))
        .collect::<Result<Vec<_>, _>>()?;
    let first = &videos[0];
    if videos.iter().any(|video| {
        let aspect_delta = (video.width as f64 / video.height as f64
            - first.width as f64 / first.height as f64)
            .abs();
        aspect_delta > 0.002 || (video.fps >= 50.) != (first.fps >= 50.)
    }) {
        return Err("Added clips must use the same aspect ratio and 30/60 FPS class".into());
    }
    let binaries = state.binaries.clone();
    let proxy_dir = state.cache.join("proxies");
    let lock = state.proxy_lock.clone();
    let epoch = state.decoder_epoch.clone();
    let ticket = epoch.fetch_add(1, Ordering::SeqCst) + 1;
    let progress = state.preparation.clone();
    if let Ok(mut value) = progress.lock() {
        *value = Preparation::default();
    }
    let path = blocking(move || {
        let _guard = lock.lock().map_err(|_| "Decoder preparation unavailable")?;
        crate::video::decoder::prepare_timeline(
            &binaries,
            &videos,
            &proxy_dir,
            &epoch,
            ticket,
            |percent, elapsed, remaining| {
                if epoch.load(Ordering::SeqCst) == ticket {
                    if let Ok(mut value) = progress.lock() {
                        *value = Preparation {
                            percent,
                            elapsed,
                            remaining,
                        };
                    }
                }
            },
        )
    })
    .await?;
    Ok(path.to_string_lossy().into_owned())
}
#[tauri::command]
pub async fn clear_cache(state: State<'_, AppState>) -> Result<(), String> {
    state.decoder_epoch.fetch_add(1, Ordering::SeqCst);
    let cache = state.cache.clone();
    let proxy_lock = state.proxy_lock.clone();
    blocking(move || {
        let _proxy_guard = proxy_lock
            .lock()
            .map_err(|_| "Preview preparation unavailable")?;
        if cache.exists() {
            std::fs::remove_dir_all(&cache).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
}
#[tauri::command]
pub fn clear_ai_cache(state: State<AppState>) -> Result<(), String> {
    // Serialize against start_export so an export cannot begin during deletion.
    let job = state.job.lock().map_err(|_| "Export state unavailable")?;
    if let Some(job) = job.as_ref() {
        if job.snapshot()?.phase == "running" {
            return Err("Wait for the export to finish before clearing its AI cache".into());
        }
    }
    crate::video::ai_cache::clear()
}
#[tauri::command]
#[allow(clippy::too_many_arguments)] // Tauri command payload mirrors the export request schema.
pub fn start_export(
    state: State<AppState>,
    paths: Vec<String>,
    preset: Preset,
    segments: Vec<Segment>,
    options: ExportOptions,
    texts: Vec<crate::model::TextOverlay>,
    music: Option<MusicTrack>,
    music_fade_out: Option<f64>,
    overwrite: bool,
) -> Result<Progress, String> {
    if let Some(m) = &music {
        m.validate()?;
    }
    preset.validate()?;
    if let Some(duration) = music_fade_out {
        if !duration.is_finite() || !(0.1..=10.).contains(&duration) {
            return Err("Music fade duration must be between 0.1 and 10 seconds".into());
        }
    }
    state.binaries.ffmpeg()?;
    if (options.ai_enhance || options.ai_upscale) && !crate::video::enhance::available() {
        return Err(
            "The optional AI engine is not installed. Use the Linux AI-enabled AppImage.".into(),
        );
    }
    if paths.is_empty() || paths.len() > 100 {
        return Err("A project needs between 1 and 100 video clips".into());
    }
    let videos = paths
        .iter()
        .map(|path| state.video(path))
        .collect::<Result<Vec<_>, _>>()?;
    let duration: f64 = videos.iter().map(|video| video.duration).sum();
    Segment::validate_all(&segments, duration)?;
    let edited_duration: f64 = segments
        .iter()
        .map(|segment| segment.end - segment.start)
        .sum();
    crate::model::TextOverlay::validate_all(&texts, edited_duration)?;
    crate::model::FlashEffect::validate_all(&options.effects, edited_duration)?;
    let stamp_root = state.cache.join("text-stamps");
    let dimensions = options.output_resolution()?;
    let mut stamp_paths = Vec::new();
    for text in &texts {
        if let Some(path) = &text.rendered_path {
            let canonical = std::fs::canonicalize(path)
                .map_err(|_| "Prepared text image is missing; retry export")?;
            if canonical.parent() != std::fs::canonicalize(&stamp_root).ok().as_deref() {
                return Err("Text image is outside the export cache".into());
            }
            let mut header = [0u8; 24];
            use std::io::Read;
            std::fs::File::open(&canonical)
                .and_then(|mut f| f.read_exact(&mut header))
                .map_err(|e| e.to_string())?;
            let width = u32::from_be_bytes(header[16..20].try_into().unwrap());
            let height = u32::from_be_bytes(header[20..24].try_into().unwrap());
            if &header[..8] != b"\x89PNG\r\n\x1a\n"
                || width == 0
                || height == 0
                || u64::from(width) + u64::from(text.rendered_x) > u64::from(dimensions.0)
                || u64::from(height) + u64::from(text.rendered_y) > u64::from(dimensions.1)
            {
                return Err("Text image is outside the export frame".into());
            }
            stamp_paths.push(canonical);
        }
    }
    let out = export::destination(&videos[0], &options, overwrite)?;
    if videos
        .iter()
        .any(|video| out.as_path() == std::path::Path::new(&video.path))
    {
        return Err("Output cannot replace a source video".into());
    }
    let mut slot = state.job.lock().map_err(|_| "Export busy")?;
    if let Some(j) = slot.as_ref() {
        if j.snapshot()?.phase == "running" {
            return Err("An export is already running".into());
        }
    }
    // A canceled job publishes its terminal state just before its worker removes
    // temporary text stamps. Reap that short cleanup tail before accepting new
    // stamps/job state, so cancel -> edit -> export cannot overlap two workers.
    if let Some(worker) = state
        .worker
        .lock()
        .map_err(|_| "Export worker unavailable")?
        .take()
    {
        worker
            .join()
            .map_err(|_| "The previous export worker stopped unexpectedly")?;
    }
    let job = Arc::new(Job::new(
        presets::id(),
        out.to_string_lossy().into(),
        overwrite,
    ));
    let result = job.snapshot()?;
    *slot = Some(job.clone());
    let b = state.binaries.clone();
    let worker = std::thread::spawn(move || {
        export::run_timeline_sources(
            b,
            videos,
            preset,
            segments,
            options,
            job,
            music,
            music_fade_out,
            texts,
        );
        for path in stamp_paths {
            let _ = std::fs::remove_file(path);
        }
    });
    *state
        .worker
        .lock()
        .map_err(|_| "Export worker unavailable")? = Some(worker);
    Ok(result)
}
#[tauri::command]
pub fn export_progress(state: State<AppState>) -> Result<Option<Progress>, String> {
    state
        .job
        .lock()
        .map_err(|_| "Export state busy")?
        .as_ref()
        .map(|j| j.snapshot())
        .transpose()
}
#[tauri::command]
pub fn cancel_export(state: State<AppState>) -> Result<(), String> {
    if let Some(j) = state.job.lock().map_err(|_| "Export state busy")?.as_ref() {
        j.cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}
#[tauri::command]
pub async fn open_export(state: State<'_, AppState>, folder: bool) -> Result<(), String> {
    let p = state
        .job
        .lock()
        .map_err(|_| "Export state busy")?
        .as_ref()
        .ok_or("No export available")?
        .snapshot()?;
    if p.phase != "complete" {
        return Err("Export is not complete".into());
    }
    blocking(move || {
        let path = PathBuf::from(p.output);
        #[cfg(target_os = "windows")]
        let mut c = {
            let mut command = std::process::Command::new("explorer.exe");
            if folder {
                command.arg("/select,").arg(&path);
            } else {
                command.arg(&path);
            }
            command
        };
        #[cfg(target_os = "macos")]
        let mut c = {
            let mut command = std::process::Command::new("open");
            if folder {
                command.arg("-R");
            }
            command.arg(&path);
            command
        };
        #[cfg(target_os = "linux")]
        if folder
            && std::process::Command::new("nautilus")
                .arg("--select")
                .arg(&path)
                .spawn()
                .is_ok()
        {
            return Ok(());
        }
        #[cfg(target_os = "linux")]
        let mut c = {
            let mut command = std::process::Command::new("xdg-open");
            command.arg(if folder {
                path.parent().ok_or("Output folder missing")?
            } else {
                &path
            });
            command
        };
        c.spawn().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn import_preset() -> Result<Option<Preset>, String> {
    blocking(|| {
        match rfd::FileDialog::new()
            .add_filter("rlcut preset", &["json"])
            .pick_file()
        {
            Some(p) => presets::import(&p).map(Some),
            None => Ok(None),
        }
    })
    .await
}
#[tauri::command]
pub async fn export_preset(preset: Preset) -> Result<bool, String> {
    blocking(move || {
        preset.validate()?;
        match rfd::FileDialog::new()
            .add_filter("rlcut preset", &["json"])
            .set_file_name("rlcut-preset.json")
            .save_file()
        {
            Some(p) => {
                presets::export(&p, &preset)?;
                Ok(true)
            }
            None => Ok(false),
        }
    })
    .await
}

fn validate_project(project: &serde_json::Value) -> Result<(), String> {
    let object = project.as_object().ok_or("Invalid rlcut project")?;
    if object.get("version").and_then(|value| value.as_u64()) != Some(1)
        || object
            .get("id")
            .and_then(|value| value.as_str())
            .is_none_or(str::is_empty)
        || object
            .get("name")
            .and_then(|value| value.as_str())
            .is_none_or(str::is_empty)
        || object
            .get("videoPaths")
            .and_then(|value| value.as_array())
            .is_none()
        || object
            .get("segments")
            .and_then(|value| value.as_array())
            .is_none()
        || object
            .get("preset")
            .and_then(|value| value.as_object())
            .is_none()
        || object
            .get("markers")
            .and_then(|value| value.as_object())
            .is_none()
        || object
            .get("quality")
            .and_then(|value| value.as_u64())
            .is_none()
        || object.get("fps").and_then(|value| value.as_u64()).is_none()
    {
        return Err("This is not a supported rlcut project".into());
    }
    let size = serde_json::to_vec(project)
        .map_err(|error| error.to_string())?
        .len();
    if size > 2_000_000 {
        return Err("Project file is too large".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn import_project() -> Result<Option<serde_json::Value>, String> {
    blocking(|| {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("rlcut project", &["rlcut", "json"])
            .pick_file()
        else {
            return Ok(None);
        };
        let metadata = std::fs::metadata(&path).map_err(|error| error.to_string())?;
        if metadata.len() > 2_000_000 {
            return Err("Project file is too large".into());
        }
        let project: serde_json::Value =
            serde_json::from_slice(&std::fs::read(path).map_err(|error| error.to_string())?)
                .map_err(|error| format!("Cannot read project: {error}"))?;
        validate_project(&project)?;
        Ok(Some(project))
    })
    .await
}

#[tauri::command]
pub async fn export_project(project: serde_json::Value) -> Result<bool, String> {
    blocking(move || {
        validate_project(&project)?;
        let name = project
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("rlcut-project");
        let safe = name
            .chars()
            .map(|character| {
                if character.is_ascii_alphanumeric() || matches!(character, '-' | '_') {
                    character
                } else {
                    '-'
                }
            })
            .collect::<String>();
        let Some(path) = rfd::FileDialog::new()
            .add_filter("rlcut project", &["rlcut"])
            .set_file_name(format!("{}.rlcut", safe.trim_matches('-')))
            .save_file()
        else {
            return Ok(false);
        };
        let bytes = serde_json::to_vec_pretty(&project).map_err(|error| error.to_string())?;
        std::fs::write(path, bytes).map_err(|error| error.to_string())?;
        Ok(true)
    })
    .await
}

struct PlayerSlot {
    session: u64,
    player: Option<crate::video::player::Player>,
}
#[derive(Clone, Default, Serialize)]
pub struct Preparation {
    percent: f64,
    elapsed: f64,
    remaining: Option<f64>,
}
#[tauri::command]
pub fn preparation_progress(state: State<AppState>) -> Result<Preparation, String> {
    state
        .preparation
        .lock()
        .map(|p| p.clone())
        .map_err(|_| "Preparation progress unavailable".into())
}
#[tauri::command]
pub async fn playback_open(
    state: State<'_, AppState>,
    session: u64,
    path: String,
    time: f64,
    segments: Vec<Segment>,
    max_edge: Option<u32>,
) -> Result<(), String> {
    let cache = state
        .cache
        .join("proxies")
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let file = PathBuf::from(path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    if !file.starts_with(&cache) || file.extension().is_none_or(|s| s != "mp4") {
        return Err("Playback source must be a prepared recording".into());
    }
    validate_segments(&segments)?;
    let tools = state.binaries.clone();
    let slot = state.player.clone();
    blocking(move || {
        let mut slot = slot.lock().map_err(|_| "Native player unavailable")?;
        if session < slot.session {
            return Err("Playback session superseded".into());
        }
        let metadata = metadata::probe(&tools, &file)?;
        // A 640 px RGBA source is sharp enough for the interactive preview
        // while keeping 60 FPS IPC payloads under 1 MB for 16:9 recordings.
        // Export continues to use the original recording at full resolution.
        // Software composition needs fewer bytes per frame; existing clients
        // retain the 640px default. No prepared files or exports are resized.
        let max_edge = max_edge.unwrap_or(640).clamp(320, 640);
        let scale = (max_edge as f64 / metadata.width.max(metadata.height) as f64).min(1.);
        let w = ((metadata.width as f64 * scale / 2.).round() as u32 * 2).max(2);
        let h = ((metadata.height as f64 * scale / 2.).round() as u32 * 2).max(2);
        let player =
            crate::video::player::Player::open(&file.to_string_lossy(), w, h, time, segments)?;
        slot.player = Some(player);
        slot.session = session;
        Ok(())
    })
    .await
}
fn validate_segments(segments: &[Segment]) -> Result<(), String> {
    if segments.is_empty()
        || segments.len() > 10000
        || segments
            .iter()
            .any(|s| !s.start.is_finite() || !s.end.is_finite() || s.start < 0. || s.end <= s.start)
    {
        return Err("Invalid playback timeline".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn playback_control(
    state: State<'_, AppState>,
    session: u64,
    playing: Option<bool>,
    time: Option<f64>,
    segments: Option<Vec<Segment>>,
    music: Option<MusicTrack>,
) -> Result<(), String> {
    if time.is_some_and(|t| !t.is_finite() || t < 0.) {
        return Err("Invalid playback position".into());
    }
    if let Some(s) = segments.as_ref() {
        validate_segments(s)?;
    }
    let slot = state.player.clone();
    blocking(move || {
        let mut slot = slot.lock().map_err(|_| "Native player unavailable")?;
        if slot.session != session {
            return Ok(());
        }
        if let Some(p) = slot.player.as_mut() {
            if let Some(music) = music {
                p.music(music)?;
            }
            if let Some(segments) = segments {
                p.segments(segments)?;
            }
            if let Some(time) = time {
                p.seek(time)?;
            }
            if let Some(playing) = playing {
                p.play(playing)?;
            }
        }
        Ok(())
    })
    .await
}
#[tauri::command]
pub async fn playback_frame(
    state: State<'_, AppState>,
    session: u64,
    last: u32,
) -> Result<tauri::ipc::Response, String> {
    let player = state.player.clone();
    let packet = blocking(move || {
        let slot = player.lock().map_err(|_| "Native player unavailable")?;
        if slot.session != session {
            return Ok(Vec::new());
        }
        slot.player
            .as_ref()
            .ok_or("Native player is not open")?
            .frame(last)
    })
    .await?;
    Ok(tauri::ipc::Response::new(packet))
}
#[tauri::command]
pub async fn playback_close(state: State<'_, AppState>, session: u64) -> Result<(), String> {
    let slot = state.player.clone();
    blocking(move || {
        let mut slot = slot.lock().map_err(|_| "Native player unavailable")?;
        if slot.session == session {
            slot.player.take();
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub fn cancel_preparation(state: State<AppState>) {
    state.decoder_epoch.fetch_add(1, Ordering::SeqCst);
}

#[cfg(test)]
mod youtube_audio_tests {
    use super::*;

    #[test]
    fn shorts_parser_only_accepts_youtube_shorts_cards() {
        let data = serde_json::json!({
            "contents": [
                { "videoRenderer": { "videoId": "landscape01", "lengthText": { "simpleText": "0:14" } } },
                { "shortsLockupViewModel": {
                    "onTap": { "innertubeCommand": { "reelWatchEndpoint": {
                        "videoId": "shortsId001",
                        "thumbnail": { "thumbnails": [{ "url": "https://i.ytimg.com/vi/shortsId001/oar2.jpg", "width": 405, "height": 720 }] }
                    } } },
                    "overlayMetadata": { "primaryText": { "content": "A real Short" } }
                } }
            ]
        });
        let mut songs = Vec::new();
        collect_short_songs(&data, &mut songs);
        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].id, "shortsId001");
        assert!(songs[0].is_short);
        assert!(songs[0].thumbnail.contains("oar2.jpg"));
    }

    #[test]
    #[ignore = "requires live YouTube network access"]
    fn finds_actual_youtube_shorts_cards() {
        let songs = tauri::async_runtime::block_on(search_youtube_shorts("rocket league edit"))
            .expect("YouTube Shorts search should work");
        assert!(!songs.is_empty(), "YouTube returned no Shorts cards");
        assert!(songs.iter().all(|song| song.is_short));
        assert!(songs.iter().all(|song| valid_youtube_id(&song.id)));
    }

    #[test]
    #[ignore = "requires live YouTube network access"]
    fn downloads_playable_audio_by_video_id() {
        let root = std::env::temp_dir().join(format!(
            "rlcut-youtube-audio-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let id =
            std::env::var("RLCUT_YOUTUBE_TEST_ID").unwrap_or_else(|_| "jNQXAC9IVRw".to_string());
        let result = tauri::async_runtime::block_on(download_youtube_audio(root.clone(), id));
        let (path, mime) = result.expect("YouTube audio should download");
        let size = path.metadata().expect("downloaded file metadata").len();
        assert!(
            size > 16_384,
            "downloaded audio is unexpectedly small: {size}"
        );
        assert!(mime.starts_with("audio/"), "unexpected MIME type: {mime}");
        assert!(path.starts_with(&root), "download escaped its cache folder");
        let ffprobe = std::env::var_os("RLCUT_FFPROBE").unwrap_or_else(|| "ffprobe".into());
        let probe = std::process::Command::new(ffprobe)
            .args([
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=codec_name",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
            ])
            .arg(&path)
            .output()
            .expect("ffprobe should inspect downloaded audio");
        assert!(probe.status.success(), "ffprobe rejected downloaded audio");
        assert!(
            !String::from_utf8_lossy(&probe.stdout).trim().is_empty(),
            "downloaded file has no decodable audio stream"
        );
        let binaries = Binaries::detect(Path::new(""));
        let preview = convert_audio_preview(&binaries, &root, &path)
            .expect("downloaded audio should convert into a safe browser preview");
        assert!(preview.len() > 1024, "preview MP3 is unexpectedly small");
        assert!(
            preview.len() <= 256 * 1024 * 1024,
            "preview exceeds its bounded IPC size"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn long_audio_preview_preserves_duration_and_is_seekable() {
        let root = std::env::temp_dir().join(format!(
            "rlcut-long-audio-preview-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("temporary preview folder");
        let binaries = Binaries::detect(Path::new(""));
        let source = root.join("five-minutes.wav");
        let generated = crate::video::binaries::command(binaries.ffmpeg().expect("ffmpeg"))
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000:duration=305",
                "-c:a",
                "pcm_s16le",
                "-y",
            ])
            .arg(&source)
            .status()
            .expect("generate long audio fixture");
        assert!(generated.success(), "could not generate long audio fixture");
        let bytes = convert_audio_preview(&binaries, &root, &source)
            .expect("long audio should convert into a complete browser preview");
        assert!(bytes.len() > 1024, "preview MP3 is unexpectedly small");
        let preview = fs::read_dir(&root)
            .expect("preview cache")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .find(|path| path.extension().is_some_and(|extension| extension == "mp3"))
            .expect("cached browser preview MP3");
        let duration = crate::video::binaries::command(binaries.ffprobe().expect("ffprobe"))
            .args([
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
            ])
            .arg(&preview)
            .output()
            .expect("probe complete preview duration");
        assert!(duration.status.success(), "ffprobe rejected preview MP3");
        let seconds: f64 = String::from_utf8_lossy(&duration.stdout)
            .trim()
            .parse()
            .expect("numeric preview duration");
        assert!(
            (seconds - 305.).abs() < 0.25,
            "preview was truncated to {seconds}s"
        );
        let seeked = crate::video::binaries::command(binaries.ffmpeg().expect("ffmpeg"))
            .args(["-hide_banner", "-loglevel", "error", "-ss", "217", "-i"])
            .arg(&preview)
            .args(["-t", "0.2", "-f", "null", "-"])
            .status()
            .expect("seek inside preview");
        assert!(
            seeked.success(),
            "preview could not seek past the former 90-second cap"
        );
        let _ = fs::remove_dir_all(root);
    }
}
