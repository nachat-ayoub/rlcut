use super::geometry::filter_graph;
use crate::model::{ExportOptions, Preset, Segment, Video};
use std::path::Path;
pub fn export_args(
    v: &Video,
    p: &Preset,
    o: &ExportOptions,
    out: &Path,
) -> Result<Vec<String>, String> {
    export_args_segments(
        v,
        p,
        &[Segment {
            start: 0.,
            end: v.duration,
        }],
        o,
        out,
    )
}
pub fn export_args_segments(
    v: &Video,
    p: &Preset,
    segments: &[Segment],
    o: &ExportOptions,
    out: &Path,
) -> Result<Vec<String>, String> {
    let (w, h) = o.resolution()?;
    if !v.duration.is_finite() || v.duration <= 0. {
        return Err("Invalid video duration".into());
    }
    Segment::validate_all(segments, v.duration)?;
    let mut graph = filter_graph(v, p, w, h)?;
    let split_outputs = (0..segments.len())
        .map(|i| format!("[edit{i}]"))
        .collect::<String>();
    graph.push_str(&format!(";[out]split={}{split_outputs}", segments.len()));
    for (index, segment) in segments.iter().enumerate() {
        graph.push_str(&format!(
            ";[edit{index}]trim=start={:.6}:end={:.6},setpts=PTS-STARTPTS[v{index}]",
            segment.start, segment.end
        ));
    }
    let video_inputs = (0..segments.len())
        .map(|i| format!("[v{i}]"))
        .collect::<String>();
    graph.push_str(&format!(
        ";{video_inputs}concat=n={}:v=1:a=0[out_edit]",
        segments.len()
    ));
    if v.has_audio {
        let audio_splits = (0..segments.len())
            .map(|i| format!("[audio{i}]"))
            .collect::<String>();
        graph.push_str(&format!(";[0:a:0]asplit={}{audio_splits}", segments.len()));
        for (index, segment) in segments.iter().enumerate() {
            graph.push_str(&format!(
                ";[audio{index}]atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS[a{index}]",
                segment.start, segment.end
            ));
        }
        let audio_inputs = (0..segments.len())
            .map(|i| format!("[a{i}]"))
            .collect::<String>();
        graph.push_str(&format!(
            ";{audio_inputs}concat=n={}:v=0:a=1[audio_join];[audio_join]apad[audio_edit]",
            segments.len()
        ));
    }
    let edited_duration: f64 = segments.iter().map(|s| s.end - s.start).sum();
    let mut args = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "warning".into(),
        "-nostdin".into(),
        "-n".into(),
        "-filter_complex_threads".into(),
        std::thread::available_parallelism()
            .map(|n| n.get().min(4))
            .unwrap_or(1)
            .to_string(),
        "-i".into(),
        v.path.clone(),
        "-filter_complex".into(),
        graph,
        "-map".into(),
        "[out_edit]".into(),
    ];
    if v.has_audio {
        args.extend(
            [
                "-map",
                "[audio_edit]",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-shortest",
            ]
            .map(String::from),
        );
    } else {
        args.push("-an".into());
    }
    args.extend(
        [
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
            "medium",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-r",
        ]
        .map(String::from),
    );
    args.push(o.fps.to_string());
    // Older FFmpeg versions can flush padded audio past video EOF despite
    // -shortest. An explicit video duration bounds both streams consistently.
    args.extend(["-t".into(), format!("{edited_duration:.6}")]);
    args.extend(
        [
            "-vsync",
            "cfr",
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-nostats",
            "-f",
            "mp4",
        ]
        .map(String::from),
    );
    args.push(out.to_string_lossy().into());
    Ok(args)
}
pub fn progress_seconds(line: &str) -> Option<f64> {
    line.strip_prefix("out_time_us=")
        .and_then(|s| s.trim().parse::<f64>().ok())
        .filter(|s| s.is_finite() && *s >= 0.)
        .map(|s| s / 1_000_000.)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn structured_args_cfr_optional_audio() {
        let mut v = Video {
            path: "/tmp/a ' unicode é.mp4".into(),
            width: 1920,
            height: 1080,
            duration: 2.,
            fps: 29.97,
            has_audio: true,
            color_transfer: String::new(),
        };
        let o = ExportOptions {
            quality: 480,
            fps: 60,
            folder: "/tmp".into(),
            filename: "out.mp4".into(),
        };
        let a = export_args(&v, &Preset::default(), &o, Path::new("/tmp/out.mp4")).unwrap();
        assert!(a.contains(&v.path));
        assert!(a.contains(&"[audio_edit]".into()));
        assert!(a.iter().any(|value| value.contains("apad[audio_edit]")));
        assert!(a.contains(&"-shortest".into()));
        assert!(a.contains(&"cfr".into()));
        v.has_audio = false;
        let a = export_args(&v, &Preset::default(), &o, Path::new("/tmp/out.mp4")).unwrap();
        assert!(a.contains(&"-an".into()));
        assert!(!a.contains(&"aac".into()));
    }
    #[test]
    fn microsecond_progress() {
        assert_eq!(progress_seconds("out_time_us=1500000"), Some(1.5));
        assert_eq!(progress_seconds("out_time_us=N/A"), None);
        assert_eq!(progress_seconds("out_time_us=-1"), None);
    }
    #[test]
    fn even_output_and_invalid_fps() {
        for (q, d) in [(480, (480, 854)), (720, (720, 1280)), (1080, (1080, 1920))] {
            let o = ExportOptions {
                quality: q,
                fps: 30,
                folder: "".into(),
                filename: "".into(),
            };
            assert_eq!(o.resolution().unwrap(), d);
        }
        let o = ExportOptions {
            quality: 720,
            fps: 24,
            folder: "".into(),
            filename: "".into(),
        };
        assert!(o.resolution().is_err());
    }
}
