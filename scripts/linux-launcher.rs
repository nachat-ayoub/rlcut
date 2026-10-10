//! Single-file, FUSE-independent launcher for the bundled Linux AppImage.
//! Built in the Ubuntu 22.04 packaging environment, never in the running app.
use std::{
    fs,
    io::Write,
    os::unix::fs::{DirBuilderExt, OpenOptionsExt},
    path::PathBuf,
    process::{Command, ExitCode},
    time::{SystemTime, UNIX_EPOCH},
};
const APPIMAGE: &[u8] = include_bytes!("../dist/rlcut.AppImage");
struct Temporary(PathBuf);
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
fn launch() -> Result<i32, Box<dyn std::error::Error>> {
    let unique = SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos();
    let dir = std::env::temp_dir().join(format!("rlcut-launch-{}-{unique}", std::process::id()));
    fs::DirBuilder::new().mode(0o700).create(&dir)?;
    let scratch = Temporary(dir);
    let app = scratch.0.join("rlcut.AppImage");
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o700)
        .open(&app)?;
    file.write_all(APPIMAGE)?;
    drop(file);
    let status = Command::new(&app)
        .arg("--appimage-extract-and-run")
        .args(std::env::args_os().skip(1))
        .status()?;
    Ok(status.code().unwrap_or(1))
}
fn main() -> ExitCode {
    match launch() {
        Ok(code) => ExitCode::from(code.clamp(0, 255) as u8),
        Err(error) => {
            eprintln!("Unable to open rlcut: {error}");
            ExitCode::FAILURE
        }
    }
}
