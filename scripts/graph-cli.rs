#![allow(dead_code)]
#[path = "../src-tauri/src/video/args.rs"]
mod args;
#[path = "../src-tauri/src/video/geometry.rs"]
mod geometry;
#[path = "../src-tauri/src/model.rs"]
mod model;
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let width = a[1].parse().unwrap();
    let height = a[2].parse().unwrap();
    let quality = a[3].parse().unwrap();
    let fps = a[4].parse().unwrap();
    let v = model::Video {
        path: a.get(7).cloned().unwrap_or_else(|| "source.mp4".into()),
        width,
        height,
        duration: a.get(9).and_then(|v| v.parse().ok()).unwrap_or(1.),
        fps: 30.,
        has_audio: a.get(6).is_some_and(|v| v == "audio"),
        color_transfer: std::env::var("RLCUT_TEST_TRANSFER").unwrap_or_default(),
    };
    let mut p = model::Preset::default();
    if a.get(5).is_some_and(|v| v == "ellipse") {
        p.boost.shape = model::Shape::Ellipse;
        p.boost.height = 0.10;
        p.boost.feather = 0.05;
    }
    let o = model::ExportOptions {
        ai_enhance: false,
            ai_upscale: false,
        quality,
        fps,
        folder: String::new(),
        filename: String::new(),
    };
    let (w, h) = o.resolution().unwrap();
    if let Some(output) = a.get(8) {
        // NUL-delimited structured arguments preserve spaces and Unicode paths.
        for arg in args::export_args(&v, &p, &o, std::path::Path::new(output)).unwrap() {
            print!("{arg}\0");
        }
    } else {
        println!("{}", geometry::filter_graph(&v, &p, w, h).unwrap());
    }
}
