use super::{
    binaries::{command, Binaries},
    geometry::{color_filter, filter_graph},
};
use crate::model::{Preset, Video};
use serde::Serialize;
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
    time::Duration,
};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub source: String,
    pub composed: String,
    pub timestamp: f64,
}
fn base64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for b in bytes.chunks(3) {
        let n = ((b[0] as u32) << 16)
            | ((b.get(1).copied().unwrap_or(0) as u32) << 8)
            | b.get(2).copied().unwrap_or(0) as u32;
        s.push(T[((n >> 18) & 63) as usize] as char);
        s.push(T[((n >> 12) & 63) as usize] as char);
        s.push(if b.len() > 1 {
            T[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        s.push(if b.len() > 2 {
            T[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    s
}
fn image(path: &Path) -> Result<String, String> {
    Ok(format!(
        "data:image/png;base64,{}",
        base64(&fs::read(path).map_err(|e| e.to_string())?)
    ))
}
#[allow(clippy::too_many_arguments)]
fn run(
    b: &Binaries,
    v: &Video,
    ts: f64,
    filter: &str,
    out: &Path,
    epoch: &Arc<AtomicU64>,
    ticket: u64,
    complex: bool,
) -> Result<(), String> {
    let log = out.with_extension("log");
    let stderr = fs::File::create(&log).map_err(|e| e.to_string())?;
    let mut c = command(b.ffmpeg()?);
    c.args([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-filter_complex_threads",
        "1",
        "-ss",
        &format!("{ts:.6}"),
        "-i",
    ])
    .arg(&v.path);
    if complex {
        c.args(["-filter_complex", filter, "-map", "[out]"]);
    } else {
        c.args(["-vf", filter]);
    }
    c.args(["-frames:v", "1", "-threads", "1", "-update", "1"])
        .arg(out)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(stderr);
    let mut child = c
        .spawn()
        .map_err(|e| format!("Cannot start preview: {e}"))?;
    let result = loop {
        if epoch.load(Ordering::SeqCst) != ticket {
            let _ = child.kill();
            let _ = child.wait();
            break Err("Preview superseded".into());
        }
        match child.try_wait() {
            Ok(Some(s)) => {
                break if s.success() && out.is_file() {
                    Ok(())
                } else {
                    Err(format!(
                        "Preview failed: {}",
                        fs::read_to_string(&log).unwrap_or_default()
                    ))
                };
            }
            Ok(None) => thread::sleep(Duration::from_millis(30)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(e.to_string());
            }
        }
    };
    let _ = fs::remove_file(log);
    if result.is_err() {
        let _ = fs::remove_file(out);
    }
    result
}
#[allow(clippy::too_many_arguments)]
pub fn render(
    b: &Binaries,
    v: &Video,
    p: &Preset,
    timestamp: f64,
    quality: u32,
    cache: &Path,
    epoch: &Arc<AtomicU64>,
    ticket: u64,
) -> Result<Preview, String> {
    if !timestamp.is_finite() {
        return Err("Invalid preview time".into());
    }
    p.validate()?;
    let ts = timestamp.max(0.).min((v.duration - 1. / v.fps).max(0.));
    fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let mut hash = DefaultHasher::new();
    "hdr-color-pipeline-v3".hash(&mut hash);
    v.path.hash(&mut hash);
    fs::metadata(&v.path)
        .ok()
        .and_then(|m| m.modified().ok())
        .hash(&mut hash);
    format!("{ts:.6}").hash(&mut hash);
    let source = cache.join(format!("source-{:x}.png", hash.finish()));
    if !source.exists() {
        let width = v.width.min(3840) / 2 * 2;
        let height = ((width as f64 * v.height as f64 / v.width as f64 / 2.)
            .round()
            .max(1.)
            * 2.) as u32;
        run(
            b,
            v,
            ts,
            &format!(
                "{},scale={width}:{height}:flags=lanczos,setsar=1",
                color_filter(v)
            ),
            &source,
            epoch,
            ticket,
            false,
        )?;
    }
    serde_json::to_string(p)
        .map_err(|e| e.to_string())?
        .hash(&mut hash);
    quality.hash(&mut hash);
    let composed = cache.join(format!("composition-{:x}.png", hash.finish()));
    let (w, h) = if quality == 480 {
        (480, 854)
    } else {
        if quality == 720 {
            (720, 1280)
        } else {
            (1080, 1920)
        }
    };
    if !composed.exists() {
        run(
            b,
            v,
            ts,
            &filter_graph(v, p, w, h)?,
            &composed,
            epoch,
            ticket,
            true,
        )?;
    }
    let result = Preview {
        source: image(&source)?,
        composed: image(&composed)?,
        timestamp: ts,
    };
    trim(cache);
    Ok(result)
}
pub fn trim(cache: &Path) {
    let mut entries: Vec<(PathBuf, std::time::SystemTime, u64)> = fs::read_dir(cache)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let m = e.metadata().ok()?;
            Some((e.path(), m.modified().ok()?, m.len()))
        })
        .filter(|(p, _, _)| p.extension().is_some_and(|s| s == "png"))
        .collect();
    entries.sort_by_key(|(_, t, _)| *t);
    let mut size = entries.iter().map(|(_, _, s)| s).sum::<u64>();
    let mut count = entries.len();
    for (p, _, s) in entries {
        if count <= 128 && size <= 256 * 1024 * 1024 {
            break;
        }
        if fs::remove_file(p).is_ok() {
            count -= 1;
            size -= s;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn base64_padding() {
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
    }
}
