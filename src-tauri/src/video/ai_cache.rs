//! Versioned, bounded video-only enhancement cache. Text/audio/output paths never key it.
use super::{
    args,
    binaries::Binaries,
    enhance,
    export::{self, Job},
    metadata,
};
use crate::model::{ExportOptions, MusicTrack, Preset, Segment, TextOverlay, Video};
use std::{
    collections::hash_map::DefaultHasher,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::Arc,
    time::{Instant, UNIX_EPOCH},
};
const MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;
pub fn root() -> Result<PathBuf, String> {
    let base = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".cache")))
        .ok_or("Cannot locate AI cache directory")?;
    Ok(base.join("io.rlcut.desktop/ai-exports-v4"))
}
fn fingerprint(path: &Path) -> Result<serde_json::Value, String> {
    let p = path
        .canonicalize()
        .map_err(|e| format!("Cannot locate cache input: {e}"))?;
    let m = fs::metadata(&p).map_err(|e| e.to_string())?;
    Ok(serde_json::json!([
        p.to_string_lossy(),
        m.len(),
        m.modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_nanos().to_string())
    ]))
}
fn valid(b: &Binaries, path: &Path, o: &ExportOptions, duration: f64) -> bool {
    let Ok(v) = metadata::probe(b, path) else {
        return false;
    };
    let Ok((w, h)) = o.output_resolution() else {
        return false;
    };
    v.width == w
        && v.height == h
        && (v.duration - duration).abs() < 0.15
        && (v.fps - o.fps as f64).abs() < 0.1
}
fn prune(root: &Path, keep: &Path) {
    let Ok(dirs) = fs::read_dir(root) else {
        return;
    };
    let mut entries = Vec::new();
    let mut total = 0;
    for entry in dirs.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if let Ok(m) = fs::metadata(path.join("video.mp4")) {
            total += m.len();
            let date = fs::metadata(path.join("last-used"))
                .and_then(|m| m.modified())
                .ok();
            entries.push((date, path, m.len()));
        }
    }
    entries.sort_by_key(|v| v.0);
    for (_, path, size) in entries {
        if total <= MAX_BYTES {
            break;
        }
        if path != keep && fs::remove_dir_all(&path).is_ok() {
            total = total.saturating_sub(size);
        }
    }
}
pub fn clear() -> Result<(), String> {
    let root = root()?;
    if root.exists() {
        fs::remove_dir_all(root).map_err(|e| e.to_string())?;
    }
    Ok(())
}
struct Temporary(PathBuf);
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

