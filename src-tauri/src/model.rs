#[cfg(feature = "serialization")]
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serialization", derive(Serialize, Deserialize))]
#[cfg_attr(
    feature = "serialization",
    serde(rename_all = "camelCase", deny_unknown_fields)
)]
pub struct Background {
    pub blur: f64,
    pub scale: f64,
    pub x: f64,
    pub y: f64,
    pub brightness: f64,
}
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serialization", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serialization", serde(deny_unknown_fields))]
pub struct Gameplay {
    pub scale: f64,
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serialization", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serialization", serde(deny_unknown_fields))]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serialization", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serialization", serde(rename_all = "lowercase"))]
pub enum Shape {
    Circle,
    Ellipse,
}
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serialization", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serialization", serde(deny_unknown_fields))]
pub struct Boost {
    pub enabled: bool,
    pub crop: Rect,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    pub shape: Shape,
    pub feather: f64,
}
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serialization", derive(Serialize, Deserialize))]
#[cfg_attr(
    feature = "serialization",
    serde(rename_all = "camelCase", deny_unknown_fields)
)]
pub struct Preset {
    pub version: u32,
    pub id: String,
    pub name: String,
    pub background: Background,
    pub gameplay: Gameplay,
    pub boost: Boost,
}
impl Default for Preset {
    fn default() -> Self {
        Self {
            version: 1,
            id: "classic".into(),
            name: "Classic RL Short".into(),
            background: Background {
                blur: 30.,
                scale: 1.,
                x: 0.5,
                y: 0.5,
                brightness: 0.,
            },
            gameplay: Gameplay {
                scale: 1.,
                x: 0.5,
                y: 0.5,
            },
            boost: Boost {
                enabled: true,
                crop: Rect {
                    x: 0.88,
                    y: 0.77,
                    width: 0.115,
                    height: 0.205,
                },
                x: 0.19,
                y: 0.80,
                width: 0.12,
                height: 0.0675,
                scale: 1.,
                shape: Shape::Circle,
                feather: 0.,
            },
        }
    }
}
fn range(v: f64, min: f64, max: f64, field: &str) -> Result<(), String> {
    if !v.is_finite() || v < min || v > max {
        Err(format!("{field} must be between {min} and {max}"))
    } else {
        Ok(())
    }
}
impl Preset {
    pub fn validate(&self) -> Result<(), String> {
        if self.version != 1 {
            return Err("Unsupported preset version; supported version is 1".into());
        }
        if self.id.is_empty()
            || self.id.len() > 128
            || self.name.trim().is_empty()
            || self.name.chars().count() > 100
        {
            return Err("Preset needs a valid ID and a name of 1–100 characters".into());
        }
        let b = &self.background;
        range(b.blur, 0., 100., "Blur")?;
        range(b.scale, 1., 2., "Background scale")?;
        range(b.x, 0., 1., "Background X")?;
        range(b.y, 0., 1., "Background Y")?;
        range(b.brightness, -0.5, 0.5, "Brightness")?;
        range(self.gameplay.scale, 0.2, 4., "Gameplay scale")?;
        range(self.gameplay.x, 0., 1., "Gameplay X")?;
        range(self.gameplay.y, 0., 1., "Gameplay Y")?;
        let h = &self.boost;
        range(h.scale, 0.25, 4., "Boost scale")?;
        range(h.width, 0.01, 1., "Boost width")?;
        range(h.height, 0.005, 1., "Boost height")?;
        range(h.x, 0., 1., "Boost X")?;
        range(h.y, 0., 1., "Boost Y")?;
        range(h.feather, 0., 0.25, "Feather")?;
        range(h.crop.x, 0., 1., "Crop X")?;
        range(h.crop.y, 0., 1., "Crop Y")?;
        range(h.crop.width, 0.001, 1., "Crop width")?;
        range(h.crop.height, 0.001, 1., "Crop height")?;
        if h.crop.x + h.crop.width > 1.000001 || h.crop.y + h.crop.height > 1.000001 {
            return Err("Boost crop must fit inside the source frame".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serialization", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serialization", serde(rename_all = "camelCase"))]
pub struct Video {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub duration: f64,
    pub fps: f64,
    pub has_audio: bool,
}
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serialization", derive(Serialize, Deserialize))]
#[cfg_attr(
    feature = "serialization",
    serde(rename_all = "camelCase", deny_unknown_fields)
)]
pub struct ExportOptions {
    pub quality: u32,
    pub fps: u32,
    pub folder: String,
    pub filename: String,
}
impl ExportOptions {
    pub fn resolution(&self) -> Result<(u32, u32), String> {
        if self.fps != 30 && self.fps != 60 {
            return Err("Export FPS must be 30 or 60".into());
        }
        match self.quality {
            480 => Ok((480, 854)),
            720 => Ok((720, 1280)),
            1080 => Ok((1080, 1920)),
            _ => Err("Invalid export resolution".into()),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_valid() {
        Preset::default().validate().unwrap();
    }
    #[test]
    fn rejects_bad_crop_and_nonfinite() {
        let mut p = Preset::default();
        p.boost.crop.width = 0.5;
        assert!(p.validate().is_err());
        p = Preset::default();
        p.background.blur = f64::NAN;
        assert!(p.validate().is_err());
    }
    #[test]
    fn rejects_version() {
        let p = Preset {
            version: 2,
            ..Preset::default()
        };
        assert!(p.validate().is_err());
    }
    #[cfg(feature = "serialization")]
    #[test]
    fn serialization_roundtrip() {
        let p = Preset::default();
        let s = serde_json::to_string(&p).unwrap();
        assert_eq!(p, serde_json::from_str::<Preset>(&s).unwrap());
        assert!(serde_json::from_str::<Preset>("{}").is_err());
    }
}
