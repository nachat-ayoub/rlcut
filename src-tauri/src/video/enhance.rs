//! Optional offline RIFE/upscaling with streamed decoding and resumable output-frame checkpoints.
use super::{
    binaries::{command, Binaries},
    export::Job,
};
use crate::model::ExportOptions;
use std::{
    cell::{Cell, RefCell},
    fs,
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    rc::Rc,
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
        let suffix = if cfg!(windows) { ".exe" } else { "" };
        let binary = dir.join(format!("rlcut-ai-cpu{suffix}"));
        let model = dir.join("rife-v4.6");
        (binary.is_file()
            && dir.join("realesr-animevideov3-x2.param").is_file()
            && dir.join("realesr-animevideov3-x2.bin").is_file()
            && dir.join("upscayl-lite-4x.param").is_file()
            && dir.join("upscayl-lite-4x.bin").is_file()
            && model.join("flownet.param").is_file()
            && model.join("flownet.bin").is_file())
        .then_some((binary, model))
    })
}

pub fn available() -> bool {
    installation().is_some()
}

fn ai_threads() -> usize {
    std::env::var("RLCUT_AI_THREADS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or_else(|| {
            std::thread::available_parallelism().map_or(2, |value| {
                let cpus = value.get();
                if cpus >= 8 {
                    cpus.saturating_sub(2)
                } else {
                    (cpus / 2).max(1)
                }
            })
        })
        .clamp(1, 12)
}

fn tile_workers() -> usize {
    // Reserve RAM for the editor/decoder and bound concurrent activation tensors.
    let available_kib = fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|text| {
            text.lines().find_map(|line| {
                line.strip_prefix("MemAvailable:")
                    .and_then(|v| v.split_whitespace().next())
                    .and_then(|v| v.parse::<u64>().ok())
            })
        })
        .unwrap_or(0);
    if ai_threads() >= 10 && available_kib >= 6 * 1024 * 1024 {
        3
    } else if ai_threads() >= 6 && available_kib >= 3 * 1024 * 1024 {
        2
    } else {
        1
    }
}

fn gpu_backend(
    folder: &Path,
    scratch: &Path,
    job: &Job,
    log: &Path,
) -> Result<Option<String>, String> {
    if std::env::var("RLCUT_AI_DEVICE").as_deref() == Ok("cpu")
        || !folder.join("rlcut-ai-gpu").is_file()
    {
        return Ok(None);
    }
    let result = scratch.join("gpu-probe");
    let mut c = command(&folder.join("rlcut-ai-gpu"));
    c.arg("probe-gpu")
        .stdin(Stdio::null())
        .stdout(fs::File::create(&result).map_err(|e| e.to_string())?)
        .stderr(
            fs::OpenOptions::new()
                .append(true)
                .open(log)
                .map_err(|e| e.to_string())?,
        );
    // Vulkan drivers reserve large virtual address ranges; CPU RLIMIT_AS would
    // prevent valid drivers from starting. Tile sizes bound device allocations.
    low_pressure(&mut c, false);
    let Ok(child) = c.spawn() else {
        return Ok(None);
    };
    let mut process = Process(child);
    let began = Instant::now();
    loop {
        canceled(job)?;
        if let Some(status) = process.0.try_wait().map_err(|e| e.to_string())? {
            if status.success() {
                return Ok(fs::read_to_string(&result)
                    .ok()
                    .and_then(|s| s.lines().nth(1).map(str::to_owned)));
            }
            return Ok(None);
        }
        if began.elapsed() > Duration::from_secs(5) {
            return Ok(None);
        }
        pause(job)?;
    }
}

