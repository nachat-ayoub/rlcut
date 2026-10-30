//! Versioned, bounded video-only enhancement cache. Text/audio/output paths never key it.
use super::{
    args,
    binaries::Binaries,
    export::{self, Job},
};
use super::{enhance, metadata};
use crate::model::{ExportOptions, MusicTrack, Preset, Segment, SfxTrack, TextOverlay, Video};
use std::{
    collections::hash_map::DefaultHasher,
    hash::{Hash, Hasher},
    io::Read,
    time::UNIX_EPOCH,
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::Instant,
};
const MAX_BYTES: u64 = 4 * 1024 * 1024 * 1024;
pub fn root() -> Result<PathBuf, String> {
    let base = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".cache")))
        .or_else(|| std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
        .or_else(|| std::env::var_os("TEMP").map(PathBuf::from))
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
fn model_identity(path: &Path) -> Result<serde_json::Value, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = 0xcbf29ce484222325u64;
    let mut buffer = [0u8; 65536];
    loop {
        let n = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        for byte in &buffer[..n] {
            hash = (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3);
        }
    }
    Ok(serde_json::json!([
        path.file_name()
            .ok_or("Missing model name")?
            .to_string_lossy(),
        file.metadata().map_err(|e| e.to_string())?.len(),
        format!("{hash:016x}")
    ]))
}
fn compatible(old: &serde_json::Value, current: &serde_json::Value) -> bool {
    if old == current {
        return true;
    }
    if current["algorithm"].as_str() != Some("parallel-cpu-vulkan-v1-full-ai")
        || std::env::var_os("RLCUT_AI_DIR").is_some()
        || !matches!(old["app"].as_str(), Some("0.5.0" | "0.5.1" | "0.6.0"))
        || !matches!(
            old["algorithm"].as_str(),
            Some("persistent-cpu-v2-full-ai" | "parallel-cpu-vulkan-v1-full-ai")
        )
    {
        return false;
    }
    for key in [
        "sources",
        "video",
        "preset",
        "ranges",
        "quality",
        "fps",
        "smooth",
        "upscale",
        "lite",
        "keepResolution",
    ] {
        if old[key] != current[key] {
            return false;
        }
    }
    let Some(new_models) = current["models"].as_array() else {
        return false;
    };
    let Some(old_models) = old["models"].as_array() else {
        return false;
    };
    new_models.iter().all(|model| {
        // Legacy manifests lack content hashes. Only migrate known bundled
        // full-AI releases, when the current assets still match those pins.
        let pinned = match model[0].as_str() {
            Some("flownet.param") => "61ff358d73afcf93",
            Some("flownet.bin") => "fb9b9e1d0fd03f93",
            Some("realesr-animevideov3-x2.param") => "4cb030183560779a",
            Some("realesr-animevideov3-x2.bin") => "7937eb6532cc6cf2",
            Some("upscayl-lite-4x.param") => "e18f74759a892f02",
            Some("upscayl-lite-4x.bin") => "a9a3bc3d998d4132",
            _ => return false,
        };
        model[2].as_str() == Some(pinned)
            && old_models
                .iter()
                .any(|old| old[0] == model[0] && old[1] == model[1])
    })
}
fn cache_warning(job: &Job) {
    if let Ok(mut p) = job.progress.lock() {
        let warning = "AI video could not be cached. Future exports will repeat AI processing; check free disk space and cache permissions.";
        p.warning = Some(p.warning.take().map_or_else(
            || warning.into(),
            |previous| format!("{previous} {warning}"),
        ));
    }
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
fn directory_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| {
            let path = entry.path();
            fs::metadata(&path).map_or(0, |metadata| {
                if metadata.is_dir() {
                    directory_size(&path)
                } else {
                    metadata.len()
                }
            })
        })
        .sum()
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
        let size = directory_size(&path);
        total += size;
        let date = fs::metadata(path.join("last-used"))
            .or_else(|_| fs::metadata(path.join("manifest.json")))
            .and_then(|m| m.modified())
            .ok();
        entries.push((date, path, size));
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

