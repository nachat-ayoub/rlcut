#[cfg(any(target_os = "linux", target_os = "windows"))]
fn main() {
    use rlcut_lib::{model::Segment, video::player::Player};
    use std::{
        path::PathBuf,
        thread,
        time::{Duration, Instant},
    };

    let path = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .expect("usage: player-fps VIDEO");
    let mut player = Player::open(
        &path.to_string_lossy(),
        640,
        360,
        0.,
        vec![Segment {
            start: 0.,
            end: 60.,
            volume: 1.,
            color_fix: 0.,
        }],
        PathBuf::from("ffmpeg"),
        Some(PathBuf::from("ffplay")),
    )
    .expect("native player should open");
    player.play(true).expect("native player should play");
    let started = Instant::now();
    let mut sequence = 0u32;
    let mut frames = 0u32;
    while started.elapsed() < Duration::from_secs(2) {
        player.pump();
        let packet = player.frame(sequence).expect("frame packet");
        if packet.len() > 32 {
            sequence = u32::from_le_bytes(packet[8..12].try_into().unwrap());
            frames += 1;
        }
        thread::sleep(Duration::from_millis(2));
    }
    let fps = frames as f64 / started.elapsed().as_secs_f64();
    println!("{frames} distinct native frames, {fps:.1} FPS");
    assert!(fps >= 30., "native decoding fell below 30 FPS");
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn main() {
    eprintln!("The native playback FPS check is not available on this platform");
}
