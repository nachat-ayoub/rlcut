//! Optional, offline RIFE interpolation. Frames are streamed; no clip-sized frame cache.
use super::{
    binaries::{command, Binaries},
    export::Job,
};
use crate::model::ExportOptions;
use std::{
    fs,
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{atomic::Ordering, Arc},
    thread,
    time::{Duration, Instant},
};

pub fn installation() -> Option<(PathBuf, PathBuf)> {
    let mut folders = Vec::new();
    if let Some(folder) = std::env::var_os("RLCUT_AI_DIR") {
        folders.push(PathBuf::from(folder));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            folders.push(dir.join("rlcut-ai"));
        }
    }
    folders.push(
        PathBuf::from(option_env!("CARGO_MANIFEST_DIR").unwrap_or("src-tauri"))
            .join("../.runtime/ai"),
    );
    folders.into_iter().find_map(|dir| {
        let binary = dir.join("rife-ncnn-vulkan");
        let model = dir.join("rife-v4.6");
        (cfg!(target_os = "linux")
            && binary.is_file()
            && dir.join("rlcut-ai-cpu").is_file()
            && dir.join("realesr-animevideov3-x2.param").is_file()
            && dir.join("realesr-animevideov3-x2.bin").is_file()
            && model.join("flownet.param").is_file()
            && model.join("flownet.bin").is_file())
        .then_some((binary, model))
    })
}

pub fn available() -> bool {
    installation().is_some()
}