#[allow(clippy::too_many_arguments)] // Cache identity and final composition inputs are intentionally separate.
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
    sfx: &[SfxTrack],
    texts: &[TextOverlay],
    start: Instant,
    log: &Path,
) -> Result<(), String> {
    let duration: f64 = segments.iter().map(|s| s.end - s.start).sum();
    {
        let (_, model) = enhance::installation().ok_or("AI components unavailable")?;
        let folder = model.parent().ok_or("Missing AI directory")?;
        let source = videos
            .iter()
            .map(|v| fingerprint(Path::new(&v.path)))
            .collect::<Result<Vec<_>, _>>()?;
        let models = [
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
        .map(|path| model_identity(path))
        .collect::<Result<Vec<_>, _>>()?;
        let ranges = segments
            .iter()
            .map(|s| serde_json::json!([s.start, s.end, s.color_fix]))
            .collect::<Vec<_>>();
        let manifest=serde_json::to_vec(&serde_json::json!({"algorithm":"resumable-frames-v1", "sources":source,"video":videos,"basePreset":{"background":&p.background,"gameplay":&p.gameplay},"ranges":ranges,"quality":o.quality,"fps":o.fps,"smooth":o.ai_enhance,"upscale":o.ai_upscale,"lite":o.ai_upscale_lite,"keepResolution":o.ai_keep_resolution,"models":models})).map_err(|e|e.to_string())?;
        let mut hash = DefaultHasher::new();
        manifest.hash(&mut hash);
        let cache_id = format!("{:016x}", hash.finish());
        let root = root()?;
        fs::create_dir_all(&root).map_err(|e| format!("Cannot prepare AI cache: {e}"))?;
        let current: serde_json::Value =
            serde_json::from_slice(&manifest).map_err(|e| e.to_string())?;
        let mut entry = root.join(&cache_id);
        let mut hit = fs::read(entry.join("manifest.json")).ok().as_deref()
            == Some(manifest.as_slice())
            && valid(b, &entry.join("video.mp4"), o, duration);
        // Text-only app updates and AppImage mount/packaging timestamps do not
        // change neural output. Reuse validated full-AI caches from stock releases.
        if !hit {
            if let Ok(entries) = fs::read_dir(&root) {
                for candidate in entries.flatten().map(|e| e.path()) {
                    let old = fs::read(candidate.join("manifest.json"))
                        .ok()
                        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
                    if old.as_ref().is_some_and(|old| compatible(old, &current))
                        && valid(b, &candidate.join("video.mp4"), o, duration)
                    {
                        entry = candidate;
                        hit = true;
                        break;
                    }
                }
            }
        }
        let cache = entry.join("video.mp4");
        let intermediate = out.with_extension("ai-base.mp4");
        let _cleanup = Temporary(intermediate.clone());
        let processed = out.with_extension("ai-processed.mp4");
        let _cleanup2 = Temporary(processed.clone());
        let work = root.join(format!("{cache_id}.partial"));
        let ai_video = if hit {
            let _ = fs::remove_dir_all(&work);
            let _ = fs::write(entry.join("last-used"), b"");
            if let Ok(mut progress) = job.progress.lock() {
                progress.percent = 90.;
                progress.stage =
                    Some("Reusing prepared AI video · updating boost/text/audio".into());
                progress.warning = fs::read_to_string(entry.join("warning.txt"))
                    .ok()
                    .map(|w| format!("Prepared AI video: {w}"));
            }
            cache.clone()
        } else {
            if let Ok(mut progress) = job.progress.lock() {
                progress.stage =
                    Some("Preparing gameplay/background for AI · boost/text/audio deferred".into());
            }
            let mut base_options = o.clone();
            base_options.ai_enhance = false;
            base_options.ai_upscale = false;
            // Timeline effects are cheap finishing operations and must not invalidate
            // reusable AI frames when their position or styling changes.
            base_options.effects.clear();
            if o.ai_enhance {
                base_options.fps = o.fps / 2;
            }
            let mut silent = videos.to_vec();
            for video in &mut silent {
                video.has_audio = false;
            }
            let mut base_preset = p.clone();
            base_preset.boost.enabled = false;
            let render = args::export_args_timeline_sources(
                &silent,
                &base_preset,
                segments,
                &base_options,
                &intermediate,
                None,
                None,
                &[],
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
            if fs::read(work.join("manifest.json")).ok().as_deref() != Some(manifest.as_slice()) {
                if work.exists() {
                    fs::remove_dir_all(&work)
                        .map_err(|e| format!("Cannot reset stale AI checkpoint: {e}"))?;
                }
                fs::create_dir_all(work.join("frames"))
                    .map_err(|e| format!("Cannot create AI checkpoint: {e}"))?;
                fs::write(work.join("manifest.json"), &manifest)
                    .map_err(|e| format!("Cannot identify AI checkpoint: {e}"))?;
            } else {
                fs::create_dir_all(work.join("frames"))
                    .map_err(|e| format!("Cannot open AI checkpoint: {e}"))?;
            }
            let _ = fs::write(work.join("last-used"), b"");
            prune(&root, &work);
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
                &work.join("frames"),
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
                    let _ = fs::remove_dir_all(&work);
                    Ok(())
                })();
                if saved.is_err() {
                    let _ = fs::remove_dir_all(&temp);
                    cache_warning(&job);
                }
            } else {
                cache_warning(&job);
            }
            prune(&root, &entry);
            processed.clone()
        };
        if let Ok(mut progress) = job.progress.lock() {
            progress.percent = 90.;
            progress.stage = Some("Finishing boost, text and audio · AI already prepared".into());
        }
        let mut finish = args::safe_ai_render_args(args::finish_ai_args(
            videos, p, segments, o, out, music, fade, sfx, texts, &ai_video,
        )?);
        for i in 0..finish.len().saturating_sub(1) {
            if finish[i] == "-crf" {
                finish[i + 1] = "17".into();
            }
        }
        export::execute(b, finish, log, duration, job, start, 90., 9.9, true)
    }
}
