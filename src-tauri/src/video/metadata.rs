use super::binaries::{command, Binaries};
use crate::model::Video;
use serde_json::Value;
use std::path::Path;
fn ratio(s: &str) -> Option<f64> {
    let (a, b) = s.split_once('/').or_else(|| s.split_once(':'))?;
    let a = a.parse::<f64>().ok()?;
    let b = b.parse::<f64>().ok()?;
    let r = a / b;
    if r.is_finite() && r > 0. {
        Some(r)
    } else {
        None
    }
}
pub fn probe(b: &Binaries, path: &Path) -> Result<Video, String> {
    let path = path
        .canonicalize()
        .map_err(|e| format!("Cannot access video: {e}"))?;
    if !path.is_file() {
        return Err("Select a video file, not a folder".into());
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !["mp4", "mov", "mkv", "webm"].contains(&ext.as_str()) {
        return Err("Supported containers: MP4, MOV, MKV and WebM".into());
    }
    let out = command(b.ffprobe()?)
        .args([
            "-v",
            "error",
            "-show_streams",
            "-show_format",
            "-of",
            "json",
        ])
        .arg(&path)
        .output()
        .map_err(|e| format!("Cannot run FFprobe: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "FFprobe could not read this video: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    let json: Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| format!("Invalid FFprobe response: {e}"))?;
    let streams = json["streams"].as_array().ok_or("No media streams")?;
    let s = streams
        .iter()
        .find(|v| v["codec_type"] == "video")
        .ok_or("No video stream found")?;
    let width = s["width"].as_u64().ok_or("Missing video width")? as u32;
    let mut height = s["height"].as_u64().ok_or("Missing video height")? as u32;
    let sar = s["sample_aspect_ratio"]
        .as_str()
        .and_then(ratio)
        .unwrap_or(1.);
    let mut width = (width as f64 * sar).round() as u32;
    let rotation = s["side_data_list"]
        .as_array()
        .and_then(|a| a.iter().find_map(|v| v["rotation"].as_i64()))
        .unwrap_or_else(|| {
            s["tags"]["rotate"]
                .as_str()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0)
        });
    if rotation.rem_euclid(180) == 90 {
        std::mem::swap(&mut width, &mut height);
    }
    let duration = s["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .or_else(|| {
            json["format"]["duration"]
                .as_str()
                .and_then(|s| s.parse().ok())
        })
        .ok_or("Could not detect video duration")?;
    let fps = s["avg_frame_rate"]
        .as_str()
        .and_then(ratio)
        .or_else(|| s["r_frame_rate"].as_str().and_then(ratio))
        .unwrap_or(30.);
    if width < 2
        || height < 2
        || width > 32768
        || height > 32768
        || !duration.is_finite()
        || duration <= 0.
        || !fps.is_finite()
        || fps <= 0.
    {
        return Err("Invalid video dimensions, duration or frame rate".into());
    }
    Ok(Video {
        path: path.to_string_lossy().into(),
        width,
        height,
        duration,
        fps,
        has_audio: streams.iter().any(|s| s["codec_type"] == "audio"),
        color_transfer: s["color_transfer"].as_str().unwrap_or("").into(),
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fractions() {
        assert_eq!(ratio("30000/1001"), Some(30000. / 1001.));
        assert_eq!(ratio("0/0"), None);
        assert_eq!(ratio("16:15"), Some(16. / 15.));
    }
}
