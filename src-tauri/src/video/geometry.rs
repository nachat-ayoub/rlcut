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
    let mut graph=format!("[0:v:0]{},scale={}:{}:flags=lanczos,setsar=1,split={}[bgsrc][gamesrc]{};[bgsrc]scale={}:{}:flags=lanczos,crop={}:{}:{}:{},gblur=sigma={:.6}:steps=4,eq=brightness={:.6}[bg];[gamesrc]scale={}:{}:flags=lanczos[game];[bg][game]overlay=x={}:y={}:eval=init:shortest=1[base]",input,video.width,video.height,if p.boost.enabled{
        3
    }
    else{
        2
    },if p.boost.enabled{
        "[hudsrc]"
    }
    else{
        ""
    },bg.width,bg.height,w,h,bg.x,bg.y,p.background.blur*w as f64/1080.,p.background.brightness,gp.width,gp.height,gp.x,gp.y);
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
        assert!(filter_graph(&v, &p, 360, 640)
            .unwrap()
            .contains("sigma=10.000000"));
        assert!(filter_graph(&v, &p, 1080, 1920)
            .unwrap()
            .contains("sigma=30.000000"));
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
