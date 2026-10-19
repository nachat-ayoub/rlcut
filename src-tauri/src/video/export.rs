use super::{
    args::{export_args_timeline_sources, progress_seconds},
    binaries::{command, Binaries},
};
use crate::model::{ExportOptions, MusicTrack, Preset, Segment, TextOverlay, Video};
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
}
pub struct Job {
    pub cancel: AtomicBool,
    pub overwrite: bool,
    pub progress: Mutex<Progress>,
}
impl Job {
    pub fn new(id: String, output: String, overwrite: bool) -> Self {
        Self {
            cancel: AtomicBool::new(false),
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
    run_timeline(b, v, p, segments, o, job, None, None, Vec::new())
}
pub fn run_timeline(
    b: Binaries,
    v: Video,
    p: Preset,
    segments: Vec<Segment>,
    o: ExportOptions,
    job: Arc<Job>,
    music: Option<MusicTrack>,
    music_fade_out: Option<f64>,
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
        texts,
    )
}
pub fn run_timeline_sources(
    b: Binaries,
    videos: Vec<Video>,
    p: Preset,
    segments: Vec<Segment>,
    o: ExportOptions,
    job: Arc<Job>,
    music: Option<MusicTrack>,
    music_fade_out: Option<f64>,
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
    let result = (|| -> Result<(), String> {
        if o.ai_enhance && !super::enhance::available() {
            return Err("Optional AI engine is unavailable".into());
        }
        let mut render_options = o.clone();
        if o.ai_enhance {
            render_options.fps = o.fps / 2;
        }
        // The AI input may be 30 FPS; output validation already ran on the user options.
        render_options.ai_enhance = false;
        let args = export_args_timeline_sources(
            &videos,
            &p,
            &segments,
            &render_options,
            if o.ai_enhance { &rendered } else { &partial },
            music.as_ref(),
            music_fade_out,
            &texts,
        )?;
        let stderr = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&log)
            .map_err(|e| format!("Cannot write in output folder: {e}"))?;
        let mut export_command = command(b.ffmpeg()?);
        if o.ai_enhance {
            super::enhance::low_pressure(&mut export_command, false);
            if let Ok(mut p) = job.progress.lock() {
                p.stage = Some("Preparing AI export".into());
            }
        }
        let mut child = export_command
            .args(if o.ai_enhance {
                super::args::safe_ai_render_args(args)
            } else {
                args
            })
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(stderr)
            .spawn()
            .map_err(|e| format!("Cannot start export: {e}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or("Missing FFmpeg progress stream")?;
        let progress_job = job.clone();
        let duration: f64 = segments.iter().map(|s| s.end - s.start).sum();
        let ai = o.ai_enhance;
        let reader = thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(seconds) = progress_seconds(&line) {
                    if let Ok(mut p) = progress_job.progress.lock() {
                        p.percent = (seconds / duration * if ai { 20. } else { 100. })
                            .clamp(0., if ai { 20. } else { 99.9 });
                        p.elapsed = start.elapsed().as_secs_f64();
                        p.remaining = if seconds > 0. && p.elapsed > 0.5 {
                            Some((duration - seconds).max(0.) * p.elapsed / seconds)
                        } else {
                            None
                        };
                    }
                }
            }
        });
        let status = loop {
            if job.cancel.load(Ordering::SeqCst) {
                let _ = child.kill();
                let _ = child.wait();
                break Err("Export canceled".to_string());
            }
            match child.try_wait() {
                Ok(Some(s)) => break Ok(s),
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
        let status = status?;
        if !status.success() {
            let error = (|| -> std::io::Result<String> {
                let mut file = fs::File::open(&log)?;
                let length = file.metadata()?.len();
                file.seek(SeekFrom::Start(length.saturating_sub(6000)))?;
                let mut bytes = Vec::new();
                file.read_to_end(&mut bytes)?;
                Ok(String::from_utf8_lossy(&bytes).into_owned())
            })()
            .unwrap_or_else(|e| format!("Cannot read FFmpeg diagnostics: {e}"));
            eprintln!("rlcut export failed: {error}");
            return Err(format!("FFmpeg export failed: {error}"));
        }
        if job.cancel.load(Ordering::SeqCst) {
            return Err("Export canceled".into());
        }
        if o.ai_enhance {
            let mut cursor = 0.;
            let cuts = segments
                .iter()
                .map(|s| {
                    cursor += s.end - s.start;
                    cursor
                })
                .collect::<Vec<_>>();
            let duration = cursor;
            if let Ok(mut p) = job.progress.lock() {
                p.stage = Some("AI smoothing · CPU safe mode".into());
                p.remaining = None;
            }
            super::enhance::run(
                &b,
                &rendered,
                &partial,
                &o,
                duration,
                &cuts,
                job.clone(),
                start,
                &log,
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
        if !o.ai_enhance || job.cancel.load(Ordering::SeqCst) {
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
