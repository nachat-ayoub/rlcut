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
#[cfg_attr(feature = "serialization", serde(rename_all = "camelCase"))]
pub enum BoostEasing {
    Linear,
    Ease,
    EaseIn,
    EaseOut,
    EaseInOut,
}
#[derive(Clone, Debug, PartialEq)]
#[cfg_attr(feature = "serialization", derive(Serialize, Deserialize))]
#[cfg_attr(
    feature = "serialization",
    serde(rename_all = "camelCase", deny_unknown_fields)
)]
pub struct BoostIntro {
    pub enabled: bool,
    pub duration: f64,
    pub easing: BoostEasing,
}
impl Default for BoostIntro {
    fn default() -> Self {
        Self {
            enabled: false,
            duration: 0.8,
            easing: BoostEasing::Ease,
        }
    }
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
    #[cfg_attr(feature = "serialization", serde(default))]
    pub intro: BoostIntro,
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
            name: "Default Preset".into(),
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
                intro: BoostIntro::default(),
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
        range(h.intro.duration, 0.1, 5., "Boost entrance duration")?;
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
    #[cfg_attr(feature = "serialization", serde(default))]
    pub color_transfer: String,
}
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serialization", derive(Serialize, Deserialize))]
#[cfg_attr(
    feature = "serialization",
    serde(rename_all = "camelCase", deny_unknown_fields)
)]
pub struct MusicFile {
    pub path: String,
    pub name: String,
    pub duration: f64,
}
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serialization", derive(Serialize, Deserialize))]
#[cfg_attr(
    feature = "serialization",
    serde(rename_all = "camelCase", deny_unknown_fields)
)]
pub struct MusicTrack {
    pub path: String,
    pub duration: f64,
    pub segments: Vec<Segment>,
    #[cfg_attr(feature = "serialization", serde(default))]
    pub fade_out: Option<f64>,
}
impl MusicTrack {
    pub fn validate(&self) -> Result<(), String> {
        if !self.duration.is_finite()
            || self.duration <= 0.
            || !std::path::Path::new(&self.path).is_file()
        {
            return Err("Music file is missing or invalid".into());
        }
        if !self.segments.is_empty() {
            Segment::validate_all(&self.segments, self.duration)?;
        }
        if self
            .fade_out
            .is_some_and(|duration| !duration.is_finite() || !(0.1..=10.).contains(&duration))
        {
            return Err("Invalid music fade duration".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serialization", derive(Serialize, Deserialize))]
#[cfg_attr(
    feature = "serialization",
    serde(rename_all = "camelCase", deny_unknown_fields)
)]
pub struct ExportOptions {
    #[cfg_attr(feature = "serialization", serde(default))]
    pub ai_enhance: bool,
    #[cfg_attr(feature = "serialization", serde(default))]
    pub ai_upscale: bool,
    #[cfg_attr(feature = "serialization", serde(default))]
    pub ai_upscale_lite: bool,
    #[cfg_attr(feature = "serialization", serde(default))]
    pub ai_keep_resolution: bool,
    pub quality: u32,
    pub fps: u32,
    pub folder: String,
    pub filename: String,
}
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serialization", derive(Serialize, Deserialize))]
#[cfg_attr(feature = "serialization", serde(deny_unknown_fields))]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    #[cfg_attr(feature = "serialization", serde(default = "default_volume"))]
    pub volume: f64,
    #[cfg_attr(feature = "serialization", serde(default))]
    pub color_fix: f64,
}
#[derive(Clone, Debug)]
#[cfg_attr(feature = "serialization", derive(Serialize, Deserialize))]
#[cfg_attr(
    feature = "serialization",
    serde(rename_all = "camelCase", deny_unknown_fields)
)]
pub struct TextOverlay {
    pub id: String,
    #[cfg_attr(feature = "serialization", serde(default))]
    pub track_id: String,
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub box_width: f64,
    pub rotation: f64,
    pub font_family: String,
    pub font_path: String,
    pub font_bold_path: String,
    pub font_black_path: String,
    pub font_italic_path: String,
    pub font_bold_italic_path: String,
    pub font_black_italic_path: String,
    pub font_weight: u16,
    pub font_size: f64,
    pub color: String,
    pub opacity: f64,
    pub align: String,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub letter_spacing: f64,
    pub line_height: f64,
    pub stroke_color: String,
    pub stroke_width: f64,
    pub stroke_position: String,
    pub background_color: String,
    pub background_opacity: f64,
    #[cfg_attr(feature = "serialization", serde(default))]
    pub shadow_enabled: bool,
    pub shadow_color: String,
    pub shadow_blur: f64,
    pub shadow_x: f64,
    pub shadow_y: f64,
    pub fade_in: Option<f64>,
    pub fade_out: Option<f64>,
}
impl TextOverlay {
    pub fn validate_all(texts: &[Self], duration: f64) -> Result<(), String> {
        if texts.len() > 100 {
            return Err("A project can contain at most 100 text clips".into());
        }
        for text in texts {
            if text.id.is_empty()
                || text.text.len() > 4000
                || !text.start.is_finite()
                || !text.end.is_finite()
                || text.start < 0.
                || text.end <= text.start
                || text.end > duration + 0.001
                || !text.x.is_finite()
                || !(0. ..=1.).contains(&text.x)
                || !text.y.is_finite()
                || !(0. ..=1.).contains(&text.y)
                || !text.scale.is_finite()
                || !(0.1..=10.).contains(&text.scale)
                || !text.box_width.is_finite()
                || !(0.1..=1.).contains(&text.box_width)
                || !text.rotation.is_finite()
                || !(-360. ..=360.).contains(&text.rotation)
                || !text.font_size.is_finite()
                || !(6. ..=500.).contains(&text.font_size)
                || !matches!(text.font_weight, 400 | 700 | 900)
                || !text.opacity.is_finite()
                || !(0. ..=1.).contains(&text.opacity)
                || !matches!(text.align.as_str(), "left" | "center" | "right")
                || !text.letter_spacing.is_finite()
                || !(-20. ..=100.).contains(&text.letter_spacing)
                || !text.line_height.is_finite()
                || !(0.5..=4.).contains(&text.line_height)
                || !text.stroke_width.is_finite()
                || !(0. ..=30.).contains(&text.stroke_width)
                || !matches!(
                    text.stroke_position.as_str(),
                    "inside" | "center" | "outside"
                )
                || !text.background_opacity.is_finite()
                || !(0. ..=1.).contains(&text.background_opacity)
                || !text.shadow_blur.is_finite()
                || !(0. ..=100.).contains(&text.shadow_blur)
                || !text.shadow_x.is_finite()
                || !text.shadow_y.is_finite()
                || text
                    .fade_in
                    .is_some_and(|v| !v.is_finite() || !(0.05..=10.).contains(&v))
                || text
                    .fade_out
                    .is_some_and(|v| !v.is_finite() || !(0.05..=10.).contains(&v))
            {
                return Err("Text clips contain invalid timing or style values".into());
            }
        }
        Ok(())
    }
}
fn default_volume() -> f64 {
    1.
}
impl Segment {
    pub fn validate_all(segments: &[Self], duration: f64) -> Result<(), String> {
        if segments.is_empty() {
            return Err("Keep at least one timeline segment".into());
        }
        for segment in segments {
            if !segment.start.is_finite()
                || !segment.end.is_finite()
                || segment.start < 0.
                || segment.end <= segment.start
                || segment.end > duration + 0.001
                || !segment.volume.is_finite()
                || !(0. ..=2.).contains(&segment.volume)
                || !segment.color_fix.is_finite()
                || !(0. ..=1.).contains(&segment.color_fix)
            {
                return Err(
                    "Timeline clips must have valid source ranges, volume, and color settings"
                        .into(),
                );
            }
        }
        Ok(())
    }
}
impl ExportOptions {
    pub fn output_resolution(&self) -> Result<(u32, u32), String> {
        let (w, h) = self.resolution()?;
        let scale = if self.ai_upscale && !self.ai_keep_resolution {
            2
        } else {
            1
        };
        Ok((w * scale, h * scale))
    }
    pub fn ai_input_resolution(&self) -> Result<(u32, u32), String> {
        let (w, h) = self.resolution()?;
        if self.ai_upscale && self.ai_keep_resolution {
            Ok((w / 2, h / 2))
        } else {
            Ok((w, h))
        }
    }

    pub fn resolution(&self) -> Result<(u32, u32), String> {
        if self.ai_enhance && (!matches!(self.fps, 60 | 120) || self.quality > 1080) {
            return Err("AI smoothing requires 480p, 720p or 1080p and 60 or 120 FPS".into());
        }
        if self.fps != 30 && self.fps != 60 && !(self.ai_enhance && self.fps == 120) {
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
    #[test]
    fn segment_volume_is_bounded() {
        let mut segments = vec![Segment {
            start: 0.,
            end: 1.,
            volume: 1.,
            color_fix: 0.,
        }];
        Segment::validate_all(&segments, 1.).unwrap();
        segments[0].volume = f64::NAN;
        assert!(Segment::validate_all(&segments, 1.).is_err());
        segments[0].volume = 2.01;
        assert!(Segment::validate_all(&segments, 1.).is_err());
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
