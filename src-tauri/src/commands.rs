use crate::{
    model::{ExportOptions, Preset, Segment, Video},
    presets,
    settings::{self, Store},
    video::{
        binaries::Binaries,
        export::{self, Job, Progress},
        metadata, preview as frames,
    },
};
use serde::Serialize;
use std::{
    collections::HashMap,
    hash::{DefaultHasher, Hash, Hasher},
    path::PathBuf,
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
use tauri::State;
pub struct AppState {
    pub epoch: Arc<AtomicU64>,
    file: PathBuf,
    cache: PathBuf,
    binaries: Binaries,
    videos: Mutex<HashMap<String, Video>>,
    store_lock: Mutex<()>,
    preview_lock: Arc<Mutex<()>>,
    pub job: Arc<Mutex<Option<Arc<Job>>>>,
    pub worker: Mutex<Option<std::thread::JoinHandle<()>>>,
}
impl AppState {
    pub fn new(file: PathBuf, cache: PathBuf, binaries: Binaries) -> Self {
        Self {
            epoch: Arc::new(AtomicU64::new(0)),
            file,
            cache,
            binaries,
            videos: Mutex::new(HashMap::new()),
            store_lock: Mutex::new(()),
            preview_lock: Arc::new(Mutex::new(())),
            job: Arc::new(Mutex::new(None)),
            worker: Mutex::new(None),
        }
    }
    pub fn shutdown(&self) {
        self.epoch.fetch_add(1, Ordering::SeqCst);
        if let Ok(job) = self.job.lock() {
            if let Some(j) = job.as_ref() {
                j.cancel.store(true, Ordering::SeqCst);
            }
        }
        let _preview_guard = self.preview_lock.lock().ok();
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
    blocking(move || {
        std::fs::create_dir_all(&proxy_dir).map_err(|e| e.to_string())?;
        let mut hasher = DefaultHasher::new();
        "proxy-v2".hash(&mut hasher);
        video.path.hash(&mut hasher);
        std::fs::metadata(&video.path)
            .ok()
            .and_then(|m| m.modified().ok())
            .hash(&mut hasher);
        let output = proxy_dir.join(format!("proxy-{:x}.mp4", hasher.finish()));
        if output.is_file() && output.metadata().is_ok_and(|m| m.len() > 0) {
            return Ok(output.to_string_lossy().into_owned());
        }
        let partial = output.with_extension("partial.mp4");
        let mut process = crate::video::binaries::command(binaries.ffmpeg()?);
        process
            .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i"])
            .arg(&video.path)
            .args([
                "-map",
                "0:v:0",
                "-vf",
                "scale='min(960,iw)':-2:flags=fast_bilinear,fps=30",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-crf",
                "28",
                "-g",
                "15",
                "-keyint_min",
                "15",
                "-sc_threshold",
                "0",
                "-pix_fmt",
                "yuv420p",
            ]);
        if video.has_audio {
            process.args(["-map", "0:a:0?", "-c:a", "aac", "-b:a", "96k"]);
        } else {
            process.arg("-an");
        }
        let status = process
            .args(["-movflags", "+faststart"])
            .arg(&partial)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .map_err(|e| format!("Cannot create preview proxy: {e}"))?;
        if !status.status.success() {
            let _ = std::fs::remove_file(&partial);
            return Err(format!(
                "Could not create preview proxy: {}",
                String::from_utf8_lossy(&status.stderr)
            ));
        }
        std::fs::rename(&partial, &output).map_err(|e| e.to_string())?;
        Ok(output.to_string_lossy().into_owned())
    })
    .await
}
#[tauri::command]
pub fn invalidate_preview(state: State<AppState>) {
    state.epoch.fetch_add(1, Ordering::SeqCst);
}
#[tauri::command]
pub async fn preview(
    state: State<'_, AppState>,
    path: String,
    preset: Preset,
    timestamp: f64,
    quality: u32,
) -> Result<frames::Preview, String> {
    let v = state.video(&path)?;
    let b = state.binaries.clone();
    let cache = state.cache.clone();
    let epoch = state.epoch.clone();
    let lock = state.preview_lock.clone();
    let ticket = epoch.fetch_add(1, Ordering::SeqCst) + 1;
    blocking(move || {
        let _guard = lock.lock().map_err(|_| "Preview unavailable")?;
        if epoch.load(Ordering::SeqCst) != ticket {
            return Err("Preview superseded".into());
        }
        frames::render(&b, &v, &preset, timestamp, quality, &cache, &epoch, ticket)
    })
    .await
}
#[tauri::command]
pub async fn clear_cache(state: State<'_, AppState>) -> Result<(), String> {
    state.epoch.fetch_add(1, Ordering::SeqCst);
    let cache = state.cache.clone();
    let lock = state.preview_lock.clone();
    blocking(move || {
        let _guard = lock.lock().map_err(|_| "Preview unavailable")?;
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
) -> Result<Progress, String> {
    preset.validate()?;
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
    let worker =
        std::thread::spawn(move || export::run_segments(b, v, preset, segments, options, job));
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
