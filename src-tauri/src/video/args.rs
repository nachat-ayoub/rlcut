use super::geometry::filter_graph;
use crate::model::{ExportOptions, MusicTrack, Preset, Segment, Video};
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
            volume: 1.,
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
    export_args_timeline(v, p, segments, o, out, None, false)
}
pub fn export_args_timeline(
    v: &Video,
    p: &Preset,
    segments: &[Segment],
    o: &ExportOptions,
    out: &Path,
    music: Option<&MusicTrack>,
    boost_intro: bool,
) -> Result<Vec<String>, String> {
    let (w, h) = o.resolution()?;
    if !v.duration.is_finite() || v.duration <= 0. {
        return Err("Invalid video duration".into());
    }
    Segment::validate_all(segments, v.duration)?;
    let mut graph = String::new();
    let split_outputs = (0..segments.len())
        .map(|i| format!("[edit{i}]"))
        .collect::<String>();
    graph.push_str(&format!("[0:v:0]split={}{split_outputs}", segments.len()));
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
        ";{video_inputs}concat=n={}:v=1:a=0[source_edit]",
        segments.len()
    ));
    let mut composition = filter_graph(v, p, w, h)?
        .replace("[0:v:0]", "[source_edit]")
        .replace("[out]", "[out_edit]");
    if boost_intro && p.boost.enabled {
        let b = super::geometry::geometry(v, p, w, h)?.boost;
        let hidden = -(b.width as i32) - 5;
        composition = composition.replace(
            &format!("[base][hud]overlay=x={}:y={}:eval=init", b.x, b.y),
            &format!("[base][hud]overlay=x='if(lt(t,0.8),{hidden}+({}-({hidden}))*(pow(t/0.8,2)*(3-2*t/0.8)),{})':y={}:eval=frame", b.x, b.x, b.y),
        ).replace("eval=frame:shortest=1:format=yuv420", "eval=frame:shortest=1:format=yuv444");
    }
    graph.push(';');
    graph.push_str(&composition);
    if v.has_audio {
        let audio_splits = (0..segments.len())
            .map(|i| format!("[audio{i}]"))
            .collect::<String>();
        graph.push_str(&format!(";[0:a:0]asplit={}{audio_splits}", segments.len()));
        for (index, segment) in segments.iter().enumerate() {
            graph.push_str(&format!(
                ";[audio{index}]atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS,volume={:.4}[a{index}]",
                segment.start, segment.end, segment.volume
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
    let music = music.filter(|m| !m.segments.is_empty());
    if let Some(music) = music {
        music.validate()?;
        let outputs = (0..music.segments.len())
            .map(|i| format!("[ms{i}]"))
            .collect::<String>();
        graph.push_str(&format!(";[1:a:0]asplit={}{outputs}", music.segments.len()));
        for (i, s) in music.segments.iter().enumerate() {
            graph.push_str(&format!(
                ";[ms{i}]atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS,volume={:.4}[mt{i}]",
                s.start, s.end, s.volume
            ));
        }
        let inputs = (0..music.segments.len())
            .map(|i| format!("[mt{i}]"))
            .collect::<String>();
        graph.push_str(&format!(
            ";{inputs}concat=n={}:v=0:a=1,apad[music_edit]",
            music.segments.len()
        ));
        if v.has_audio {
            graph.push_str(";[audio_edit][music_edit]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95:level=0:attack=1[audio_mix]");
        } else {
            graph.push_str(";[music_edit]alimiter=limit=0.95:level=0:attack=1[audio_mix]");
        }
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
    if let Some(music) = music {
        let index = args
            .iter()
            .position(|value| value == "-filter_complex")
            .unwrap();
        args.splice(index..index, ["-i".into(), music.path.clone()]);
    }
    if v.has_audio || music.is_some() {
        args.extend(
            [
                "-map",
                if music.is_some() {
                    "[audio_mix]"
                } else {
                    "[audio_edit]"
                },
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
        assert!(a.iter().any(|value| value.contains("volume=1.0000")));
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
