//! One cancellable preparation job per source, never one FFmpeg process per
//! editor frame. Output is a seekable SDR texture source; composition happens
//! live in the editor, while export retains the full-resolution original.
use super::{
    binaries::{command, Binaries},
    geometry::color_filter,
};
use crate::model::Video;
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};
struct Partial {
    video: PathBuf,
    log: PathBuf,
    progress: PathBuf,
}
impl Drop for Partial {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.video);
        let _ = fs::remove_file(&self.log);
        let _ = fs::remove_file(&self.progress);
    }
}
pub fn prepare(
    binaries: &Binaries,
    video: &Video,
    cache: &Path,
    epoch: &Arc<AtomicU64>,
    ticket: u64,
) -> Result<PathBuf, String> {
    prepare_progress(binaries, video, cache, epoch, ticket, |_, _, _| {})
}
pub fn prepare_progress(
    binaries: &Binaries,
    video: &Video,
    cache: &Path,
    epoch: &Arc<AtomicU64>,
    ticket: u64,
    progress: impl Fn(f64, f64, Option<f64>),
) -> Result<PathBuf, String> {
    let started = Instant::now();
    progress(0., 0., None);
    let cancelled = || epoch.load(Ordering::SeqCst) != ticket;
    if cancelled() {
        return Err("Source preparation superseded".into());
    }
    fs::create_dir_all(cache).map_err(|e| format!("Cannot create decoder cache: {e}"))?;
    let metadata = fs::metadata(&video.path).map_err(|e| format!("Cannot open recording: {e}"))?;
    let mut hash = DefaultHasher::new();
    "decoder-v1-live-composition".hash(&mut hash);
    video.path.hash(&mut hash);
    metadata.len().hash(&mut hash);
    metadata.modified().ok().hash(&mut hash);
    let output = cache.join(format!("source-{:x}.mp4", hash.finish()));
    if output.is_file() && output.metadata().is_ok_and(|m| m.len() > 0) {
        progress(100., 0., Some(0.));
        return Ok(output);
    }
    let partial = Partial {
        video: output.with_extension("partial.mp4"),
        log: output.with_extension("log"),
        progress: output.with_extension("progress"),
    };
    let stderr = fs::File::create(&partial.log).map_err(|e| e.to_string())?;
    let fps = if video.fps >= 50. { 60 } else { 30 };
    let filter=format!("{},scale=trunc(iw*sar/2)*2:ih,setsar=1,scale=960:960:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=fast_bilinear,setsar=1,fps={fps}",color_filter(video));
    let mut process = command(binaries.ffmpeg()?);
    process
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-threads",
            "2",
            "-i",
        ])
        .arg(&video.path)
        .args([
            "-map",
            "0:v:0",
            "-vf",
            &filter,
            "-filter_threads",
            "2",
            "-threads",
            "2",
            "-profile:v",
            "baseline",
            "-color_range",
            "tv",
            "-colorspace",
            "bt709",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
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
        process.args([
            "-map", "0:a:0?", "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "96k",
        ]);
    } else {
        process.arg("-an");
    }
    process
        .arg("-progress")
        .arg(&partial.progress)
        .args(["-stats_period", "0.25"]);
    process
        .args([
            "-t",
            &format!("{:.6}", video.duration),
            "-movflags",
            "+faststart",
        ])
        .arg(&partial.video)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(stderr);
    let mut child = process
        .spawn()
        .map_err(|e| format!("Cannot prepare recording: {e}"))?;
    let mut last_progress = Instant::now();
    loop {
        if last_progress.elapsed() >= Duration::from_millis(200) {
            if let Ok(log) = fs::read_to_string(&partial.progress) {
                if let Some(us) = log.lines().rev().find_map(|line| {
                    line.strip_prefix("out_time_us=")
                        .and_then(|value| value.parse::<f64>().ok())
                }) {
                    let percent = (us / 1_000_000. / video.duration * 100.).clamp(0., 99.9);
                    let elapsed = started.elapsed().as_secs_f64();
                    let remaining = if percent > 1. {
                        Some(elapsed * (100. - percent) / percent)
                    } else {
                        None
                    };
                    progress(percent, elapsed, remaining);
                }
            }
            last_progress = Instant::now();
        }
        if cancelled() {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Source preparation superseded".into());
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(Some(_)) => {
                return Err(format!(
                    "Cannot prepare recording: {}",
                    fs::read_to_string(&partial.log).unwrap_or_default().trim()
                ))
            }
            Ok(None) => thread::sleep(Duration::from_millis(20)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e.to_string());
            }
        }
    }
    if cancelled() {
        return Err("Source preparation superseded".into());
    }
    fs::rename(&partial.video, &output).map_err(|e| e.to_string())?;
    progress(100., started.elapsed().as_secs_f64(), Some(0.));
    Ok(output)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    #[test]
    fn cancellation_kills_preparation_and_removes_partial_files() {
        let root = std::env::temp_dir().join(format!("rlcut-decoder-test-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let input = root.join("recording.mp4");
        fs::write(&input, b"fixture").unwrap();
        let executable = root.join("ffmpeg");
        fs::write(
            &executable,
            "#!/bin/sh\nfor file do :; done\nprintf partial > \"$file\"\nexec sleep 30\n",
        )
        .unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o755)).unwrap();
        let video = Video {
            path: input.to_string_lossy().into(),
            width: 640,
            height: 360,
            duration: 2.,
            fps: 60.,
            has_audio: false,
            color_transfer: String::new(),
        };
        let binaries = Binaries {
            ffmpeg: Some(executable),
            ffprobe: None,
        };
        let epoch = Arc::new(AtomicU64::new(1));
        let cancelled = epoch.clone();
        let cache = root.join("cache");
        let worker_cache = cache.clone();
        let worker =
            thread::spawn(move || prepare(&binaries, &video, &worker_cache, &cancelled, 1));
        for _ in 0..100 {
            if fs::read_dir(&cache).is_ok_and(|entries| {
                entries
                    .filter_map(Result::ok)
                    .any(|entry| entry.path().to_string_lossy().ends_with("partial.mp4"))
            }) {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        epoch.store(2, Ordering::SeqCst);
        assert!(worker.join().unwrap().unwrap_err().contains("superseded"));
        assert_eq!(fs::read_dir(&cache).unwrap().count(), 0);
        fs::remove_dir_all(root).unwrap();
    }
}
