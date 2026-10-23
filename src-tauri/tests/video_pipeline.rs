use rlcut_lib::{
    model::{ExportOptions, Preset},
    video::{binaries::Binaries, export, metadata, preview},
};
use std::{
    path::PathBuf,
    process::Command,
    sync::{atomic::AtomicU64, Arc},
};

struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn real_import_preview_and_export_worker() {
    let binaries = Binaries::detect(std::path::Path::new("resources"));
    if binaries.ffmpeg.is_none() || binaries.ffprobe.is_none() {
        eprintln!("Skipping real video worker test: FFmpeg/FFprobe missing");
        return;
    }
    let scratch = Scratch(std::env::temp_dir().join(format!(
        "rlcut-pipeline-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    )));
    std::fs::create_dir_all(&scratch.0).unwrap();
    let source = scratch.0.join("gameplay unicode é.mp4");
    let generated = Command::new(binaries.ffmpeg().unwrap())
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=640x360:rate=24:duration=0.5",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=0.8",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-c:a",
            "aac",
        ])
        .arg(&source)
        .output()
        .unwrap();
    assert!(
        generated.status.success(),
        "{}",
        String::from_utf8_lossy(&generated.stderr)
    );
    let video = metadata::probe(&binaries, &source).unwrap();
    assert!(video.has_audio);
    assert_eq!((video.width, video.height), (640, 360));
    let cache = scratch.0.join("previews");
    let preset = Preset::default();
    let epoch = Arc::new(AtomicU64::new(1));
    let frame = preview::render(&binaries, &video, &preset, 0.2, 480, &cache, &epoch, 1).unwrap();
    assert!(frame.composed.starts_with("data:image/png;base64,"));
    let cached = preview::render(&binaries, &video, &preset, 0.2, 480, &cache, &epoch, 1).unwrap();
    assert_eq!(frame.composed, cached.composed);
    let options = ExportOptions {
        ai_enhance: false,
        ai_upscale: false,
        ai_upscale_lite: false,
        ai_keep_resolution: false,
        effects: Vec::new(),
        quality: 480,
        fps: 30,
        folder: scratch.0.to_string_lossy().into_owned(),
        filename: "short.mp4".into(),
    };
    let destination = export::destination(&video, &options, false).unwrap();
    let job = Arc::new(export::Job::new(
        "integration".into(),
        destination.to_string_lossy().into_owned(),
        false,
    ));
    export::run(binaries.clone(), video, preset, options, job.clone());
    let progress = job.snapshot().unwrap();
    assert_eq!(progress.phase, "complete", "{:?}", progress.error);
    assert_eq!(progress.percent, 100.);
    let result = metadata::probe(&binaries, &destination).unwrap();
    assert_eq!((result.width, result.height), (480, 854));
    assert_eq!(result.fps, 30.);
    assert!(result.has_audio);
    assert!((result.duration - 0.5).abs() < 0.15);
    assert!(source.exists());
    assert!(!scratch.0.join(".rlcut-integration.partial.mp4").exists());
}