// Use a small bounded CPU set and low priority so exports finish materially faster without
// monopolizing the laptop. Limit only inference address space; encoders remain separate.
// These are hard process limits, not a promise about total machine RAM or temperature.
pub fn low_pressure(c: &mut Command, inference: bool) {
    let threads = ai_threads();
    c.env("RLCUT_AI_THREADS", threads.to_string())
        .env("OMP_NUM_THREADS", threads.to_string())
        .env("OMP_THREAD_LIMIT", threads.to_string())
        .env("OPENBLAS_NUM_THREADS", threads.to_string())
        .env("RLCUT_AI_TILE_WORKERS", tile_workers().to_string())
        .env("OMP_WAIT_POLICY", "PASSIVE");
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
                let mut count = 0usize;
                'cpus: for (index, byte) in mask.iter().enumerate() {
                    for bit in 0..8 {
                        if byte & (1 << bit) != 0 {
                            selected[index] |= 1 << bit;
                            count += 1;
                            if count >= threads {
                                break 'cpus;
                            }
                        }
                    }
                }
                if sched_setaffinity(0, selected.len(), selected.as_ptr()) != 0
                    || setpriority(0, 0, 15) != 0
                {
                    return Err(std::io::Error::last_os_error());
                }
                if inference && setrlimit(9, &[3 * 1024 * 1024 * 1024; 2]) != 0 {
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
struct FrameCache {
    folder: PathBuf,
}
impl FrameCache {
    fn path(&self, index: u64) -> PathBuf {
        self.folder.join(format!("{index:08}.png"))
    }
    fn load(&self, index: u64) -> Option<Vec<u8>> {
        let bytes = fs::read(self.path(index)).ok()?;
        (bytes.len() <= 96 * 1024 * 1024 && bytes.starts_with(b"\x89PNG\r\n\x1a\n"))
            .then_some(bytes)
    }
    fn contains(&self, index: u64) -> bool {
        let path = self.path(index);
        fs::metadata(&path)
            .is_ok_and(|metadata| metadata.len() >= 8 && metadata.len() <= 96 * 1024 * 1024)
            && fs::File::open(path)
                .and_then(|mut file| {
                    let mut signature = [0; 8];
                    file.read_exact(&mut signature).map(|_| signature)
                })
                .is_ok_and(|signature| signature == *b"\x89PNG\r\n\x1a\n")
    }
    fn store(&self, index: u64, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() > 96 * 1024 * 1024 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err("AI checkpoint frame is invalid".into());
        }
        let output = self.path(index);
        let temporary = self.folder.join(format!("{index:08}.partial"));
        fs::write(&temporary, bytes)
            .map_err(|e| format!("Cannot write AI checkpoint frame: {e}"))?;
        #[cfg(target_os = "windows")]
        if output.exists() {
            fs::remove_file(&output).map_err(|e| e.to_string())?;
        }
        fs::rename(&temporary, &output)
            .map_err(|e| format!("Cannot commit AI checkpoint frame: {e}"))
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
    // Windows anonymous pipes do not expose Unix O_NONBLOCK. The frame pipes
    // are continuously drained by FFmpeg and the tiny worker command pipe is
    // bounded to one request, so blocking I/O remains safe here.
    Ok(())
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
const UPSCALE_CORE: u64 = 256;
const RIFE_STEP: u64 = 576;
const RIFE_WEIGHT: f64 = 6.;
fn tile_count(width: u32, height: u32, step: u64) -> u64 {
    (u64::from(width).div_ceil(step)) * (u64::from(height).div_ceil(step))
}
fn status(path: &Path) -> Option<(u64, u64)> {
    let text = fs::read_to_string(path).ok()?;
    let (done, total) = text.trim().split_once('/')?;
    Some((done.parse().ok()?, total.parse().ok()?))
}
struct AiProgress {
    completed: f64,
    total: f64,
    work_started: Option<Instant>,
    work_completed: f64,
    work_total: f64,
    label: String,
}
impl AiProgress {
    fn report(
        &mut self,
        job: &Job,
        export_start: Instant,
        done: u64,
        total: u64,
        weight: f64,
        detail: &str,
    ) {
        if total == 0 {
            return;
        }
        let effective = (self.completed + done.min(total) as f64 * weight).min(self.total);
        let fraction = (effective / self.total.max(1.)).clamp(0., 1.);
        let measured = (self.work_completed + done.min(total) as f64 * weight).min(self.work_total);
        let work_started = self.work_started.get_or_insert_with(Instant::now);
        let work_elapsed = work_started.elapsed().as_secs_f64();
        if let Ok(mut progress) = job.progress.lock() {
            progress.percent = progress.percent.max((20. + fraction * 69.9).min(89.9));
            progress.elapsed = export_start.elapsed().as_secs_f64();
            progress.remaining = (measured >= weight && measured < self.work_total)
                .then(|| (work_elapsed / measured * (self.work_total - measured)).max(0.));
            progress.stage = Some(format!(
                "{} · {detail} · tile {}/{total}",
                self.label,
                done.min(total)
            ));
        }
    }
    fn finish(&mut self, units: u64, weight: f64) {
        let amount = units as f64 * weight;
        self.completed = (self.completed + amount).min(self.total);
        self.work_completed = (self.work_completed + amount).min(self.work_total);
    }
    fn cached(&mut self, job: &Job, export_start: Instant, units: u64, weight: f64, detail: &str) {
        self.completed = (self.completed + units as f64 * weight).min(self.total);
        let fraction = (self.completed / self.total.max(1.)).clamp(0., 1.);
        if let Ok(mut progress) = job.progress.lock() {
            progress.percent = progress.percent.max((20. + fraction * 69.9).min(89.9));
            progress.elapsed = export_start.elapsed().as_secs_f64();
            progress.remaining = None;
            progress.stage = Some(format!("{} · resumed {detail}", self.label));
        }
    }
}
struct Worker {
    process: Process,
    input: std::process::ChildStdin,
}
struct Session {
    worker: RefCell<Option<Worker>>,
    folder: PathBuf,
    scratch: PathBuf,
    log: PathBuf,
    gpu: Cell<bool>,
    backend: String,
    tile_workers: usize,
}
impl Session {
    fn description(&self) -> String {
        if self.gpu.get() {
            format!("Vulkan GPU · {}", self.backend)
        } else {
            format!(
                "CPU · {} threads · {} parallel tiles",
                ai_threads(),
                self.tile_workers
            )
        }
    }
    fn request(
        &self,
        mode: &str,
        state: &Path,
        job: &Job,
        mut report: impl FnMut(u64, u64),
    ) -> Result<(), String> {
        let first = self.request_once(mode, state, job, &mut report);
        if first.is_err() && self.gpu.get() && mode.starts_with("upscale") {
            canceled(job)?;
            // A driver may enumerate successfully but fail allocation/inference.
            // Kill its private process before retrying the same full-AI frame.
            if let Err(error) = &first {
                if let Ok(mut log) = fs::OpenOptions::new().append(true).open(&self.log) {
                    let _ = writeln!(log, "Vulkan fallback: {error}");
                }
            }
            self.worker.borrow_mut().take();
            self.gpu.set(false);
            if let Ok(mut p) = job.progress.lock() {
                p.warning = Some("Vulkan inference failed; continuing full AI processing on CPU. See export diagnostics.".into());
            }
            self.request_once(mode, state, job, report)
        } else {
            first
        }
    }
    fn request_once(
        &self,
        mode: &str,
        state: &Path,
        job: &Job,
        mut report: impl FnMut(u64, u64),
    ) -> Result<(), String> {
        canceled(job)?;
        if self.worker.borrow().is_none() {
            let gpu = self.gpu.get();
            let mut command =
                command(
                    &self
                        .folder
                        .join(if gpu { "rlcut-ai-gpu" } else { "rlcut-ai-cpu" }),
                );
            command
                .arg(if gpu { "serve-gpu" } else { "serve" })
                .arg(&self.folder)
                .current_dir(&self.scratch)
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(
                    fs::OpenOptions::new()
                        .append(true)
                        .open(&self.log)
                        .map_err(|e| e.to_string())?,
                );
            low_pressure(&mut command, !gpu);
            command.env("RLCUT_AI_TILE_WORKERS", self.tile_workers.to_string());
            let mut process = Process(
                command
                    .spawn()
                    .map_err(|e| format!("Cannot start persistent AI worker: {e}"))?,
            );
            let input = process.0.stdin.take().ok_or("Missing AI command pipe")?;
            nonblocking(&input)?;
            *self.worker.borrow_mut() = Some(Worker { process, input });
        }
        let result = self.scratch.join("worker-result");
        let _ = fs::remove_file(&result);
        let _ = fs::remove_file(state);
        write_frame(
            &mut self.worker.borrow_mut().as_mut().unwrap().input,
            format!("{mode}\n").as_bytes(),
            job,
        )?;
        let mut last = None;
        let mut activity = Instant::now();
        loop {
            canceled(job)?;
            if let Ok(text) = fs::read_to_string(&result) {
                if text == "ok" {
                    if let Some((a, b)) = status(state) {
                        report(a, b);
                    }
                    return Ok(());
                }
                return Err(format!("Persistent AI worker: {text}"));
            }
            if let Some(value) = status(state) {
                if last != Some(value) {
                    report(value.0, value.1);
                    last = Some(value);
                    activity = Instant::now();
                }
            }
            if self.gpu.get()
                && mode.starts_with("upscale")
                && activity.elapsed() > Duration::from_secs(180)
            {
                return Err("Vulkan inference stopped reporting tile progress".into());
            }
            if self
                .worker
                .borrow_mut()
                .as_mut()
                .unwrap()
                .process
                .0
                .try_wait()
                .map_err(|e| e.to_string())?
                .is_some()
            {
                return Err("AI worker exited unexpectedly; inspect export diagnostics".into());
            }
            if let Ok(mut p) = job.progress.lock() {
                p.elapsed = job.started.elapsed().as_secs_f64();
            }
            pause(job)?;
        }
    }
}
struct Upscale {
    mode: &'static str,
    session: Rc<Session>,
    tiles: u64,
    previous: RefCell<Option<(Vec<u8>, Vec<u8>)>>,
}
impl Upscale {
    fn frame(
        &self,
        bytes: &[u8],
        job: &Job,
        progress: &mut AiProgress,
        export_start: Instant,
        detail: &str,
    ) -> Result<Vec<u8>, String> {
        // Frame-rate conversion and cuts can repeat an identical PNG. Keep only
        // the previous input/output pair instead of running the network again.
        if let Some((source, output)) = self.previous.borrow().as_ref() {
            if source == bytes {
                progress.report(
                    job,
                    export_start,
                    self.tiles,
                    self.tiles,
                    1.,
                    "reusing duplicate frame",
                );
                progress.finish(self.tiles, 1.);
                return Ok(output.clone());
            }
        }
        let input = self.session.scratch.join("upscale-in.png");
        let output = self.session.scratch.join("upscale-out.png");
        let state = self.session.scratch.join("upscale-progress");
        fs::write(&input, bytes).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&output);
        self.session
            .request(self.mode, &state, job, |done, total| {
                progress.report(
                    job,
                    export_start,
                    done,
                    total,
                    1.,
                    &format!("{detail} · {}", self.session.description()),
                )
            })?;
        progress.report(
            job,
            export_start,
            self.tiles,
            self.tiles,
            1.,
            &format!("{detail} · {}", self.session.description()),
        );
        progress.finish(self.tiles, 1.);
        if fs::metadata(&output).map_err(|e| e.to_string())?.len() > 96 * 1024 * 1024 {
            return Err("AI upscale output exceeds the frame safety limit".into());
        }
        let result = fs::read(output).map_err(|e| e.to_string())?;
        *self.previous.borrow_mut() = Some((bytes.to_vec(), result.clone()));
        Ok(result)
    }
}
#[allow(clippy::too_many_arguments)] // Per-frame AI state is explicit to keep checkpointing deterministic.
fn write_timed_frame(
    w: &mut impl Write,
    bytes: &[u8],
    job: &Job,
    written: &mut u64,
    limit: u64,
    upscaler: Option<&Upscale>,
    progress: &mut AiProgress,
    export_start: Instant,
    cache: &FrameCache,
) -> Result<(), String> {
    if *written < limit {
        let detail = format!("frame {}/{}", *written + 1, limit);
        if let Some(cached) = cache.load(*written) {
            write_frame(w, &cached, job)?;
            if let Some(upscaler) = upscaler {
                progress.cached(job, export_start, upscaler.tiles, 1., &detail);
            }
        } else {
            let output = if let Some(upscaler) = upscaler {
                upscaler.frame(bytes, job, progress, export_start, &detail)?
            } else {
                bytes.to_vec()
            };
            cache.store(*written, &output)?;
            write_frame(w, &output, job)?;
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

#[allow(clippy::too_many_arguments)] // AI worker entry point owns all resumable-export context.
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
    checkpoint: &Path,
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
    let (binary, _model) = installation()
        .ok_or("AI engine is missing. Reinstall the complete AI-enabled rlcut package.")?;
    let (width, height) = o.ai_input_resolution()?;
    let upscale_tiles = tile_count(width, height, UPSCALE_CORE);
    let rife_tiles = tile_count(width, height, RIFE_STEP);
    let scratch_path = input.with_extension("frames");
    fs::create_dir(&scratch_path).map_err(|e| format!("Cannot create AI scratch folder: {e}"))?;
    let scratch = Scratch(scratch_path);
    fs::create_dir_all(checkpoint)
        .map_err(|e| format!("Cannot open resumable AI checkpoint: {e}"))?;
    let frame_cache = FrameCache {
        folder: checkpoint.to_path_buf(),
    };
    let ai_folder = binary
        .parent()
        .ok_or("AI engine folder is unavailable")?
        .to_path_buf();
    let gpu = if o.ai_upscale {
        gpu_backend(&ai_folder, &scratch.0, &job, log)?
    } else {
        None
    };
    if o.ai_upscale && gpu.is_none() {
        if let Ok(mut p) = job.progress.lock() {
            p.warning = Some(format!("No usable hardware Vulkan GPU detected; using {} CPU threads with {} parallel tile workers. A working GPU driver is required for GPU acceleration.", ai_threads(), tile_workers()));
        }
    }
    let session = Rc::new(Session {
        worker: RefCell::new(None),
        folder: ai_folder.canonicalize().map_err(|e| e.to_string())?,
        scratch: scratch.0.clone(),
        log: log.to_path_buf(),
        gpu: Cell::new(gpu.is_some()),
        backend: gpu.unwrap_or_default(),
        tile_workers: tile_workers(),
    });
    if let Ok(mut log) = fs::OpenOptions::new().append(true).open(log) {
        let _ = writeln!(log, "AI execution: {}", session.description());
    }
    let upscaler = o.ai_upscale.then(|| Upscale {
        mode: if o.ai_upscale_lite {
            "upscale-lite"
        } else {
            "upscale"
        },
        session: session.clone(),
        tiles: upscale_tiles,
        previous: RefCell::new(None),
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
            &format!("scale={width}:{height}:flags=lanczos:in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24"),
            "-threads",
            "1",
            "-c:v",
            "png",
            "-compression_level",
            "1",
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
    let source_frames = (duration * base_fps).ceil() as u64;
    let crosses_cut = |index: u64| {
        let time = index as f64 / base_fps;
        cuts.iter()
            .any(|cut| *cut > time && *cut <= time + 1. / base_fps + 0.00001)
    };
    let rife_calls = (0..source_frames.saturating_sub(1))
        .filter(|index| !crosses_cut(*index))
        .count() as u64;
    let total_units = (if o.ai_upscale {
        frame_limit * upscale_tiles
    } else {
        0
    }) as f64
        + (if o.ai_enhance {
            rife_calls * rife_tiles
        } else {
            0
        }) as f64
            * RIFE_WEIGHT;
    let upscale_work = if o.ai_upscale {
        (0..frame_limit)
            .filter(|frame| !frame_cache.contains(*frame))
            .count() as u64
            * upscale_tiles
    } else {
        0
    };
    let rife_work = if o.ai_enhance {
        (0..source_frames.saturating_sub(1))
            .filter(|index| {
                let output = (*index).saturating_mul(2).saturating_add(1);
                output < frame_limit && !crosses_cut(*index) && !frame_cache.contains(output)
            })
            .count() as u64
            * rife_tiles
    } else {
        0
    };
    let work_total = upscale_work as f64 + rife_work as f64 * RIFE_WEIGHT;
    let label = match (o.ai_enhance, o.ai_upscale) {
        (true, true) => "AI smoothing + upscaling ×2",
        (true, false) => "AI smoothing",
        _ => "AI upscaling ×2",
    };
    let mut ai_progress = AiProgress {
        completed: 0.,
        total: total_units.max(1.),
        work_started: None,
        work_completed: 0.,
        work_total,
        label: label.into(),
    };
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
            &mut ai_progress,
            start,
            &frame_cache,
        )?;
        if let Some(next) = next {
            if !o.ai_enhance {
                current = next;
                index += 1;
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
                    &mut ai_progress,
                    start,
                    &frame_cache,
                )?;
            } else {
                let detail = format!("source frame {}/{}", index + 1, source_frames);
                if written < frame_limit && frame_cache.contains(written) {
                    ai_progress.cached(&job, start, rife_tiles, RIFE_WEIGHT, &detail);
                    write_timed_frame(
                        &mut sink,
                        &[],
                        &job,
                        &mut written,
                        frame_limit,
                        upscaler.as_ref(),
                        &mut ai_progress,
                        start,
                        &frame_cache,
                    )?;
                } else if written < frame_limit {
                    fs::write(&before, &current).map_err(|e| e.to_string())?;
                    fs::write(&after, &next).map_err(|e| e.to_string())?;
                    let _ = fs::remove_file(&middle);
                    let state = scratch.0.join("rife-progress");
                    let _ = fs::remove_file(&state);
                    session.request("interpolate", &state, &job, |done, total| {
                        ai_progress.report(&job, start, done, total, RIFE_WEIGHT, &detail)
                    })?;
                    ai_progress.report(&job, start, rife_tiles, rife_tiles, RIFE_WEIGHT, &detail);
                    ai_progress.finish(rife_tiles, RIFE_WEIGHT);
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
                        &mut ai_progress,
                        start,
                        &frame_cache,
                    )?;
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
                    &mut ai_progress,
                    start,
                    &frame_cache,
                )?;
            }
            break;
        }
        index += 1;
    }
    drop(sink);
    wait(&mut decoder, &job)?;
    wait(&mut encoder, &job)?;
    drop(upscaler);
    drop(session);
    Ok(())
}
