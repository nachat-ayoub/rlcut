use rlcut_lib::{
    model::{Preset, Shape},
    video::{
        binaries::{command, Binaries},
        geometry::filter_graph,
        metadata,
    },
};
use serde_json::json;
use std::path::PathBuf;
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let root = PathBuf::from(&args[1]);
    let input = PathBuf::from(&args[2]);
    let folder = PathBuf::from(&args[3]);
    std::fs::create_dir_all(&folder).unwrap();
    let tools = Binaries {
        ffmpeg: Some(root.join("usr/bin/ffmpeg")),
        ffprobe: Some(root.join("usr/bin/ffprobe")),
        ffplay: None,
    };
    let mut video = metadata::probe(&tools, &input).unwrap();
    video.width = 1280;
    video.height = 720;
    let source = folder.join("source.png");
    assert!(command(tools.ffmpeg().unwrap())
        .args(["-v", "error", "-y", "-ss", "0.5", "-i"])
        .arg(&input)
        .args(["-frames:v", "1", "-threads", "1"])
        .arg(&source)
        .status()
        .unwrap()
        .success());
    let mut cases = Vec::new();
    for variant in 0..3 {
        let mut p = Preset::default();
        if variant == 0 {
            p.boost.enabled = false;
        }
        if variant == 2 {
            p.boost.shape = Shape::Ellipse;
            p.boost.width = 0.32;
            p.boost.height = 0.10;
            p.boost.feather = 0.12;
            p.gameplay.scale = 1.65;
            p.gameplay.x = 0.62;
            p.gameplay.y = 0.33;
            p.background.scale = 1.4;
            p.background.blur = 55.;
            p.background.brightness = -0.12;
        }
        let target = folder.join(format!("reference-{variant}.png"));
        let graph = filter_graph(&video, &p, 480, 854).unwrap();
        assert!(command(tools.ffmpeg().unwrap())
            .args([
                "-v",
                "error",
                "-y",
                "-filter_complex_threads",
                "1",
                "-ss",
                "0.5",
                "-i"
            ])
            .arg(&input)
            .args([
                "-filter_complex",
                &graph,
                "-map",
                "[out]",
                "-frames:v",
                "1",
                "-threads",
                "1"
            ])
            .arg(&target)
            .status()
            .unwrap()
            .success());
        cases.push(json!({"preset":p,"reference":target}));
    }
    println!("{}", json!({"video":video,"source":source,"cases":cases}));
}
