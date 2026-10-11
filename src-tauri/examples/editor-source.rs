use rlcut_lib::video::{binaries::Binaries, decoder, metadata};
use std::{
    path::PathBuf,
    sync::{atomic::AtomicU64, Arc},
};
fn main() {
    let arguments: Vec<_> = std::env::args().collect();
    let root = PathBuf::from(&arguments[1]);
    let binaries = Binaries {
        ffmpeg: Some(root.join("usr/bin/ffmpeg")),
        ffprobe: Some(root.join("usr/bin/ffprobe")),
    };
    let video = metadata::probe(&binaries, &PathBuf::from(&arguments[2])).unwrap();
    let epoch = Arc::new(AtomicU64::new(1));
    let cache = PathBuf::from(&arguments[3]);
    let path = decoder::prepare(&binaries, &video, &cache, &epoch, 1).unwrap();
    let stamp = path.metadata().unwrap().modified().unwrap();
    assert_eq!(
        decoder::prepare(&binaries, &video, &cache, &epoch, 1).unwrap(),
        path
    );
    assert_eq!(
        path.metadata().unwrap().modified().unwrap(),
        stamp,
        "Source was decoded twice"
    );
    let decoded = metadata::probe(&binaries, &path).unwrap();
    assert!(decoded.width <= 960 && decoded.height <= 960);
    assert!((decoded.fps - if video.fps >= 50. { 60. } else { 30. }).abs() < 0.01);
    assert_eq!(decoded.color_transfer, "bt709");
    println!("{}", serde_json::to_string(&decoded).unwrap());
}
