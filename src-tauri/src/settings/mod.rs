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
    // Read and discard API keys from older settings files. New saves omit it.
    #[serde(default, skip_serializing)]
    pub youtube_api_key: String,
    #[serde(default)]
    pub favorite_songs: Vec<LibrarySong>,
    #[serde(default)]
    pub installed_songs: Vec<LibrarySong>,
    #[serde(default)]
    pub music_library_folder: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LibrarySong {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub thumbnail: String,
    pub views: u64,
    pub duration: f64,
    #[serde(default)]
    pub is_short: bool,
    #[serde(default)]
    pub local_path: Option<String>,
    #[serde(default)]
    pub local_name: Option<String>,
}
fn default_wait_for_preview() -> bool {
    true
}
fn default_music_fade_duration() -> f64 {
    0.5
}
/// Upgrade pre-camelCase saves before they reach typed models or the webview.
/// Projects are intentionally stored as JSON values, so doing this at the
/// storage boundary also prevents old nested project presets from carrying a
/// second spelling back into Tauri commands.
pub fn migrate_legacy_names(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Array(items) => {
            for item in items {
                migrate_legacy_names(item);
            }
        }
        serde_json::Value::Object(object) => {
            let keys = object.keys().cloned().collect::<Vec<_>>();
            for key in &keys {
                if let Some(child) = object.get_mut(key) {
                    migrate_legacy_names(child);
                }
            }
            for key in keys {
                if !key.contains('_') {
                    continue;
                }
                let mut upper = false;
                let canonical = key
                    .chars()
                    .filter_map(|character| {
                        if character == '_' {
                            upper = true;
                            None
                        } else if upper {
                            upper = false;
                            Some(character.to_ascii_uppercase())
                        } else {
                            Some(character)
                        }
                    })
                    .collect::<String>();
                if canonical != key {
                    let legacy = object.remove(&key).expect("key collected from object");
                    // A newer value is always authoritative when both spellings
                    // exist, eliminating duplicate fields in later commands.
                    object.entry(canonical).or_insert(legacy);
                }
            }
        }
        _ => {}
    }
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
            youtube_api_key: String::new(),
            favorite_songs: Vec::new(),
            installed_songs: Vec::new(),
            music_library_folder: String::new(),
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
        let songs_valid = |songs: &[LibrarySong], installed: bool| {
            songs.len() <= 500
                && songs.iter().all(|song| {
                    !song.id.is_empty()
                        && song.id.len() <= 32
                        && song.title.len() <= 500
                        && song.channel.len() <= 300
                        && song.thumbnail.len() <= 2_000
                        && song.duration.is_finite()
                        && song.duration >= 0.
                        && song
                            .local_path
                            .as_ref()
                            .map_or(!installed, |path| path.len() <= 4_096)
                        && song
                            .local_name
                            .as_ref()
                            .is_none_or(|name| name.len() <= 500)
                })
        };
        if !songs_valid(&self.settings.favorite_songs, false)
            || !songs_valid(&self.settings.installed_songs, true)
            || self.settings.music_library_folder.len() > 4_096
        {
            return Err("Music library settings are invalid".into());
        }
        Ok(())
    }
}
pub fn load(path: &Path) -> Result<Store, String> {
    if !path.exists() {
        return Ok(Store::default());
    }
    let bytes = fs::read(path).map_err(|e| format!("Cannot read settings: {e}"))?;
    let mut value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Cannot read settings JSON (original file retained): {e}"))?;
    let original = value.clone();
    migrate_legacy_names(&mut value);
    let store: Store = serde_json::from_value(value)
        .map_err(|e| format!("Cannot read settings JSON (original file retained): {e}"))?;
    store.validate()?;
    // Persist the one-way upgrade immediately so future app versions and
    // project exports only ever see the canonical camelCase spelling.
    if original != serde_json::to_value(&store).unwrap_or_default() {
        let _ = save(path, &store);
    }
    Ok(store)
}
pub fn save(path: &Path, store: &Store) -> Result<(), String> {
    store.validate()?;
    let parent = path.parent().ok_or("Invalid settings path")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    let backup = path.with_extension("json.bak");
    let mut value = serde_json::to_value(store).map_err(|e| e.to_string())?;
    migrate_legacy_names(&mut value);
    let data = serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?;
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
    fn legacy_snake_case_keys_upgrade_without_duplicates() {
        let mut value = serde_json::json!({
            "gameplay": {
                "shadow_height": 0.08,
                "shadowHeight": 0.05,
                "fade_duration": 1.0
            }
        });
        migrate_legacy_names(&mut value);
        let gameplay = &value["gameplay"];
        assert_eq!(gameplay["shadowHeight"], 0.05);
        assert_eq!(gameplay["fadeDuration"], 1.0);
        assert!(gameplay.get("shadow_height").is_none());
        assert!(gameplay.get("fade_duration").is_none());
    }
    #[test]
    fn loading_legacy_store_rewrites_canonical_names() {
        let dir =
            std::env::temp_dir().join(format!("rlcut-settings-migration-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = data_file(dir.clone());
        let mut store = Store::default();
        let preset = Preset {
            id: "custom".into(),
            ..Preset::default()
        };
        store.active_preset = preset.id.clone();
        store.settings.default_preset = preset.id.clone();
        store.presets.push(preset);
        let mut value = serde_json::to_value(store).unwrap();
        let gameplay = value["presets"][0]["gameplay"].as_object_mut().unwrap();
        let height = gameplay.remove("shadowHeight").unwrap();
        gameplay.insert("shadow_height".into(), height);
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.presets[0].gameplay.shadow_height, 0.035);
        let rewritten: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(rewritten["presets"][0]["gameplay"]
            .get("shadowHeight")
            .is_some());
        assert!(rewritten["presets"][0]["gameplay"]
            .get("shadow_height")
            .is_none());
        fs::remove_dir_all(dir).unwrap();
    }
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
