#[cfg(feature = "serialization")]
use serde::Serialize;
use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serialization", derive(Serialize))]
#[cfg_attr(feature = "serialization", serde(rename_all = "camelCase"))]
pub struct Binaries {
    pub ffmpeg: Option<PathBuf>,
    pub ffprobe: Option<PathBuf>,
    pub ffplay: Option<PathBuf>,
}
pub fn command(path: &Path) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(path);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x08000000);
    }
    c
}
fn find(name: &str, resource: &Path) -> Option<PathBuf> {
    let env_name = format!("RLCUT_{}", name.to_uppercase());
    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let mut candidates = Vec::new();
    if let Some(p) = std::env::var_os(env_name) {
        candidates.push(PathBuf::from(p));
    }
    // AppImage packages deploy the tools alongside the application executable,
    // letting linuxdeploy bundle and patch their shared-library dependencies.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(folder) = exe.parent() {
            candidates.push(folder.join(format!("{name}{suffix}")));
        }
    }
    candidates.push(
        resource
            .join("resources")
            .join("ffmpeg")
            .join(format!("{name}{suffix}")),
    );
    candidates.push(resource.join("ffmpeg").join(format!("{name}{suffix}")));
    candidates.push(
        PathBuf::from(option_env!("CARGO_MANIFEST_DIR").unwrap_or("src-tauri"))
            .join("resources/ffmpeg")
            .join(format!("{name}{suffix}")),
    );
    if let Some(paths) = std::env::var_os("PATH") {
        for p in std::env::split_paths(&paths) {
            candidates.push(p.join(format!("{name}{suffix}")));
        }
    }
    candidates.into_iter().find(|p| {
        p.is_file()
            && command(p)
                .args(["-version"])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status()
                .is_ok_and(|s| s.success())
    })
}
impl Binaries {
    pub fn detect(resource: &Path) -> Self {
        Self {
            ffmpeg: find("ffmpeg", resource),
            ffprobe: find("ffprobe", resource),
            ffplay: find("ffplay", resource),
        }
    }
    pub fn ffmpeg(&self) -> Result<&Path, String> {
        self.ffmpeg.as_deref().ok_or_else(|| {
            "Video processing is unavailable. Reinstall the complete rlcut app package.".into()
        })
    }
    pub fn ffprobe(&self) -> Result<&Path, String> {
        self.ffprobe.as_deref().ok_or_else(|| {
            "Video information could not be read. Reinstall the complete rlcut app package.".into()
        })
    }
    pub fn ffplay(&self) -> Option<&Path> {
        self.ffplay.as_deref()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_ffmpeg_is_actionable() {
        let b = Binaries {
            ffmpeg: None,
            ffprobe: None,
            ffplay: None,
        };
        assert!(b.ffmpeg().unwrap_err().contains("Reinstall the complete"));
        assert!(b.ffprobe().is_err());
    }
}