// Restrict every enhancement subprocess to the same single allowed CPU and nice 15.
// Limit only RIFE's address space: encoders, Vulkan discovery and frame data remain separate.
// These are hard process limits, not a promise about total machine RAM or temperature.
pub fn low_pressure(c: &mut Command, inference: bool) {
    c.env("OMP_NUM_THREADS", "1")
        .env("OMP_THREAD_LIMIT", "1")
        .env("OPENBLAS_NUM_THREADS", "1");
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::process::CommandExt;
        unsafe extern "C" {
            fn sched_getaffinity(pid: i32, size: usize, mask: *mut u8) -> i32;
            fn sched_setaffinity(pid: i32, size: usize, mask: *const u8) -> i32;
            fn setpriority(which: i32, who: u32, priority: i32) -> i32;
            fn setrlimit(resource: i32, limit: *const [u64; 2]) -> i32;
        }
        c.process_group(0);
        // SAFETY: only async-signal-safe libc calls and stack operations after fork.
        unsafe {
            c.pre_exec(move || {
                let mut mask = [0u8; 128];
                if sched_getaffinity(0, mask.len(), mask.as_mut_ptr()) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                let mut selected = [0u8; 128];
                for (index, byte) in mask.iter().enumerate() {
                    if *byte != 0 {
                        selected[index] = 1 << byte.trailing_zeros();
                        break;
                    }
                }
                if sched_setaffinity(0, selected.len(), selected.as_ptr()) != 0
                    || setpriority(0, 0, 15) != 0
                {
                    return Err(std::io::Error::last_os_error());
                }
                if inference && setrlimit(9, &[1536 * 1024 * 1024; 2]) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = inference;
}

struct Process(Child);
impl Drop for Process {
    fn drop(&mut self) {
        #[cfg(target_os = "linux")]
        if matches!(self.0.try_wait(), Ok(None)) {
            unsafe extern "C" {
                fn kill(pid: i32, signal: i32) -> i32;
            }
            // This helper owns a private group; cancellation also terminates its RIFE child.
            unsafe {
                kill(-(self.0.id() as i32), 9);
            }
        }
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
struct Scratch(PathBuf);
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn canceled(job: &Job) -> Result<(), String> {
    if job.cancel.load(Ordering::SeqCst) {
        Err("Export canceled".into())
    } else {
        Ok(())
    }
}
fn pause(job: &Job) -> Result<(), String> {
    canceled(job)?;
    thread::sleep(Duration::from_millis(20));
    Ok(())
}

#[cfg(target_os = "linux")]
fn nonblocking<T: std::os::fd::AsRawFd>(pipe: &T) -> Result<(), String> {
    unsafe extern "C" {
        fn fcntl(fd: i32, cmd: i32, ...) -> i32;
    }
    let fd = pipe.as_raw_fd();
    // SAFETY: fcntl operates on the live pipe descriptor, preserving its other flags.
    unsafe {
        let flags = fcntl(fd, 3);
        if flags == -1 || fcntl(fd, 4, flags | 2048) == -1 {
            return Err(std::io::Error::last_os_error().to_string());
        }
    }
    Ok(())
}
#[cfg(not(target_os = "linux"))]
fn nonblocking<T>(_: &T) -> Result<(), String> {
    Err("AI export is currently available on Linux only".into())
}
fn read_exact(r: &mut impl Read, mut bytes: &mut [u8], job: &Job) -> Result<(), String> {
    while !bytes.is_empty() {
        canceled(job)?;
        match r.read(bytes) {
            Ok(0) => return Err("Unexpected end of decoded frame".into()),
            Ok(n) => bytes = &mut bytes[n..],
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => pause(job)?,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => return Err(format!("Cannot decode frame: {e}")),
        }
    }
    Ok(())
}
fn frame(r: &mut impl Read, job: &Job) -> Result<Option<Vec<u8>>, String> {
    let mut first = [0u8; 1];
    loop {
        canceled(job)?;
        match r.read(&mut first) {
            Ok(0) => return Ok(None),
            Ok(_) => break,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => pause(job)?,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    let mut png = vec![0u8; 8];
    png[0] = first[0];
    read_exact(r, &mut png[1..], job)?;
    if png != b"\x89PNG\r\n\x1a\n" {
        return Err("Invalid decoded PNG frame".into());
    }
    loop {
        let mut header = [0u8; 8];
        read_exact(r, &mut header, job)?;
        let length = u32::from_be_bytes(header[..4].try_into().unwrap()) as usize;
        if length > 16 * 1024 * 1024 || png.len() + length + 12 > 24 * 1024 * 1024 {
            return Err("Decoded frame exceeds safety limit".into());
        }
        png.extend_from_slice(&header);
        let offset = png.len();
        png.resize(offset + length + 4, 0);
        read_exact(r, &mut png[offset..], job)?;
        if &header[4..] == b"IEND" {
            return Ok(Some(png));
        }
    }
}
fn write_frame(w: &mut impl Write, mut bytes: &[u8], job: &Job) -> Result<(), String> {
    while !bytes.is_empty() {
        canceled(job)?;
        match w.write(bytes) {
            Ok(0) => return Err("Enhanced video encoder closed unexpectedly".into()),
            Ok(n) => bytes = &bytes[n..],
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => pause(job)?,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
            Err(e) => return Err(format!("Cannot encode enhanced frame: {e}")),
        }
    }
    Ok(())
}
struct Upscale {
    folder: PathBuf,
    scratch: PathBuf,
    log: PathBuf,
}
impl Upscale {
    fn frame(&self, bytes: &[u8], job: &Job) -> Result<Vec<u8>, String> {
        let input = self.scratch.join("upscale-in.png");
        let output = self.scratch.join("upscale-out.png");
        fs::write(&input, bytes).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&output);
        let mut worker = command(&self.folder.join("rlcut-ai-cpu"));
        worker
            .arg("upscale")
            .arg(self.folder.join("realesr-animevideov3-x2.param"))
            .arg(self.folder.join("realesr-animevideov3-x2.bin"))
            .arg(&input)
            .arg(&output)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(
                fs::OpenOptions::new()
                    .append(true)
                    .open(&self.log)
                    .map_err(|e| e.to_string())?,
            );
        low_pressure(&mut worker, true);
        wait(
            &mut Process(
                worker
                    .spawn()
                    .map_err(|e| format!("Cannot start AI upscaling: {e}"))?,
            ),
            job,
        )?;
        if fs::metadata(&output).map_err(|e| e.to_string())?.len() > 96 * 1024 * 1024 {
            return Err("AI upscale output exceeds the frame safety limit".into());
        }
        // Yield between frames even when smoothing is off.
        for _ in 0..5 {
            pause(job)?;
        }
        fs::read(output).map_err(|e| e.to_string())
    }
}
fn write_timed_frame(
    w: &mut impl Write,
    bytes: &[u8],
    job: &Job,
    written: &mut u64,
    limit: u64,
    upscaler: Option<&Upscale>,
) -> Result<(), String> {
    if *written < limit {
        if let Some(upscaler) = upscaler {
            write_frame(w, &upscaler.frame(bytes, job)?, job)?;
        } else {
            write_frame(w, bytes, job)?;
        }
        *written += 1;
    }
    Ok(())
}
fn wait(process: &mut Process, job: &Job) -> Result<(), String> {
    let started = Instant::now();
    let elapsed = job.snapshot()?.elapsed;
    loop {
        if let Ok(mut progress) = job.progress.lock() {
            progress.elapsed = elapsed + started.elapsed().as_secs_f64();
        }
        canceled(job)?;
        match process.0.try_wait().map_err(|e| e.to_string())? {
            Some(status) if status.success() => return Ok(()),
            Some(_) => return Err("AI export subprocess failed. Try 480p and close other apps; see the export diagnostics.".into()),
            None => pause(job)?,
        }
    }
}

pub fn run(
    b: &Binaries,
    input: &Path,
    output: &Path,
    o: &ExportOptions,
    duration: f64,
    cuts: &[f64],
    job: Arc<Job>,
    start: Instant,
    log: &Path,
) -> Result<(), String> {
    if let Ok(mut p) = job.progress.lock() {
        p.stage = Some(
            match (o.ai_enhance, o.ai_upscale) {
                (true, true) => "AI smoothing + upscaling ×2 · CPU tiles",
                (true, false) => "AI smoothing · CPU tiles",
                _ => "AI upscaling ×2 · CPU tiles",
            }
            .into(),
        );
        p.remaining = None;
    }
    let (binary, model) = installation().ok_or("AI engine is missing. Install the Linux AI-enabled AppImage, or run scripts/prepare-ai.py for a development checkout.")?;
    let scratch_path = input.with_extension("frames");
    fs::create_dir(&scratch_path).map_err(|e| format!("Cannot create AI scratch folder: {e}"))?;
    let scratch = Scratch(scratch_path);
    let ai_folder = binary
        .parent()
        .ok_or("AI engine folder is unavailable")?
        .to_path_buf();
    let upscaler = o.ai_upscale.then(|| Upscale {
        folder: ai_folder.clone(),
        scratch: scratch.0.clone(),
        log: log.to_path_buf(),
    });
    let before = scratch.0.join("before.png");
    let after = scratch.0.join("after.png");
    let middle = scratch.0.join("middle.png");
    let diagnostics = || {
        fs::OpenOptions::new()
            .append(true)
            .open(log)
            .map_err(|e| e.to_string())
    };
    let mut decode = command(b.ffmpeg()?);
    decode
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-threads",
            "1",
            "-i",
        ])
        .arg(input)
        .args([
            "-an",
            "-filter_threads",
            "1",
            "-vf",
            "scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24",
            "-threads",
            "1",
            "-c:v",
            "png",
            "-f",
            "image2pipe",
            "pipe:1",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(diagnostics()?);
    low_pressure(&mut decode, false);
    let mut decoder = Process(
        decode
            .spawn()
            .map_err(|e| format!("Cannot decode for AI: {e}"))?,
    );
    let decoded = decoder.0.stdout.take().ok_or("Missing AI decoder pipe")?;
    nonblocking(&decoded)?;
    let mut reader = BufReader::new(decoded);
    let mut encode = command(b.ffmpeg()?);
    encode
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-n",
            "-threads",
            "1",
            "-f",
            "image2pipe",
            "-framerate",
        ])
        .arg(o.fps.to_string())
        .args(["-i", "pipe:0", "-i"])
        .arg(input)
        .args([
            "-map",
            "0:v:0",
            "-map",
            "1:a?",
            "-c:a",
            "copy",
            "-vf",
            "scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p,unsharp=5:5:0.25:5:5:0",
            "-filter_threads",
            "1",
            "-c:v",
            "libx264",
            "-threads",
            "1",
            "-preset",
            "veryfast",
            "-crf",
            "17",
            "-pix_fmt",
            "yuv420p",
            "-color_range",
            "tv",
            "-colorspace",
            "bt709",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-t",
        ])
        .arg(format!("{duration:.6}"))
        .args(["-movflags", "+faststart"])
        .arg(output)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(diagnostics()?);
    low_pressure(&mut encode, false);
    let mut encoder = Process(
        encode
            .spawn()
            .map_err(|e| format!("Cannot start enhanced encoder: {e}"))?,
    );
    let mut sink = encoder
        .0
        .stdin
        .take()
        .ok_or("Missing enhanced encoder pipe")?;
    nonblocking(&sink)?;
    let mut current = frame(&mut reader, &job)?.ok_or("No frames to enhance")?;
    let base_fps = if o.ai_enhance {
        o.fps as f64 / 2.
    } else {
        o.fps as f64
    };
    let mut index = 0u64;
    let mut written = 0u64;
    // A fractional source duration can end on a half-pair. Do not write extra
    // PNGs after FFmpeg has reached -t and closed its input pipe.
    let frame_limit = (duration * o.fps as f64).ceil() as u64;
    loop {
        canceled(&job)?;
        let next = frame(&mut reader, &job)?;
        write_timed_frame(
            &mut sink,
            &current,
            &job,
            &mut written,
            frame_limit,
            upscaler.as_ref(),
        )?;
        if let Some(next) = next {
            if !o.ai_enhance {
                current = next;
                index += 1;
                if let Ok(mut p) = job.progress.lock() {
                    let fraction = (index as f64 / base_fps / duration).clamp(0., 1.);
                    p.percent = (20. + fraction * 79.9).min(99.9);
                    p.elapsed = start.elapsed().as_secs_f64();
                    p.remaining = if fraction > 0. {
                        Some(p.elapsed * (1. - fraction) / fraction)
                    } else {
                        None
                    };
                    p.stage = Some("AI upscaling ×2 · CPU tiles".into());
                }
                continue;
            }
            let time = index as f64 / base_fps;
            let cut = cuts
                .iter()
                .any(|cut| *cut > time && *cut <= time + 1. / base_fps + 0.00001);
            if cut {
                // Never invent a morph between different timeline clips.
                write_timed_frame(
                    &mut sink,
                    &current,
                    &job,
                    &mut written,
                    frame_limit,
                    upscaler.as_ref(),
                )?;
            } else {
                fs::write(&before, &current).map_err(|e| e.to_string())?;
                fs::write(&after, &next).map_err(|e| e.to_string())?;
                let _ = fs::remove_file(&middle);
                let mut inference = command(&ai_folder.join("rlcut-ai-cpu"));
                inference
                    .arg("interpolate")
                    .arg(&binary)
                    .arg(&model)
                    .arg(&before)
                    .arg(&after)
                    .arg(&middle)
                    .arg(&scratch.0)
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(diagnostics()?);
                // The CPU backend needs the Vulkan loader but never an actual GPU/driver.
                // Avoid driver initialization consuming memory before RIFE inference starts.
                inference
                    .env("VK_ICD_FILENAMES", "/dev/null")
                    .env("VK_DRIVER_FILES", "/dev/null");
                low_pressure(&mut inference, true);
                wait(
                    &mut Process(
                        inference
                            .spawn()
                            .map_err(|e| format!("Cannot start RIFE: {e}"))?,
                    ),
                    &job,
                )?;
                let length = fs::metadata(&middle)
                    .map_err(|e| format!("RIFE did not produce a frame: {e}"))?
                    .len();
                if length == 0 || length > 24 * 1024 * 1024 {
                    return Err("RIFE output frame is invalid".into());
                }
                write_timed_frame(
                    &mut sink,
                    &fs::read(&middle).map_err(|e| e.to_string())?,
                    &job,
                    &mut written,
                    frame_limit,
                    upscaler.as_ref(),
                )?;
                // A short idle interval reduces sustained pressure; inference never uses the GPU.
                for _ in 0..5 {
                    pause(&job)?;
                }
            }
            current = next;
        } else {
            if o.ai_enhance {
                write_timed_frame(
                    &mut sink,
                    &current,
                    &job,
                    &mut written,
                    frame_limit,
                    upscaler.as_ref(),
                )?;
            }
            break;
        }
        index += 1;
        if let Ok(mut p) = job.progress.lock() {
            let fraction = (index as f64 / base_fps / duration).clamp(0., 1.);
            p.percent = (20. + fraction * 79.9).min(99.9);
            p.elapsed = start.elapsed().as_secs_f64();
            p.remaining = if fraction > 0. {
                Some(p.elapsed * (1. - fraction) / fraction)
            } else {
                None
            };
            p.stage = Some(
                if o.ai_upscale {
                    "AI smoothing + upscaling ×2 · CPU tiles"
                } else {
                    "AI smoothing · CPU tiles"
                }
                .into(),
            );
        }
    }
    drop(sink);
    wait(&mut decoder, &job)?;
    wait(&mut encoder, &job)?;
    Ok(())
}
