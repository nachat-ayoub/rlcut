use crate::model::{Preset, Shape, Video};
#[derive(Debug, Clone, Copy)]
pub struct Layer {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
}
#[derive(Debug)]
pub struct Geometry {
    pub background: Layer,
    pub gameplay: Layer,
    pub boost: Layer,
    pub crop: Layer,
}
fn even(v: f64) -> u32 {
    ((v / 2.).round().max(1.) * 2.) as u32
}
fn even_coordinate(v: f64) -> u32 {
    ((v / 2.).round().max(0.) * 2.) as u32
}
pub fn geometry(video: &Video, preset: &Preset, w: u32, h: u32) -> Result<Geometry, String> {
    preset.validate()?;
    if video.width < 2 || video.height < 2 || w < 2 || h < 2 || w & 1 != 0 || h & 1 != 0 {
        return Err(
            "Video and canvas dimensions must be valid; canvas dimensions must be even".into(),
        );
    }
    let sw = video.width as f64;
    let sh = video.height as f64;
    let wf = w as f64;
    let hf = h as f64;
    let cover = (wf / sw).max(hf / sh) * preset.background.scale;
    // Ceil avoids a cover dimension rounding below the canvas.
    let bw = ((sw * cover / 2.).ceil() * 2.) as u32;
    let bh = ((sh * cover / 2.).ceil() * 2.) as u32;
    let background = Layer {
        width: bw,
        height: bh,
        x: ((bw - w) as f64 * preset.background.x).round() as i32,
        y: ((bh - h) as f64 * preset.background.y).round() as i32,
    };
    let gw = even(wf * preset.gameplay.scale);
    let gh = even(gw as f64 * sh / sw);
    // X/Y are centers in canvas coordinates, allowing layers larger than the canvas.
    let gameplay = Layer {
        width: gw,
        height: gh,
        x: (wf * preset.gameplay.x - gw as f64 / 2.).round() as i32,
        y: (hf * preset.gameplay.y - gh as f64 / 2.).round() as i32,
    };
    let b = &preset.boost;
    let ow = even(wf * b.width * b.scale);
    let oh = even(hf * b.height * b.scale);
    let boost = Layer {
        width: ow,
        height: oh,
        x: (wf * b.x - ow as f64 / 2.).round() as i32,
        y: (hf * b.y - oh as f64 / 2.).round() as i32,
    };
    let cx = ((sw * b.crop.x / 2.).floor() * 2.) as u32;
    let cy = ((sh * b.crop.y / 2.).floor() * 2.) as u32;
    let cw = even(sw * b.crop.width).min((video.width - cx) / 2 * 2);
    let ch = even(sh * b.crop.height).min((video.height - cy) / 2 * 2);
    if cw < 2 || ch < 2 {
        return Err("Boost source crop is too small for this video".into());
    }
    Ok(Geometry {
        background,
        gameplay,
        boost,
        crop: Layer {
            width: cw,
            height: ch,
            x: cx as i32,
            y: cy as i32,
        },
    })
}
/// Normalize HDR recordings to the SDR BT.709 canvas before compositing.
/// Source-frame previews use this same transform, so cropping stays consistent.
pub fn color_filter(video: &Video) -> &'static str {
    if matches!(video.color_transfer.as_str(), "smpte2084" | "arib-std-b67") {
        "zscale=transfer=linear:npl=100,format=gbrpf32le,zscale=primaries=bt709,tonemap=tonemap=hable:desat=0,zscale=transfer=bt709:matrix=bt709:range=limited,format=yuv420p,setparams=range=limited:colorspace=bt709:color_primaries=bt709:color_trc=bt709"
    } else {
        "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=range=limited:colorspace=bt709:color_primaries=bt709:color_trc=bt709"
    }
}
/// The single composition implementation used for previews AND full video exports.
pub fn filter_graph(video: &Video, p: &Preset, w: u32, h: u32) -> Result<String, String> {
    filter_graph_with_input(video, p, w, h, color_filter(video))
}
/// Compose frames that have already been normalized to limited-range BT.709.
/// Timeline export uses this after converting each source independently, which
/// is required when SDR and HDR recordings share one project.
pub fn filter_graph_normalized(
    video: &Video,
    p: &Preset,
    w: u32,
    h: u32,
) -> Result<String, String> {
    filter_graph_with_input(video, p, w, h, "null")
}
fn filter_graph_with_input(
    video: &Video,
    p: &Preset,
    w: u32,
    h: u32,
    input: &str,
) -> Result<String, String> {
    let g = geometry(video, p, w, h)?;
    let bg = g.background;
    let gp = g.gameplay;
    let b = g.boost;
    let c = g.crop;
    let saturation = p.gameplay.saturation;
    let hue = p.gameplay.hue;
    let base_output = if p.gameplay.shadow {
        "base_unshadowed"
    } else {
        "base"
    };
    // Crop the source before scaling instead of scaling the entire landscape
    // frame and discarding most of it for a portrait canvas. A blurred layer
    // also carries no useful full-resolution detail, so blur it on an adaptive
    // smaller buffer and upscale once. Gameplay, HUD, text and encoding stay native.
    let source_crop_width =
        even(video.width as f64 * w as f64 / bg.width as f64).min(video.width / 2 * 2);
    let source_crop_height =
        even(video.height as f64 * h as f64 / bg.height as f64).min(video.height / 2 * 2);
    let source_crop_x = even_coordinate((video.width - source_crop_width) as f64 * p.background.x)
        .min(video.width - source_crop_width);
    let source_crop_y =
        even_coordinate((video.height - source_crop_height) as f64 * p.background.y)
            .min(video.height - source_crop_height);
    let background = if p.background.blur > 0.001 {
        let divisor = if p.background.blur >= 20. {
            4
        } else if p.background.blur >= 8. {
            2
        } else {
            1
        };
        let blur_width = (w / divisor).max(2) / 2 * 2;
        let blur_height = (h / divisor).max(2) / 2 * 2;
        let sigma = p.background.blur * blur_width as f64 / 1080.;
        format!(
            "crop={source_crop_width}:{source_crop_height}:{source_crop_x}:{source_crop_y},scale={blur_width}:{blur_height}:flags=bilinear,gblur=sigma={sigma:.6}:steps=2,scale={w}:{h}:flags=lanczos,eq=brightness={:.6}",
            p.background.brightness
        )
    } else {
        format!(
            "crop={source_crop_width}:{source_crop_height}:{source_crop_x}:{source_crop_y},scale={w}:{h}:flags=lanczos,eq=brightness={:.6}",
            p.background.brightness
        )
    };
    // When gameplay is zoomed beyond the portrait frame, crop the invisible
    // source region first. The previous graph scaled a 4K frame to e.g.
    // 2548px wide even though only 1080px could reach the final canvas.
    let game_left = gp.x.max(0);
    let game_top = gp.y.max(0);
    let game_right = (gp.x + gp.width as i32).min(w as i32);
    let game_bottom = (gp.y + gp.height as i32).min(h as i32);
    let game_width = even((game_right - game_left).max(2) as f64);
    let game_height = even((game_bottom - game_top).max(2) as f64);
    let game_source_x =
        even_coordinate((game_left - gp.x) as f64 * video.width as f64 / gp.width as f64)
            .min(video.width.saturating_sub(2));
    let game_source_y =
        even_coordinate((game_top - gp.y) as f64 * video.height as f64 / gp.height as f64)
            .min(video.height.saturating_sub(2));
    let game_source_width = even(game_width as f64 * video.width as f64 / gp.width as f64)
        .min(video.width - game_source_x);
    let game_source_height = even(game_height as f64 * video.height as f64 / gp.height as f64)
        .min(video.height - game_source_y);
    let gameplay = format!(
        "crop={game_source_width}:{game_source_height}:{game_source_x}:{game_source_y},scale={game_width}:{game_height}:flags=lanczos"
    );
    let mut graph=format!("[0:v:0]{input},eq=saturation={saturation:.6},hue=h={hue:.6},setsar=1,split={}[bgsrc][gamesrc]{};[bgsrc]{background}[bg];[gamesrc]{gameplay}[game];[bg][game]overlay=x={game_left}:y={game_top}:eval=init:shortest=1[{base_output}]",if p.boost.enabled{
        3
    }
    else{
        2
    },if p.boost.enabled{
        "[hudsrc]"
    }
    else{
        ""
    });
    if p.gameplay.shadow {
        // Match the preview's soft drop shadow. Keep the feather outside the
        // gameplay image so it separates the sharp frame from the blurred
        // backdrop without darkening gameplay or creating a solid black bar.
        let extent = (h as f64 * p.gameplay.shadow_height).round().max(2.) as i32;
        let top_space = game_top.min(extent);
        let bottom_space = (h as i32 - game_bottom).max(0).min(extent);
        let mut shadow = Vec::new();
        for (boundary, space, direction) in [
            (game_top, top_space, -1_i32),
            (game_bottom, bottom_space, 1_i32),
        ] {
            if space == 0 {
                continue;
            }
            let steps = space.min(16);
            for step in 0..steps {
                let near = space * step / steps;
                let far = space * (step + 1) / steps;
                let band = (far - near).max(1);
                let distance = step as f64 / steps.max(1) as f64;
                let alpha = 0.62 * (1. - distance).powf(1.35);
                let y = if direction < 0 {
                    boundary - far
                } else {
                    boundary + near
                };
                shadow.push(format!(
                    "drawbox=x={game_left}:y={y}:w={game_width}:h={band}:color=black@{alpha:.3}:t=fill"
                ));
            }
        }
        if shadow.is_empty() {
            graph.push_str(";[base_unshadowed]null[base]");
        } else {
            graph.push_str(&format!(";[base_unshadowed]{}[base]", shadow.join(",")));
        }
    }
    if p.boost.enabled {
        let radius = b.width.min(b.height) as f64 / 2.;
        let distance = match p.boost.shape {
            Shape::Circle => {
                format!("sqrt(pow((X-(W-1)/2)/{radius:.6},2)+pow((Y-(H-1)/2)/{radius:.6},2))")
            }
            Shape::Ellipse => "sqrt(pow((X-(W-1)/2)/(W/2),2)+pow((Y-(H-1)/2)/(H/2),2))".into(),
        };
        let alpha = if p.boost.feather == 0. {
            format!("if(lte({distance},1),255,0)")
        } else {
            format!("255*clip((1-({distance}))/{:.6},0,1)", p.boost.feather)
        };
        graph.push_str(&format!(";[hudsrc]crop={}:{}:{}:{},scale={}:{}:flags=lanczos,format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='{alpha}'[hud];[base][hud]overlay=x={}:y={}:eval=init:shortest=1:format=yuv420,format=yuv420p,setsar=1[out]",c.width,c.height,c.x,c.y,b.width,b.height,b.x,b.y));
    } else {
        graph.push_str(";[base]format=yuv420p,setsar=1[out]");
    }
    Ok(graph)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn video(w: u32, h: u32) -> Video {
        Video {
            path: "test video.mp4".into(),
            width: w,
            height: h,
            duration: 3.,
            fps: 60.,
            has_audio: true,
            color_transfer: String::new(),
        }
    }
    #[test]
    fn cover_never_leaves_bars() {
        for (sw, sh) in [(1920, 1080), (3840, 2160), (720, 1280), (1000, 1000)] {
            let g = geometry(&video(sw, sh), &Preset::default(), 1080, 1920).unwrap();
            assert!(g.background.width >= 1080 && g.background.height >= 1920);
        }
    }
    #[test]
    fn full_gameplay_and_center() {
        let g = geometry(&video(1920, 1080), &Preset::default(), 1080, 1920).unwrap();
        assert_eq!(g.gameplay.width, 1080);
        assert!((g.gameplay.height as f64 - 607.5).abs() <= 1.);
        assert_eq!(g.gameplay.x, 0);
        assert_eq!(g.gameplay.y, (1920 - g.gameplay.height) as i32 / 2);
    }
    #[test]
    fn normalized_crop_and_boost_scale() {
        let mut p = Preset::default();
        let a = geometry(&video(1920, 1080), &p, 1080, 1920).unwrap();
        let b = geometry(&video(3840, 2160), &p, 1080, 1920).unwrap();
        assert!((b.crop.x - a.crop.x * 2).abs() <= 2);
        p.boost.scale = 2.;
        let c = geometry(&video(1920, 1080), &p, 1080, 1920).unwrap();
        assert!((c.boost.width as i32 - a.boost.width as i32 * 2).abs() <= 2);
    }
    #[test]
    fn preview_geometry_and_blur_match_export_scale() {
        let p = Preset::default();
        let v = video(1920, 1080);
        let preview = geometry(&v, &p, 360, 640).unwrap();
        let export = geometry(&v, &p, 1080, 1920).unwrap();
        assert_eq!(preview.crop.width, export.crop.width);
        assert_eq!(preview.crop.height, export.crop.height);
        for (small, large) in [
            (preview.gameplay, export.gameplay),
            (preview.boost, export.boost),
        ] {
            assert!((small.width as i32 * 3 - large.width as i32).abs() <= 2);
            assert!((small.height as i32 * 3 - large.height as i32).abs() <= 2);
            assert!((small.x * 3 - large.x).abs() <= 2);
            assert!((small.y * 3 - large.y).abs() <= 2);
        }
        let preview_graph = filter_graph(&v, &p, 360, 640).unwrap();
        assert!(preview_graph.contains("scale=90:160:flags=bilinear"));
        assert!(preview_graph.contains("sigma=2.500000:steps=2,scale=360:640"));
        let export_graph = filter_graph(&v, &p, 1080, 1920).unwrap();
        assert!(export_graph.contains("crop=608:1080:656:0"));
        assert!(export_graph.contains("scale=270:480:flags=bilinear"));
        assert!(export_graph.contains("sigma=7.500000:steps=2,scale=1080:1920"));
        assert!(!export_graph.contains("scale=1920:1080:flags=lanczos,setsar=1,split="));
    }
    #[test]
    fn disabled_background_blur_skips_the_expensive_filter() {
        let mut p = Preset::default();
        p.background.blur = 0.;
        let graph = filter_graph(&video(1920, 1080), &p, 1080, 1920).unwrap();
        assert!(!graph.contains("gblur="));
        assert!(graph.contains("crop=608:1080:656:0,scale=1080:1920:flags=lanczos"));
    }
    #[test]
    fn zoomed_gameplay_crops_invisible_pixels_before_scaling() {
        let mut p = Preset::default();
        p.gameplay.scale = 2.36;
        let graph = filter_graph(&video(3840, 2160), &p, 1080, 1920).unwrap();
        assert!(
            graph.contains("[gamesrc]crop=1628:2160:1106:0,scale=1080:1434:flags=lanczos"),
            "{graph}"
        );
        assert!(!graph.contains("scale=2548:1434"));
    }
    #[test]
    fn gameplay_shadow_is_soft_and_outside_the_visible_frame() {
        let mut p = Preset::default();
        p.gameplay.shadow = true;
        p.gameplay.scale = 2.36;
        let graph = filter_graph(&video(3840, 2160), &p, 1080, 1920).unwrap();
        assert!(graph.contains("color=black@0.620"), "{graph}");
        assert!(graph.contains("color=black@0.015"), "{graph}");
        assert!(graph.contains("eq=saturation=1.000000"), "{graph}");
        assert!(graph.contains("hue=h=0.000000"), "{graph}");
        assert!(!graph.contains("black@0.68"), "{graph}");
        assert!(!graph.contains("w=2548"), "{graph}");
    }
    #[test]
    fn ellipse_has_independent_axes() {
        let mut p = Preset::default();
        p.boost.shape = Shape::Ellipse;
        p.boost.height = 0.2;
        let graph = filter_graph(&video(1920, 1080), &p, 720, 1280).unwrap();
        assert!(graph.contains("(H/2)"));
        assert!(graph.contains("format=yuva420p"));
    }
    #[test]
    fn disabled_boost_has_no_unused_split() {
        let mut p = Preset::default();
        p.boost.enabled = false;
        let g = filter_graph(&video(1920, 1080), &p, 720, 1280).unwrap();
        assert!(!g.contains("hudsrc"));
        assert!(g.contains("split=2"));
    }
}
