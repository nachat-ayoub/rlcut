use crate::{
    model::{ExportOptions, MusicFile, MusicTrack, Preset, Segment, Video},
    presets,
    settings::{self, Store},
    video::{
        binaries::Binaries,
        export::{self, Job, Progress},
        metadata,
    },
};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::State;
pub struct AppState {
    file: PathBuf,
    cache: PathBuf,
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
    store: Store,
    binaries: Binaries,
    storage_error: Option<String>,
}
#[tauri::command]
pub fn initialize(state: State<AppState>) -> Init {
    let (store, error) = match settings::load(&state.file) {
        Ok(s) => (s, None),
        Err(e) => (Store::default(), Some(e)),
    };
    Init {
        store,
        binaries: state.binaries.clone(),
        storage_error: error,
    }
}
#[tauri::command]
pub fn save_store(state: State<AppState>, store: Store) -> Result<(), String> {
    let _lock = state.store_lock.lock().map_err(|_| "Settings busy")?;
    settings::save(&state.file, &store)
}
#[tauri::command]
pub async fn pick_video() -> Result<Option<String>, String> {
    blocking(|| {
        Ok(rfd::FileDialog::new()
            .add_filter("Video", &["mp4", "mov", "mkv", "webm"])
            .pick_file()
            .map(|p| p.to_string_lossy().into()))
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
                &["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"],
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
pub async fn pick_folder() -> Result<Option<String>, String> {
    blocking(|| {
        Ok(rfd::FileDialog::new()
            .pick_folder()
            .map(|p| p.to_string_lossy().into()))
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
pub fn start_export(
    state: State<AppState>,
    path: String,
    preset: Preset,
    segments: Vec<Segment>,
    options: ExportOptions,
    music: Option<MusicTrack>,
    music_fade_out: Option<f64>,
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
    let v = state.video(&path)?;
    Segment::validate_all(&segments, v.duration)?;
    let out = export::destination(&v, &options)?;
    let mut slot = state.job.lock().map_err(|_| "Export busy")?;
    if let Some(j) = slot.as_ref() {
        if j.snapshot()?.phase == "running" {
            return Err("An export is already running".into());
        }
    }
    let job = Arc::new(Job::new(presets::id(), out.to_string_lossy().into()));
    let result = job.snapshot()?;
    *slot = Some(job.clone());
    let b = state.binaries.clone();
    let worker = std::thread::spawn(move || {
        export::run_timeline(b, v, preset, segments, options, job, music, music_fade_out)
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
        let target = if folder {
            path.parent().ok_or("Output folder missing")?.to_path_buf()
        } else {
            path
        };
        #[cfg(target_os = "windows")]
        let mut c = std::process::Command::new("explorer.exe");
        #[cfg(target_os = "macos")]
        let mut c = std::process::Command::new("open");
        #[cfg(target_os = "linux")]
        let mut c = std::process::Command::new("xdg-open");
        c.arg(target).spawn().map_err(|e| e.to_string())?;
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
        let scale = (640. / metadata.width.max(metadata.height) as f64).min(1.);
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
        || segments.windows(2).any(|s| s[0].end > s[1].start)
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