pub fn run(
    b: &Binaries,
    videos: &[Video],
    p: &Preset,
    segments: &[Segment],
    o: &ExportOptions,
    out: &Path,
    job: Arc<Job>,
    music: Option<&MusicTrack>,
    fade: Option<f64>,
    texts: &[TextOverlay],
    start: Instant,
    log: &Path,
) -> Result<(), String> {
    let duration: f64 = segments.iter().map(|s| s.end - s.start).sum();
    let (_, model) = enhance::installation().ok_or("AI components unavailable")?;
    let folder = model.parent().ok_or("Missing AI directory")?;
    let source = videos
        .iter()
        .map(|v| fingerprint(Path::new(&v.path)))
        .collect::<Result<Vec<_>, _>>()?;
    let models = [
        folder.join("rlcut-ai-cpu"),
        model.join("flownet.param"),
        model.join("flownet.bin"),
        folder.join(if o.ai_upscale_lite {
            "upscayl-lite-4x.param"
        } else {
            "realesr-animevideov3-x2.param"
        }),
        folder.join(if o.ai_upscale_lite {
            "upscayl-lite-4x.bin"
        } else {
            "realesr-animevideov3-x2.bin"
        }),
    ]
    .iter()
    .map(|p| {
        let mut value = fingerprint(p)?;
        // AppImage mount paths change on every launch; identify bundled models by
        // filename, metadata and app version instead of their temporary mount.
        value[0] = serde_json::json!(p.file_name().unwrap().to_string_lossy());
        Ok::<_, String>(value)
    })
    .collect::<Result<Vec<_>, _>>()?;
    let ranges = segments
        .iter()
        .map(|s| serde_json::json!([s.start, s.end, s.color_fix]))
        .collect::<Vec<_>>();
    let manifest=serde_json::to_vec(&serde_json::json!({"algorithm":"persistent-cpu-v2-full-ai", "app":env!("CARGO_PKG_VERSION"),"sources":source,"video":videos,"preset":p,"ranges":ranges,"quality":o.quality,"fps":o.fps,"smooth":o.ai_enhance,"upscale":o.ai_upscale,"lite":o.ai_upscale_lite,"keepResolution":o.ai_keep_resolution,"models":models})).map_err(|e|e.to_string())?;
    let mut hash = DefaultHasher::new();
    manifest.hash(&mut hash);
    let root = root()?;
    fs::create_dir_all(&root).map_err(|e| format!("Cannot prepare AI cache: {e}"))?;
    let entry = root.join(format!("{:016x}", hash.finish()));
    let cache = entry.join("video.mp4");
    let hit = fs::read(entry.join("manifest.json")).ok().as_deref() == Some(manifest.as_slice())
        && valid(b, &cache, o, duration);
    let intermediate = out.with_extension("ai-base.mp4");
    let _cleanup = Temporary(intermediate.clone());
    let processed = out.with_extension("ai-processed.mp4");
    let _cleanup2 = Temporary(processed.clone());
    let ai_video = if hit {
        let _ = fs::write(entry.join("last-used"), b"");
        if let Ok(mut progress) = job.progress.lock() {
            progress.percent = 90.;
            progress.stage = Some("Reusing prepared AI video · updating text/audio".into());
            progress.warning = fs::read_to_string(entry.join("warning.txt")).ok();
        }
        cache.clone()
    } else {
        if let Ok(mut progress) = job.progress.lock() {
            progress.stage =
                Some("Preparing video composition for AI · text/audio deferred".into());
        }
        let mut base_options = o.clone();
        base_options.ai_enhance = false;
        base_options.ai_upscale = false;
        if o.ai_enhance {
            base_options.fps = o.fps / 2;
        }
        let mut silent = videos.to_vec();
        for video in &mut silent {
            video.has_audio = false;
        }
        let render = args::export_args_timeline_sources(
            &silent,
            p,
            segments,
            &base_options,
            &intermediate,
            None,
            None,
            &[],
        )?;
        export::execute(
            b,
            args::safe_ai_render_args(render),
            log,
            duration,
            job.clone(),
            start,
            0.,
            20.,
            true,
        )?;
        let mut elapsed = 0.;
        let cuts = segments
            .iter()
            .map(|s| {
                elapsed += s.end - s.start;
                elapsed
            })
            .collect::<Vec<_>>();
        enhance::run(
            b,
            &intermediate,
            &processed,
            o,
            duration,
            &cuts,
            job.clone(),
            start,
            log,
        )?;
        if !valid(b, &processed, o, duration) {
            return Err(
                "Prepared AI video failed metadata validation; nothing was cached or published"
                    .into(),
            );
        }
        // Publish only a completed and validated result, with its exact manifest and quality warning.
        let temp = root.join(format!(".building-{}", job.snapshot()?.id));
        if fs::create_dir(&temp).is_ok() {
            let saved = (|| -> Result<(), String> {
                fs::copy(&processed, temp.join("video.mp4")).map_err(|e| e.to_string())?;
                fs::write(temp.join("manifest.json"), &manifest).map_err(|e| e.to_string())?;
                fs::write(temp.join("last-used"), b"").map_err(|e| e.to_string())?;
                if let Some(warning) = job.snapshot()?.warning {
                    fs::write(temp.join("warning.txt"), warning).map_err(|e| e.to_string())?;
                }
                if entry.exists() {
                    // Replace an invalid/stale entry; it was explicitly rejected above.
                    fs::remove_dir_all(&entry).map_err(|e| e.to_string())?;
                }
                fs::rename(&temp, &entry).map_err(|e| e.to_string())?;
                Ok(())
            })();
            if saved.is_err() {
                let _ = fs::remove_dir_all(&temp);
            }
        }
        prune(&root, &entry);
        processed.clone()
    };
    if let Ok(mut progress) = job.progress.lock() {
        progress.percent = 90.;
        progress.stage = Some("Finishing text and audio · AI already prepared".into());
    }
    let mut finish = args::safe_ai_render_args(args::finish_ai_args(
        videos, p, segments, o, out, music, fade, texts, &ai_video,
    )?);
    for i in 0..finish.len().saturating_sub(1) {
        if finish[i] == "-crf" {
            finish[i + 1] = "17".into();
        }
    }
    export::execute(b, finish, log, duration, job, start, 90., 9.9, true)
}
