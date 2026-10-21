use super::binaries::{command, Binaries};
use crate::model::{MusicFile, Video};
use serde_json::Value;
use std::path::Path;
pub fn audio_waveform(b: &Binaries, path: &Path) -> Result<Vec<f32>, String> {
    // A low sample rate is enough for a timeline overview and keeps import fast.
    // The final 1,200 peak buckets are stored with the project, so this is decoded once.
    let out = command(b.ffmpeg()?)
        .args(["-hide_banner", "-loglevel", "error", "-nostdin", "-i"])
        .arg(path)
        .args([
            "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "200", "-f", "f32le", "pipe:1",
        ])
        .output()
        .map_err(|e| format!("Cannot decode audio waveform: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    let samples = out
        .stdout
        .chunks_exact(4)
        .filter_map(|bytes| {
            let value = f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]).abs();
            value.is_finite().then_some(value)
        })
        .collect::<Vec<_>>();
    if samples.is_empty() {
        return Ok(Vec::new());
    }
    let bucket_count = samples.len().min(1_200);
    let peaks = (0..bucket_count)
        .map(|index| {
            let start = index * samples.len() / bucket_count;
            let end = ((index + 1) * samples.len() / bucket_count).max(start + 1);
            samples[start..end].iter().copied().fold(0_f32, f32::max)
        })
        .collect::<Vec<_>>();
    // Normalize against the 95th percentile so one transient does not flatten the song.
    let mut levels = peaks.clone();
    levels.sort_by(|a, b| a.total_cmp(b));
    let reference = levels[((levels.len() - 1) as f32 * 0.95).round() as usize].max(0.01);
    Ok(peaks
        .into_iter()
        .map(|peak| (peak / reference).min(1.).sqrt())
        .collect())
}
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
pub fn probe_music(b: &Binaries, path: &Path) -> Result<MusicFile, String> {
    let path = path
        .canonicalize()
        .map_err(|e| format!("Cannot access music file: {e}"))?;
    if !path.is_file() {
        return Err("Select an audio file, not a folder".into());
    }
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus"].contains(&ext.as_str()) {
        return Err("Supported audio: MP3, WAV, M4A, AAC, FLAC, OGG and Opus".into());
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
            "FFprobe could not read this audio file: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    let json: Value = serde_json::from_slice(&out.stdout)
        .map_err(|e| format!("Invalid FFprobe response: {e}"))?;
    let streams = json["streams"].as_array().ok_or("No media streams")?;
    let stream = streams
        .iter()
        .find(|value| value["codec_type"] == "audio")
        .ok_or("No audio stream found")?;
    let duration = stream["duration"]
        .as_str()
        .and_then(|value| value.parse::<f64>().ok())
        .or_else(|| {
            json["format"]["duration"]
                .as_str()
                .and_then(|value| value.parse().ok())
        })
        .filter(|value| value.is_finite() && *value > 0.)
        .ok_or("Could not detect audio duration")?;
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or("Audio filename is invalid")?
        .to_string();
    Ok(MusicFile {
        path: path.to_string_lossy().into(),
        name,
        duration,
        waveform: audio_waveform(b, &path).unwrap_or_default(),
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
