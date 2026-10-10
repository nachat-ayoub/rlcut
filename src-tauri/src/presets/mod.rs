use crate::model::Preset;
use std::{
    fs,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
pub fn id() -> String {
    format!(
        "custom-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    )
}
pub fn import(path: &Path) -> Result<Preset, String> {
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    if metadata.len() > 1_048_576 {
        return Err("Preset JSON is too large (maximum 1 MB)".into());
    }
    let mut p: Preset = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Invalid preset JSON: {e}"))?;
    p.validate()?;
    p.id = id();
    Ok(p)
}
pub fn export(path: &Path, p: &Preset) -> Result<(), String> {
    p.validate()?;
    if !path
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("json"))
    {
        return Err("Preset files must use the .json extension".into());
    }
    let bytes = serde_json::to_vec_pretty(p).map_err(|e| e.to_string())?;
    fs::write(path, bytes).map_err(|e| e.to_string())
}
