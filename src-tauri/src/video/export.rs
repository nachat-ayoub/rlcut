use super::{
    args::{export_args_timeline_sources, progress_seconds},
    binaries::{command, Binaries},
};
use crate::model::{ExportOptions, MusicTrack, Preset, Segment, SfxTrack, TextOverlay, Video};
#[cfg(feature = "serialization")]
use serde::Serialize;
use std::{
    fs,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::Path,
    process::Stdio,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
#[derive(Clone)]
#[cfg_attr(feature = "serialization", derive(Serialize))]
#[cfg_attr(feature = "serialization", serde(rename_all = "camelCase"))]
pub struct Progress {
    pub id: String,
    pub phase: String,
    pub percent: f64,
    pub elapsed: f64,
    pub remaining: Option<f64>,
    pub output: String,
    pub error: Option<String>,
    pub stage: Option<String>,
    pub warning: Option<String>,
}
pub struct Job {
    pub cancel: AtomicBool,
    pub started: Instant,
    pub overwrite: bool,
    pub progress: Mutex<Progress>,
}
impl Job {
    pub fn new(id: String, output: String, overwrite: bool) -> Self {
        Self {
            cancel: AtomicBool::new(false),
            started: Instant::now(),
            overwrite,
            progress: Mutex::new(Progress {
                id,
                phase: "running".into(),
                percent: 0.,
                elapsed: 0.,
                remaining: None,
                output,
                error: None,
                stage: None,
                warning: None,
            }),
        }
    }
    pub fn snapshot(&self) -> Result<Progress, String> {
        self.progress
            .lock()
            .map(|p| p.clone())
            .map_err(|_| "Export progress unavailable".into())
    }
}
pub fn destination(
    v: &Video,
    o: &ExportOptions,
    overwrite: bool,
) -> Result<std::path::PathBuf, String> {
    o.resolution()?;
    let name = o.filename.trim();
    if name.is_empty()
        || name.len() > 200
        || name
            .chars()
            .any(|c| c.is_control() || "/\\:\"<>|?*".contains(c))
        || name == "."
        || name == ".."
        || name.ends_with(' ')
        || !name.to_lowercase().ends_with(".mp4")
    {
        return Err("Choose a filename ending in .mp4 without path separators".into());
    }
    let folder = Path::new(&o.folder)
        .canonicalize()
        .map_err(|e| format!("Output folder is unavailable: {e}"))?;
    if !folder.is_dir() {
        return Err("Select an output folder".into());
    }
    let out = folder.join(name);
    if out.exists() && !overwrite {
        return Err("OUTPUT_EXISTS".into());
    }
    if out == Path::new(&v.path) {
        return Err("Output cannot replace the source video".into());
    }
    Ok(out)
}
pub fn run(b: Binaries, v: Video, p: Preset, o: ExportOptions, job: Arc<Job>) {
    let duration = v.duration;
    run_segments(
        b,
        v,
        p,
        vec![Segment {
            start: 0.,
            end: duration,
            volume: 1.,
            color_fix: 0.,
        }],
        o,
        job,
    )
}
pub fn run_segments(
    b: Binaries,
    v: Video,
    p: Preset,
    segments: Vec<Segment>,
    o: ExportOptions,
    job: Arc<Job>,
) {
    run_timeline(b, v, p, segments, o, job, None, None, Vec::new(), Vec::new())
}
#[allow(clippy::too_many_arguments)] // Worker entry point carries the complete export snapshot.
pub fn run_timeline(
    b: Binaries,
    v: Video,
    p: Preset,
    segments: Vec<Segment>,
    o: ExportOptions,
    job: Arc<Job>,
    music: Option<MusicTrack>,
    music_fade_out: Option<f64>,
    sfx: Vec<SfxTrack>,
    texts: Vec<TextOverlay>,
) {
    run_timeline_sources(
        b,
        vec![v],
        p,
        segments,
        o,
        job,
        music,
        music_fade_out,
        sfx,
        texts,
    )
}
#[allow(clippy::too_many_arguments)] // Worker entry point carries the complete export snapshot.
pub fn run_timeline_sources(
    b: Binaries,
    videos: Vec<Video>,
    p: Preset,
    segments: Vec<Segment>,
    o: ExportOptions,
    job: Arc<Job>,
    music: Option<MusicTrack>,
    music_fade_out: Option<f64>,
    sfx: Vec<SfxTrack>,
    texts: Vec<TextOverlay>,
) {
    let start = Instant::now();
    let snapshot = match job.snapshot() {
        Ok(s) => s,
        Err(_) => return,
    };
    let out = std::path::PathBuf::from(&snapshot.output);
    let partial = out.with_file_name(format!(".rlcut-{}.partial.mp4", snapshot.id));
    let log = partial.with_extension("log");
    let rendered = partial.with_extension("render.mp4");
    let enhanced = o.ai_enhance || o.ai_upscale;
    let result = (|| -> Result<(), String> {
        if enhanced && !super::enhance::available() {
            return Err("Optional AI engine is unavailable".into());
        }
        fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&log)
            .map_err(|e| format!("Cannot write export diagnostics: {e}"))?;
        #[cfg(feature = "serialization")]
        if enhanced {
            super::ai_cache::run(
                &b,
                &videos,
                &p,
                &segments,
                &o,
                &partial,
                job.clone(),
                music.as_ref(),
                music_fade_out,
                &sfx,
                &texts,
                start,
                &log,
            )?;
        } else {
            let duration = segments.iter().map(|s| s.end - s.start).sum();
            execute(
                &b,
                export_args_timeline_sources(
                    &videos,
                    &p,
                    &segments,
                    &o,
                    &partial,
                    music.as_ref(),
                    music_fade_out,
                    &sfx,
                    &texts,
                )?,
                &log,
                duration,
                job.clone(),
                start,
                0.,
                99.9,
                false,
            )?;
        }
        #[cfg(not(feature = "serialization"))]
        {
            let duration = segments.iter().map(|s| s.end - s.start).sum();
            execute(
                &b,
                export_args_timeline_sources(
                    &videos,
                    &p,
                    &segments,
                    &o,
                    &partial,
                    music.as_ref(),
                    music_fade_out,
                    &sfx,
                    &texts,
                )?,
                &log,
                duration,
                job.clone(),
                start,
                0.,
                99.9,
                false,
            )?;
        }
        if job.cancel.load(Ordering::SeqCst) {
            return Err("Export canceled".into());
        }
        if job.overwrite {
            #[cfg(target_os = "windows")]
            if out.exists() {
                fs::remove_file(&out)
                    .map_err(|e| format!("Could not replace existing output: {e}"))?;
            }
            fs::rename(&partial, &out)
                .map_err(|e| format!("Could not replace existing output: {e}"))?;
        } else {
            // Atomic, no-clobber publication in the same folder.
            fs::hard_link(&partial,&out).map_err(|e|format!("Could not publish output safely: {e}. Choose a local filesystem that supports hard links."))?;
        }
        Ok(())
    })();
    let _ = fs::remove_file(&partial);
    let _ = fs::remove_file(&rendered);
    // Preserve useful diagnostics in the reported error before cleanup.
    let result = result.map_err(|error| {
        if job.cancel.load(Ordering::SeqCst) {
            return error;
        }
        let detail = fs::File::open(&log)
            .and_then(|mut f| {
                let len = f.metadata()?.len();
                f.seek(SeekFrom::Start(len.saturating_sub(2000)))?;
                let mut text = String::new();
                f.read_to_string(&mut text)?;
                Ok(text)
            })
            .unwrap_or_default();
        format!("{error} {detail}")
    });
    let _ = fs::remove_file(&log);
    if let Ok(mut s) = job.progress.lock() {
        s.elapsed = start.elapsed().as_secs_f64();
        s.remaining = None;
        match result {
            Ok(()) => {
                s.phase = "complete".into();
                s.percent = 100.;
            }
            Err(e) => {
                s.phase = if job.cancel.load(Ordering::SeqCst) {
                    "canceled"
                } else {
                    "failed"
                }
                .into();
                s.error = Some(e);
            }
        }
    }
}
/// Run an existing FFmpeg pipeline with cancellation, a live clock and stage ranges.
#[allow(clippy::too_many_arguments)] // Process supervision needs explicit progress-stage parameters.
pub fn execute(
    b: &Binaries,
    args: Vec<String>,
    log: &Path,
    duration: f64,
    job: Arc<Job>,
    start: Instant,
    base: f64,
    span: f64,
    low_priority: bool,
) -> Result<(), String> {
    let mut command = command(b.ffmpeg()?);
    if low_priority {
        super::enhance::low_pressure(&mut command, false);
    }
    let mut child = command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(
            fs::OpenOptions::new()
                .append(true)
                .open(log)
                .map_err(|e| e.to_string())?,
        )
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Missing FFmpeg progress stream")?;
    let progress_job = job.clone();
    let stage_start = Instant::now();
    let reader = thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(seconds) = progress_seconds(&line) {
                if let Ok(mut p) = progress_job.progress.lock() {
                    p.percent = (base + seconds / duration * span).clamp(base, base + span);
                    p.elapsed = start.elapsed().as_secs_f64();
                    p.remaining = if seconds > 0. {
                        Some(
                            (duration - seconds).max(0.) * stage_start.elapsed().as_secs_f64()
                                / seconds,
                        )
                    } else {
                        None
                    };
                }
            }
        }
    });
    let result = loop {
        if job.cancel.load(Ordering::SeqCst) {
            let _ = child.kill();
            let _ = child.wait();
            break Err("Export canceled".into());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                break if status.success() {
                    Ok(())
                } else {
                    Err("FFmpeg processing failed".into())
                }
            }
            Ok(None) => {
                if let Ok(mut p) = job.progress.lock() {
                    p.elapsed = start.elapsed().as_secs_f64();
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(e.to_string());
            }
        }
    };
    let _ = reader.join();
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (std::path::PathBuf, Video, ExportOptions) {
        let dir = std::env::temp_dir().join(format!(
            "rlcut-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let v = Video {
            path: dir.join("source.mp4").to_string_lossy().into(),
            width: 1920,
            height: 1080,
            duration: 3.,
            fps: 30.,
            has_audio: false,
            color_transfer: String::new(),
        };
        let o = ExportOptions {
            ai_enhance: false,
            ai_upscale: false,
            ai_upscale_lite: false,
            ai_keep_resolution: false,
            effects: Vec::new(),
            quality: 480,
            fps: 30,
            folder: dir.to_string_lossy().into(),
            filename: "short.mp4".into(),
        };
        (dir, v, o)
    }
    #[test]
    fn protects_existing_files_and_paths() {
        let (dir, v, mut o) = fixture();
        fs::write(dir.join("short.mp4"), b"existing video").unwrap();
        assert!(destination(&v, &o, false).is_err());
        assert!(destination(&v, &o, true).is_ok());
        o.filename = "../source.mp4".into();
        assert!(destination(&v, &o, false).is_err());
        assert_eq!(fs::read(dir.join("short.mp4")).unwrap(), b"existing video");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn failure_cleans_partial_files() {
        let (dir, v, o) = fixture();
        let out = destination(&v, &o, false).unwrap();
        let job = Arc::new(Job::new(
            "failed".into(),
            out.to_string_lossy().into(),
            false,
        ));
        run_segments(
            Binaries {
                ffmpeg: None,
                ffprobe: None,
                ffplay: None,
            },
            v,
            Preset::default(),
            vec![Segment {
                start: 0.,
                end: 3.,
                volume: 1.,
                color_fix: 0.,
            }],
            o,
            job.clone(),
        );
        assert_eq!(job.snapshot().unwrap().phase, "failed");
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 0);
        fs::remove_dir_all(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn cancellation_kills_and_cleans_output() {
        use std::os::unix::fs::PermissionsExt;
        let (dir, v, o) = fixture();
        let binary = dir.join("fake-ffmpeg");
        // Stand-in process exercises cancellation/cleanup independently of encoder availability.
        fs::write(&binary,b"#!/bin/sh\nfor arg do last=\"$arg\"; done\n: > \"$last\"\nprintf 'out_time_us=1000000\\nprogress=continue\\n'\nexec sleep 30\n").unwrap();
        fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).unwrap();
        let out = destination(&v, &o, false).unwrap();
        let job = Arc::new(Job::new(
            "cancel".into(),
            out.to_string_lossy().into(),
            false,
        ));
        let worker_job = job.clone();
        let worker = thread::spawn(move || {
            run_segments(
                Binaries {
                    ffmpeg: Some(binary),
                    ffprobe: None,
                    ffplay: None,
                },
                v,
                Preset::default(),
                vec![Segment {
                    start: 0.,
                    end: 3.,
                    volume: 1.,
                    color_fix: 0.,
                }],
                o,
                worker_job,
            )
        });
        let deadline = Instant::now() + Duration::from_secs(3);
        while job.snapshot().unwrap().percent == 0. && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
        }
        assert!(job.snapshot().unwrap().percent > 0.);
        job.cancel.store(true, Ordering::SeqCst);
        worker.join().unwrap();
        assert_eq!(job.snapshot().unwrap().phase, "canceled");
        assert!(!out.exists());
        assert!(!dir.join(".rlcut-cancel.partial.mp4").exists());
        assert!(!dir.join(".rlcut-cancel.partial.log").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
