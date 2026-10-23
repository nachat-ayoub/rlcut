use crate::model::{ExportOptions, Preset};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub quality: u32,
    pub fps: u32,
    pub output_folder: String,
    pub default_preset: String,
    #[serde(default = "default_wait_for_preview")]
    pub wait_for_preview: bool,
    #[serde(default, skip_serializing)]
    pub boost_intro: bool,
    #[serde(default)]
    pub music_fade_out: bool,
    #[serde(default = "default_music_fade_duration")]
    pub music_fade_duration: f64,
    #[serde(default)]
    pub favorite_fonts: Vec<String>,
}
fn default_wait_for_preview() -> bool {
    true
}
fn default_music_fade_duration() -> f64 {
    0.5
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            quality: 1080,
            fps: 60,
            output_folder: String::new(),
            default_preset: "classic".into(),
            wait_for_preview: true,
            boost_intro: false,
            music_fade_out: false,
            music_fade_duration: default_music_fade_duration(),
            favorite_fonts: Vec::new(),
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Store {
    pub version: u32,
    pub setup_complete: bool,
    pub active_preset: String,
    pub presets: Vec<Preset>,
    pub settings: Settings,
    pub recent_files: Vec<String>,
    #[serde(default)]
    pub projects: Vec<serde_json::Value>,
}
impl Default for Store {
    fn default() -> Self {
        Self {
            version: 1,
            setup_complete: false,
            active_preset: "classic".into(),
            presets: Vec::new(),
            settings: Settings::default(),
            recent_files: Vec::new(),
            projects: Vec::new(),
        }
    }
}
impl Store {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("Unsupported settings version".into());
        }
        if self.presets.len() > 200 || self.recent_files.len() > 12 || self.projects.len() > 100 {
            return Err("Too many presets or recent files".into());
        }
        if self
            .projects
            .iter()
            .any(|project| serde_json::to_vec(project).map_or(true, |data| data.len() > 2_000_000))
        {
            return Err("A saved project is too large".into());
        }
        let mut ids = std::collections::HashSet::new();
        ids.insert("classic".to_string());
        for p in &self.presets {
            p.validate()?;
            if !ids.insert(p.id.clone()) {
                return Err("Preset IDs must be unique; built-in preset cannot be replaced".into());
            }
        }
        if !ids.contains(&self.active_preset) || !ids.contains(&self.settings.default_preset) {
            return Err("Selected preset does not exist".into());
        }
        ExportOptions {
            ai_enhance: false,
            ai_upscale: false,
            ai_upscale_lite: false,
            ai_keep_resolution: false,
            effects: Vec::new(),
            quality: self.settings.quality,
            fps: self.settings.fps,
            folder: String::new(),
            filename: String::new(),
        }
        .resolution()?;
        if !self.settings.music_fade_duration.is_finite()
            || !(0.1..=10.).contains(&self.settings.music_fade_duration)
        {
            return Err("Music fade duration must be between 0.1 and 10 seconds".into());
        }
        if self.settings.favorite_fonts.len() > 500
            || self
                .settings
                .favorite_fonts
                .iter()
                .any(|font| font.len() > 200)
        {
            return Err("Too many favorite fonts".into());
        }
        Ok(())
    }
}
pub fn load(path: &Path) -> Result<Store, String> {
    if !path.exists() {
        return Ok(Store::default());
    }
    let bytes = fs::read(path).map_err(|e| format!("Cannot read settings: {e}"))?;
    let store: Store = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Cannot read settings JSON (original file retained): {e}"))?;
    store.validate()?;
    Ok(store)
}
pub fn save(path: &Path, store: &Store) -> Result<(), String> {
    store.validate()?;
    let parent = path.parent().ok_or("Invalid settings path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    let data = serde_json::to_vec_pretty(store).map_err(|e| e.to_string())?;
    let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    f.write_all(&data)
        .and_then(|_| f.sync_all())
        .map_err(|e| e.to_string())?;
    drop(f);
    // Preserve last known good settings on Windows, where rename cannot replace a file.
    if path.exists() {
        fs::copy(path, &backup).map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    if let Err(e) = fs::rename(&tmp, path) {
        if !path.exists() && backup.exists() {
            let _ = fs::copy(&backup, path);
        }
        return Err(format!("Could not save settings: {e}"));
    }
    Ok(())
}
pub fn data_file(dir: PathBuf) -> PathBuf {
    dir.join("settings-v1.json")
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cannot_mutate_builtin() {
        let mut s = Store::default();
        s.presets.push(Preset::default());
        assert!(s.validate().is_err());
    }
    #[test]
    fn roundtrip() {
        let s = Store::default();
        let encoded = serde_json::to_string(&s).unwrap();
        serde_json::from_str::<Store>(&encoded)
            .unwrap()
            .validate()
            .unwrap();
    }
}
