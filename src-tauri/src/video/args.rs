use super::geometry::{color_filter, filter_graph_normalized};
use crate::model::{
    BoostEasing, EffectKind, EffectScope, ExportOptions, FlashEffect, MusicTrack, Preset, Segment,
    SfxTrack, TextOverlay, Video,
};
use std::path::Path;

fn multiply_color_matrices(left: [[f64; 3]; 3], right: [[f64; 3]; 3]) -> [[f64; 3]; 3] {
    let mut output = [[0.; 3]; 3];
    for row in 0..3 {
        for column in 0..3 {
            output[row][column] = (0..3)
                .map(|index| left[row][index] * right[index][column])
                .sum();
        }
    }
    output
}

fn raggeo_matrix(amount: f64) -> ([[f64; 3]; 3], f64) {
    let brightness = 1. - amount * 0.12;
    let contrast = 1. + amount * 0.32;
    let saturation = 1. + amount * 0.78;
    let angle = (-8. * amount).to_radians();
    let (sin, cos) = angle.sin_cos();
    let saturated = [
        [
            0.213 + 0.787 * saturation,
            0.715 - 0.715 * saturation,
            0.072 - 0.072 * saturation,
        ],
        [
            0.213 - 0.213 * saturation,
            0.715 + 0.285 * saturation,
            0.072 - 0.072 * saturation,
        ],
        [
            0.213 - 0.213 * saturation,
            0.715 - 0.715 * saturation,
            0.072 + 0.928 * saturation,
        ],
    ];
    let hue = [
        [
            0.213 + 0.787 * cos - 0.213 * sin,
            0.715 - 0.715 * cos - 0.715 * sin,
            0.072 - 0.072 * cos + 0.928 * sin,
        ],
        [
            0.213 - 0.213 * cos + 0.143 * sin,
            0.715 + 0.285 * cos + 0.140 * sin,
            0.072 - 0.072 * cos - 0.283 * sin,
        ],
        [
            0.213 - 0.213 * cos - 0.787 * sin,
            0.715 - 0.715 * cos + 0.715 * sin,
            0.072 + 0.928 * cos + 0.072 * sin,
        ],
    ];
    let mut matrix = multiply_color_matrices(hue, saturated);
    for row in &mut matrix {
        for value in row {
            *value *= brightness * contrast;
        }
    }
    (matrix, 0.5 * (1. - contrast))
}

fn append_effect_filters(
    graph: &mut String,
    video_output: &mut String,
    effects: &[FlashEffect],
    scope: EffectScope,
    width: u32,
    height: u32,
    timeline_duration: f64,
) {
    for (index, effect) in effects
        .iter()
        .enumerate()
        .filter(|(_, effect)| effect.scope == scope)
    {
        let prefix = match scope {
            EffectScope::Video => "video_effect",
            EffectScope::All => "all_effect",
        };
        let next = format!("{prefix}{index}");
        let alpha = if effect.kind == EffectKind::Flash {
            let u = format!("((T-{:.6})/{:.6})", effect.time, effect.duration);
            let fade = match &effect.easing {
                BoostEasing::Linear => format!("1-{u}"),
                BoostEasing::Ease => format!("1-(pow({u},2)*(3-2*{u}))"),
                BoostEasing::EaseIn => format!("1-pow({u},3)"),
                BoostEasing::EaseOut => format!("pow(1-{u},3)"),
                BoostEasing::EaseInOut => {
                    format!("if(lt({u},0.5),1-4*pow({u},3),pow(-2*{u}+2,3)/2)")
                }
            };
            format!(
                "if(between(T,{:.6},{:.6}),{:.6}*({fade}),0)",
                effect.time,
                effect.time + effect.duration,
                effect.intensity
            )
        } else {
            String::new()
        }
        .replace(',', "\\,");
        match effect.kind {
            EffectKind::Flash => {
                let styled = format!("{prefix}_styled{index}");
                let input = format!("{prefix}_input{index}");
                graph.push_str(&format!(
                    ";color=c=0x{}:s={width}x{height}:d={timeline_duration:.6},format=yuv444p[{styled}];[{video_output}]format=yuv444p[{input}];[{input}][{styled}]blend=all_expr='A*(1-({alpha}))+B*({alpha})':shortest=1[{next}]",
                    effect.color.trim_start_matches('#')
                ));
            }
            EffectKind::DarkGray => {
                let enabled = format!(
                    "between(t\\,{:.6}\\,{:.6})",
                    effect.time,
                    effect.time + effect.duration
                );
                // Match CSS `grayscale() brightness() contrast()` exactly.
                // The preview uses that filter chain, so exporting through a
                // YUV hue filter produces visibly different colors. CSS uses
                // this sRGB luminance matrix and applies brightness before
                // contrast; the alpha-channel terms provide contrast's offset.
                let amount = effect.intensity;
                let inverse = 1. - amount;
                // A stronger cinematic grade: full intensity is deliberately
                // darker and punchier instead of looking pale/washed out.
                let brightness = 1. - amount * 0.4;
                let contrast = 1. + 0.35 * amount;
                let gain = brightness * contrast;
                let offset = 0.5 * (1. - contrast);
                let rr = gain * (0.2126 + 0.7874 * inverse);
                let rg = gain * (0.7152 * amount);
                let rb = gain * (0.0722 * amount);
                let gr = gain * (0.2126 * amount);
                let gg = gain * (0.7152 + 0.2848 * inverse);
                let gb = gain * (0.0722 * amount);
                let br = gain * (0.2126 * amount);
                let bg = gain * (0.7152 * amount);
                let bb = gain * (0.0722 + 0.9278 * inverse);
                graph.push_str(&format!(
                    ";[{video_output}]colorchannelmixer=rr={rr:.6}:rg={rg:.6}:rb={rb:.6}:ra={offset:.6}:gr={gr:.6}:gg={gg:.6}:gb={gb:.6}:ga={offset:.6}:br={br:.6}:bg={bg:.6}:bb={bb:.6}:ba={offset:.6}:enable='{enabled}'[{next}]"
                ));
            }
            EffectKind::Raggeo => {
                let enabled = format!(
                    "between(t\\,{:.6}\\,{:.6})",
                    effect.time,
                    effect.time + effect.duration
                );
                let (matrix, offset) = raggeo_matrix(effect.intensity);
                graph.push_str(&format!(
                    ";[{video_output}]colorchannelmixer=rr={:.6}:rg={:.6}:rb={:.6}:ra={offset:.6}:gr={:.6}:gg={:.6}:gb={:.6}:ga={offset:.6}:br={:.6}:bg={:.6}:bb={:.6}:ba={offset:.6}:enable='{enabled}'[{next}]",
                    matrix[0][0], matrix[0][1], matrix[0][2], matrix[1][0], matrix[1][1], matrix[1][2], matrix[2][0], matrix[2][1], matrix[2][2]
                ));
            }
        }
        *video_output = next;
    }
}
pub fn export_args(
    v: &Video,
    p: &Preset,
    o: &ExportOptions,
    out: &Path,
) -> Result<Vec<String>, String> {
    export_args_segments(
        v,
        p,
        &[Segment {
            start: 0.,
            end: v.duration,
            volume: 1.,
            color_fix: 0.,
        }],
        o,
        out,
    )
}
pub fn export_args_segments(
    v: &Video,
    p: &Preset,
    segments: &[Segment],
    o: &ExportOptions,
    out: &Path,
) -> Result<Vec<String>, String> {
    export_args_timeline(v, p, segments, o, out, None, None, &[], &[])
}
#[allow(clippy::too_many_arguments)] // Export graph inputs intentionally stay explicit at this boundary.
pub fn export_args_timeline(
    v: &Video,
    p: &Preset,
    segments: &[Segment],
    o: &ExportOptions,
    out: &Path,
    music: Option<&MusicTrack>,
    music_fade_out: Option<f64>,
    sfx: &[SfxTrack],
    texts: &[TextOverlay],
) -> Result<Vec<String>, String> {
    export_args_timeline_sources(
        std::slice::from_ref(v),
        p,
        segments,
        o,
        out,
        music,
        music_fade_out,
        sfx,
        texts,
    )
}
#[allow(clippy::too_many_arguments)] // Export graph inputs intentionally stay explicit at this boundary.
pub fn export_args_timeline_sources(
    videos: &[Video],
    p: &Preset,
    segments: &[Segment],
    o: &ExportOptions,
    out: &Path,
    music: Option<&MusicTrack>,
    music_fade_out: Option<f64>,
    sfx: &[SfxTrack],
    texts: &[TextOverlay],
) -> Result<Vec<String>, String> {
    export_args_impl(
        videos,
        p,
        segments,
        o,
        out,
        music,
        music_fade_out,
        sfx,
        texts,
        None,
    )
}
#[allow(clippy::too_many_arguments)] // AI finishing uses the same explicit export graph inputs.
pub fn finish_ai_args(
    videos: &[Video],
    p: &Preset,
    segments: &[Segment],
    o: &ExportOptions,
    out: &Path,
    music: Option<&MusicTrack>,
    music_fade_out: Option<f64>,
    sfx: &[SfxTrack],
    texts: &[TextOverlay],
    enhanced: &Path,
) -> Result<Vec<String>, String> {
    export_args_impl(
        videos,
        p,
        segments,
        o,
        out,
        music,
        music_fade_out,
        sfx,
        texts,
        Some(enhanced),
    )
}
#[allow(clippy::too_many_arguments)] // Central graph builder receives the complete immutable export context.
fn export_args_impl(
    videos: &[Video],
    p: &Preset,
    segments: &[Segment],
    o: &ExportOptions,
    out: &Path,
    music: Option<&MusicTrack>,
    music_fade_out: Option<f64>,
    sfx: &[SfxTrack],
    texts: &[TextOverlay],
    enhanced: Option<&Path>,
) -> Result<Vec<String>, String> {
    let (w, h) = if enhanced.is_some() {
        o.output_resolution()?
    } else {
        o.resolution()?
    };
    if videos.is_empty()
        || videos
            .iter()
            .any(|video| !video.duration.is_finite() || video.duration <= 0.)
    {
        return Err("Invalid video duration".into());
    }
    let total_duration: f64 = videos.iter().map(|video| video.duration).sum();
    Segment::validate_all(segments, total_duration)?;
    let edited_duration: f64 = segments.iter().map(|s| s.end - s.start).sum();
    TextOverlay::validate_all(texts, edited_duration)?;
    FlashEffect::validate_all(&o.effects, edited_duration)?;
    let mut offsets = Vec::with_capacity(videos.len());
    let mut offset = 0.;
    for video in videos {
        offsets.push(offset);
        offset += video.duration;
    }
    let resolved = segments
        .iter()
        .map(|segment| {
            let source = offsets
                .iter()
                .enumerate()
                .rev()
                .find(|(_, offset)| segment.start >= **offset)
                .map(|(index, _)| index)
                .ok_or("Timeline clip has no source")?;
            let local_start = segment.start - offsets[source];
            let local_end = segment.end - offsets[source];
            if local_start < -0.001 || local_end > videos[source].duration + 0.001 {
                return Err("A timeline clip cannot cross between source videos".into());
            }
            Ok((
                source,
                local_start.max(0.),
                local_end.min(videos[source].duration),
            ))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut v = videos[0].clone();
    v.duration = total_duration;
    v.has_audio = videos.iter().any(|video| video.has_audio);
    let needs_source_video = enhanced.is_none() || p.boost.enabled;
    let mut graph = String::new();
    if needs_source_video {
        for (source, video) in videos.iter().enumerate() {
            let indices = resolved
                .iter()
                .enumerate()
                .filter_map(|(index, value)| (value.0 == source).then_some(index))
                .collect::<Vec<_>>();
            if indices.is_empty() {
                continue;
            }
            let outputs = indices
                .iter()
                .map(|index| format!("[edit{index}]"))
                .collect::<String>();
            if !graph.is_empty() {
                graph.push(';');
            }
            graph.push_str(&format!(
                "[{source}:v:0]{},split={}{outputs}",
                color_filter(video),
                indices.len()
            ));
        }
        for (index, (source, start, end)) in resolved.iter().copied().enumerate() {
            let normalize = if videos[source].width == videos[0].width
                && videos[source].height == videos[0].height
            {
                ",setsar=1".to_string()
            } else {
                format!(
                    ",scale={}:{}:flags=lanczos,setsar=1",
                    videos[0].width, videos[0].height
                )
            };
            let fix = segments[index].color_fix;
            let correction = if fix > 0.0001 {
                format!(
                    ",eq=brightness={:.5}:contrast={:.5}:saturation={:.5}:gamma={:.5}",
                    -0.018 * fix,
                    1. + 0.32 * fix,
                    1. + 0.28 * fix,
                    1. / (1. + 0.20 * fix)
                )
            } else {
                String::new()
            };
            graph.push_str(&format!(
            ";[edit{index}]trim=start={start:.6}:end={end:.6},setpts=PTS-STARTPTS{normalize}{correction}[v{index}]"
        ));
        }
        let video_inputs = (0..segments.len())
            .map(|i| format!("[v{i}]"))
            .collect::<String>();
        graph.push_str(&format!(
            ";{video_inputs}concat=n={}:v=1:a=0[source_edit]",
            segments.len()
        ));
    }
    let mut composition = if enhanced.is_some() {
        let index =
            videos.len() + usize::from(music.is_some_and(|m| !m.segments.is_empty())) + sfx.len();
        let mut value = format!("[{index}:v:0]setpts=PTS-STARTPTS[base]");
        if p.boost.enabled {
            let g = super::geometry::geometry(&v, p, w, h)?;
            let b = g.boost;
            let c = g.crop;
            let radius = b.width.min(b.height) as f64 / 2.;
            let distance = match p.boost.shape {
                crate::model::Shape::Circle => {
                    format!("sqrt(pow((X-(W-1)/2)/{radius:.6},2)+pow((Y-(H-1)/2)/{radius:.6},2))")
                }
                crate::model::Shape::Ellipse => {
                    "sqrt(pow((X-(W-1)/2)/(W/2),2)+pow((Y-(H-1)/2)/(H/2),2))".into()
                }
            };
            let alpha = if p.boost.feather == 0. {
                format!("if(lte({distance},1),255,0)")
            } else {
                format!("255*clip((1-({distance}))/{:.6},0,1)", p.boost.feather)
            };
            value.push_str(&format!(
                ";[source_edit]crop={}:{}:{}:{},scale={}:{}:flags=lanczos,format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='{alpha}'[hud];[base][hud]overlay=x={}:y={}:eval=init:shortest=1:format=yuv420,format=yuv420p,setsar=1[out_edit]",
                c.width, c.height, c.x, c.y, b.width, b.height, b.x, b.y
            ));
        } else {
            value.push_str(";[base]format=yuv420p,setsar=1[out_edit]");
        }
        value
    } else {
        filter_graph_normalized(&v, p, w, h)?
            .replace("[0:v:0]", "[source_edit]")
            .replace("[out]", "[out_edit]")
    };
    if p.boost.intro.enabled && p.boost.enabled {
        let b = super::geometry::geometry(&v, p, w, h)?.boost;
        let hidden = -(b.width as i32) - 5;
        let duration = p.boost.intro.duration;
        let u = format!("(t/{duration:.6})");
        let easing = match &p.boost.intro.easing {
            BoostEasing::Linear => u.clone(),
            BoostEasing::Ease => format!("pow({u},2)*(3-2*{u})"),
            BoostEasing::EaseIn => format!("pow({u},3)"),
            BoostEasing::EaseOut => format!("1-pow(1-{u},3)"),
            BoostEasing::EaseInOut => {
                format!("if(lt({u},0.5),4*pow({u},3),1-pow(-2*{u}+2,3)/2)")
            }
        };
        composition = composition.replace(
            &format!("[base][hud]overlay=x={}:y={}:eval=init", b.x, b.y),
            &format!("[base][hud]overlay=x='if(lt(t,{duration:.6}),{hidden}+({}-({hidden}))*({easing}),{})':y={}:eval=frame", b.x, b.x, b.y),
        ).replace("eval=frame:shortest=1:format=yuv420", "eval=frame:shortest=1:format=yuv444");
    }
    if !graph.is_empty() {
        graph.push(';');
    }
    graph.push_str(&composition);
    let mut video_output = "out_edit".to_string();
    append_effect_filters(
        &mut graph,
        &mut video_output,
        &o.effects,
        EffectScope::Video,
        w,
        h,
        edited_duration,
    );
    for (index, text) in texts.iter().enumerate() {
        let next = format!("text{index}");
        if text.rendered_path.is_some() {
            let image_index = videos.len()
                + usize::from(music.is_some_and(|m| !m.segments.is_empty()))
                + sfx.len()
                + usize::from(enhanced.is_some())
                + texts[..index]
                    .iter()
                    .filter(|t| t.rendered_path.is_some())
                    .count();
            let mut fades = String::new();
            if let Some(duration) = text.fade_in {
                fades.push_str(&format!(
                    ",fade=t=in:st={:.6}:d={duration:.6}:alpha=1",
                    text.start
                ));
            }
            if let Some(duration) = text.fade_out {
                fades.push_str(&format!(
                    ",fade=t=out:st={:.6}:d={duration:.6}:alpha=1",
                    (text.end - duration).max(text.start)
                ));
            }
            graph.push_str(&format!(";[{image_index}:v:0]format=rgba,loop=loop=-1:size=1:start=0,settb=expr=1/{},setpts=N{fades}[stamp{index}];[{video_output}][stamp{index}]overlay=x={}:y={}:format=auto:shortest=1:enable='between(t,{:.6},{:.6})'[{next}]",o.fps,text.rendered_x,text.rendered_y,text.start,text.end));
            video_output = next;
            continue;
        }
        let escaped_text = text
            .text
            .replace('\\', "\\\\")
            .replace('\'', "\\'")
            .replace(':', "\\:")
            .replace('%', "\\%")
            .replace('\n', "\\n");
        let styled_path = match (text.italic, text.font_weight) {
            (true, 900) if !text.font_black_italic_path.is_empty() => &text.font_black_italic_path,
            (true, 700) if !text.font_bold_italic_path.is_empty() => &text.font_bold_italic_path,
            (true, _) if !text.font_italic_path.is_empty() => &text.font_italic_path,
            (false, 900) if !text.font_black_path.is_empty() => &text.font_black_path,
            (false, 700) if !text.font_bold_path.is_empty() => &text.font_bold_path,
            _ => &text.font_path,
        };
        let font = if styled_path.is_empty() {
            String::new()
        } else {
            format!(
                "fontfile='{}':",
                styled_path
                    .replace('\\', "\\\\")
                    .replace(':', "\\:")
                    .replace('\'', "\\'")
            )
        };
        let x = match text.align.as_str() {
            "left" => format!("w*{:.6}", text.x - text.box_width / 2.),
            "right" => format!("w*{:.6}-text_w", text.x + text.box_width / 2.),
            _ => format!("w*{:.6}-text_w/2", text.x),
        };
        let size = text.font_size * text.scale * w as f64 / 1080.;
        let color = text.color.trim_start_matches('#');
        let stroke = text.stroke_color.trim_start_matches('#');
        let background = text.background_color.trim_start_matches('#');
        let shadow = text.shadow_color.trim_start_matches('#');
        // CSS text strokes are centered on the glyph edge, while FFmpeg's
        // drawtext borderw grows entirely outwards. Export half of the CSS
        // stroke width so the visible outline matches the live preview.
        let stroke_factor = match text.stroke_position.as_str() {
            "outside" => 1.,
            "inside" => 0.25,
            _ => 0.5,
        };
        let line_spacing = (text.line_height - 1.) * size;
        let border_width = text.stroke_width * stroke_factor * w as f64 / 1080.;
        let shadow_x = text.shadow_x * w as f64 / 1080.;
        let shadow_y = text.shadow_y * w as f64 / 1080.;
        let blurred_shadow = text.shadow_enabled && text.shadow_blur > 0.001;
        let fade_out = text
            .fade_out
            .map(|value| {
                format!(
                    "if(gt(t,{:.6}),0,if(gt(t,{:.6}),({:.6}-t)/{value:.6},1))",
                    text.end,
                    text.end - value,
                    text.end
                )
            })
            .unwrap_or_else(|| format!("if(gt(t,{:.6}),0,1)", text.end));
        let alpha = text
            .fade_in
            .map(|value| {
                format!(
                    "if(lt(t,{:.6}),0,if(lt(t,{:.6}),(t-{:.6})/{value:.6},{fade_out}))",
                    text.start,
                    text.start + value,
                    text.start
                )
            })
            .unwrap_or_else(|| format!("if(lt(t,{:.6}),0,{fade_out})", text.start))
            // Commas inside a drawtext expression must survive the filtergraph
            // option parser before the expression evaluator sees them.
            .replace(',', "\\,");
        let hard_shadow = if !text.shadow_enabled || blurred_shadow {
            String::new()
        } else {
            format!(":shadowx={shadow_x:.3}:shadowy={shadow_y:.3}:shadowcolor=0x{shadow}")
        };
        let style = format!(
            "{font}text='{escaped_text}':fontsize={size:.3}:fontcolor=0x{color}@{:.4}:line_spacing={line_spacing:.3}:borderw={border_width:.3}:bordercolor=0x{stroke}:box={}:boxcolor=0x{background}@{:.4}{hard_shadow}:alpha='{alpha}'",
            text.opacity, if text.background_opacity > 0. { 1 } else { 0 }, text.background_opacity
        );
        if blurred_shadow {
            let shadow_style = format!(
                "{font}text='{escaped_text}':fontsize={size:.3}:fontcolor=0x{shadow}@{:.4}:line_spacing={line_spacing:.3}:borderw={border_width:.3}:bordercolor=0x{shadow}:alpha='{alpha}'",
                text.opacity
            );
            let shadow_layer = format!("text_shadow_layer{index}");
            let shadowed = format!("text_shadowed{index}");
            // CSS filter blur() and FFmpeg gblur both express the Gaussian
            // standard deviation, so the preview value maps directly.
            let sigma = (text.shadow_blur * w as f64 / 1080.).max(0.1);
            if text.rotation.abs() > 0.001 {
                graph.push_str(&format!(
                    ";color=c=black@0.0:s={w}x{h}:d={edited_duration:.6},format=rgba,drawtext={shadow_style}:x='(w-text_w)/2+{shadow_x:.3}':y='(h-text_h)/2+{shadow_y:.3}',gblur=sigma={sigma:.3}:steps=2:planes=8,rotate={:.8}:c=none:ow=iw:oh=ih[{shadow_layer}];[{video_output}][{shadow_layer}]overlay=x='W*{:.6}-w/2':y='H*{:.6}-h/2':format=auto[{shadowed}]",
                    text.rotation.to_radians(), text.x, text.y
                ));
            } else {
                graph.push_str(&format!(
                    ";color=c=black@0.0:s={w}x{h}:d={edited_duration:.6},format=rgba,drawtext={shadow_style}:x='({x})+{shadow_x:.3}':y='h*{:.6}-text_h/2+{shadow_y:.3}',gblur=sigma={sigma:.3}:steps=2:planes=8[{shadow_layer}];[{video_output}][{shadow_layer}]overlay=x=0:y=0:format=auto[{shadowed}]",
                    text.y
                ));
            }
            video_output = shadowed;
        }
        if text.rotation.abs() > 0.001 {
            let layer = format!("text_layer{index}");
            graph.push_str(&format!(
                ";color=c=black@0.0:s={w}x{h}:d={edited_duration:.6},format=rgba,drawtext={style}:x='(w-text_w)/2':y='(h-text_h)/2',rotate={:.8}:c=none:ow=iw:oh=ih[{layer}];[{video_output}][{layer}]overlay=x='W*{:.6}-w/2':y='H*{:.6}-h/2':format=auto[{next}]",
                text.rotation.to_radians(), text.x, text.y
            ));
        } else {
            graph.push_str(&format!(
                ";[{video_output}]drawtext={style}:x='{x}':y='h*{:.6}-text_h/2'[{next}]",
                text.y
            ));
        }
        video_output = next;
    }
    append_effect_filters(
        &mut graph,
        &mut video_output,
        &o.effects,
        EffectScope::All,
        w,
        h,
        edited_duration,
    );
    if v.has_audio {
        for (source, video) in videos.iter().enumerate() {
            if !video.has_audio {
                continue;
            }
            let indices = resolved
                .iter()
                .enumerate()
                .filter_map(|(index, value)| (value.0 == source).then_some(index))
                .collect::<Vec<_>>();
            if indices.is_empty() {
                continue;
            }
            let outputs = indices
                .iter()
                .map(|index| format!("[audio{index}]"))
                .collect::<String>();
            graph.push_str(&format!(";[{source}:a:0]asplit={}{outputs}", indices.len()));
        }
        for (index, (source, start, end)) in resolved.iter().copied().enumerate() {
            if videos[source].has_audio {
                graph.push_str(&format!(
                    ";[audio{index}]atrim=start={start:.6}:end={end:.6},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo,volume={:.4}[a{index}]",
                    segments[index].volume
                ));
            } else {
                graph.push_str(&format!(
                    ";anullsrc=r=48000:cl=stereo,atrim=duration={:.6},asetpts=PTS-STARTPTS,volume={:.4}[a{index}]",
                    end - start, segments[index].volume
                ));
            }
        }
        let audio_inputs = (0..segments.len())
            .map(|i| format!("[a{i}]"))
            .collect::<String>();
        graph.push_str(&format!(
            ";{audio_inputs}concat=n={}:v=0:a=1[audio_join];[audio_join]apad[audio_edit]",
            segments.len()
        ));
    }
    let music = music.filter(|m| !m.segments.is_empty());
    if let Some(music) = music {
        music.validate()?;
        let outputs = (0..music.segments.len())
            .map(|i| format!("[ms{i}]"))
            .collect::<String>();
        graph.push_str(&format!(
            ";[{}:a:0]asplit={}{outputs}",
            videos.len(),
            music.segments.len()
        ));
        for (i, s) in music.segments.iter().enumerate() {
            graph.push_str(&format!(
                ";[ms{i}]atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS,volume={:.4}[mt{i}]",
                s.start, s.end, s.volume
            ));
        }
        let inputs = (0..music.segments.len())
            .map(|i| format!("[mt{i}]"))
            .collect::<String>();
        let music_duration: f64 = music.segments.iter().map(|s| s.end - s.start).sum();
        let fade = music_fade_out.map(|requested| {
            let end = segments
                .iter()
                .map(|s| s.end - s.start)
                .sum::<f64>()
                .min(music_duration);
            let duration = requested.min(end);
            (end - duration, duration)
        });
        graph.push_str(&format!(
            ";{inputs}concat=n={}:v=0:a=1,apad{}[music_edit]",
            music.segments.len(),
            fade.map(|(start, duration)| format!(",afade=t=out:st={start:.6}:d={duration:.6}"))
                .unwrap_or_default()
        ));
    }
    let music_input_count = usize::from(music.is_some());
    for (track_index, track) in sfx.iter().enumerate() {
        track.validate()?;
        let input_index = videos.len() + music_input_count + track_index;
        let outputs = (0..track.segments.len())
            .map(|i| format!("[s{track_index}s{i}]"))
            .collect::<String>();
        graph.push_str(&format!(
            ";[{input_index}:a:0]asplit={}{outputs}",
            track.segments.len()
        ));
        for (segment_index, segment) in track.segments.iter().enumerate() {
            graph.push_str(&format!(
                ";[s{track_index}s{segment_index}]atrim=start={:.6}:end={:.6},asetpts=PTS-STARTPTS,volume={:.4}[s{track_index}t{segment_index}]",
                segment.start, segment.end, segment.volume
            ));
        }
        let inputs = (0..track.segments.len())
            .map(|i| format!("[s{track_index}t{i}]"))
            .collect::<String>();
        let delay = (track.timeline_start * 1000.).round() as u64;
        graph.push_str(&format!(
            ";{inputs}concat=n={}:v=0:a=1,adelay={delay}|{delay},apad[sfx_edit{track_index}]",
            track.segments.len()
        ));
    }
    let mut mix_inputs = Vec::new();
    if v.has_audio {
        mix_inputs.push("[audio_edit]".to_string());
    }
    if music.is_some() {
        mix_inputs.push("[music_edit]".to_string());
    }
    mix_inputs.extend((0..sfx.len()).map(|index| format!("[sfx_edit{index}]")));
    let has_overlay_audio = music.is_some() || !sfx.is_empty();
    if has_overlay_audio && mix_inputs.len() > 1 {
        graph.push_str(&format!(
            ";{}amix=inputs={}:duration=longest:normalize=0,alimiter=limit=0.95:level=0:attack=1[audio_mix]",
            mix_inputs.join(""), mix_inputs.len()
        ));
    } else if has_overlay_audio {
        let input = mix_inputs.first().expect("overlay audio input");
        graph.push_str(&format!(
            ";{input}alimiter=limit=0.95:level=0:attack=1[audio_mix]"
        ));
    }
    let mut args = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "warning".into(),
        "-nostdin".into(),
        "-n".into(),
        "-filter_complex_threads".into(),
        std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1)
            .to_string(),
    ];
    for video in videos {
        args.extend(["-i".into(), video.path.clone()]);
    }
    if let Some(music) = music {
        args.extend(["-i".into(), music.path.clone()]);
    }
    for track in sfx {
        track.validate()?;
        args.extend(["-i".into(), track.path.clone()]);
    }
    if let Some(enhanced) = enhanced {
        args.extend(["-i".into(), enhanced.to_string_lossy().into_owned()]);
    }
    for text in texts {
        if let Some(path) = &text.rendered_path {
            args.extend([
                "-framerate".into(),
                o.fps.to_string(),
                "-i".into(),
                path.clone(),
            ]);
        }
    }
    args.extend([
        "-filter_complex".into(),
        graph,
        "-map".into(),
        format!("[{video_output}]"),
    ]);
    if v.has_audio || music.is_some() || !sfx.is_empty() {
        args.extend(
            [
                "-map",
                if has_overlay_audio {
                    "[audio_mix]"
                } else {
                    "[audio_edit]"
                },
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-shortest",
            ]
            .map(String::from),
        );
    } else {
        args.push("-an".into());
    }
    args.extend(
        [
            "-color_range",
            "tv",
            "-colorspace",
            "bt709",
            "-color_primaries",
            "bt709",
            "-color_trc",
            "bt709",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "20",
            "-pix_fmt",
            "yuv420p",
            "-r",
        ]
        .map(String::from),
    );
    args.push(o.fps.to_string());
    // Older FFmpeg versions can flush padded audio past video EOF despite
    // -shortest. An explicit video duration bounds both streams consistently.
    args.extend(["-t".into(), format!("{edited_duration:.6}")]);
    args.extend(
        [
            "-vsync",
            "cfr",
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-nostats",
            "-f",
            "mp4",
        ]
        .map(String::from),
    );
    args.push(out.to_string_lossy().into());
    Ok(args)
}
/// Bound composition and codec threads for the optional AI staging pass.
pub fn safe_ai_render_args(mut args: Vec<String>) -> Vec<String> {
    for i in 0..args.len().saturating_sub(1) {
        if args[i] == "-filter_complex_threads" {
            args[i + 1] = "1".into();
        }
        if args[i] == "-crf" {
            args[i + 1] = "14".into();
        }
    }
    let mut bounded = Vec::new();
    for arg in args {
        if arg == "-i" {
            bounded.extend(["-threads".into(), "1".into()]);
        }
        bounded.push(arg);
    }
    let last = bounded.pop().unwrap_or_default();
    bounded.extend(["-threads".into(), "1".into(), last]);
    bounded
}
pub fn progress_seconds(line: &str) -> Option<f64> {
    line.strip_prefix("out_time_us=")
        .and_then(|s| s.trim().parse::<f64>().ok())
        .filter(|s| s.is_finite() && *s >= 0.)
        .map(|s| s / 1_000_000.)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn text(shadow_enabled: bool) -> TextOverlay {
        TextOverlay {
            id: "text".into(),
            track_id: "track".into(),
            text: "Shadow test".into(),
            start: 0.,
            end: 1.,
            x: 0.5,
            y: 0.5,
            scale: 1.,
            box_width: 0.7,
            rotation: 0.,
            rendered_path: None,
            rendered_x: 0,
            rendered_y: 0,
            font_family: "Sans".into(),
            font_path: String::new(),
            font_bold_path: String::new(),
            font_black_path: String::new(),
            font_italic_path: String::new(),
            font_bold_italic_path: String::new(),
            font_black_italic_path: String::new(),
            font_weight: 700,
            font_size: 54.,
            color: "#ffffff".into(),
            opacity: 1.,
            align: "center".into(),
            bold: true,
            italic: false,
            underline: false,
            letter_spacing: 0.,
            line_height: 1.2,
            stroke_color: "#000000".into(),
            stroke_width: 6.5,
            stroke_position: "outside".into(),
            background_color: "#000000".into(),
            background_opacity: 0.,
            shadow_enabled,
            shadow_color: "#000000".into(),
            shadow_blur: 4.,
            shadow_x: 0.,
            shadow_y: -17.,
            fade_in: None,
            fade_out: None,
        }
    }
    fn text_graph(shadow_enabled: bool, effects: Vec<FlashEffect>) -> String {
        let video = Video {
            path: "/tmp/input.mp4".into(),
            width: 1920,
            height: 1080,
            duration: 1.,
            fps: 60.,
            has_audio: false,
            color_transfer: String::new(),
        };
        let options = ExportOptions {
            ai_enhance: false,
            ai_upscale: false,
            ai_upscale_lite: false,
            ai_keep_resolution: false,
            effects,
            quality: 1080,
            fps: 60,
            folder: "/tmp".into(),
            filename: "out.mp4".into(),
        };
        let args = export_args_timeline(
            &video,
            &Preset::default(),
            &[Segment {
                start: 0.,
                end: 1.,
                volume: 1.,
                color_fix: 0.,
            }],
            &options,
            Path::new("/tmp/out.mp4"),
            None,
            None,
            &[],
            &[text(shadow_enabled)],
        )
        .unwrap();
        args.windows(2)
            .find(|pair| pair[0] == "-filter_complex")
            .map(|pair| pair[1].clone())
            .unwrap()
    }
    #[test]
    fn text_shadow_is_explicit_and_preview_scaled() {
        let disabled = text_graph(false, Vec::new());
        assert!(!disabled.contains("text_shadow_layer"));
        assert!(!disabled.contains("shadowx="));
        assert!(disabled.contains("borderw=6.500"));
        let enabled = text_graph(true, Vec::new());
        assert!(enabled.contains("text_shadow_layer0"));
        assert!(enabled.contains("gblur=sigma=4.000:steps=2:planes=8"));
        assert!(enabled.contains("-17.000"));
    }
    #[test]
    fn timeline_effects_respect_video_and_all_layer_order() {
        let graph = text_graph(
            false,
            vec![
                FlashEffect {
                    id: "flash".into(),
                    kind: EffectKind::Flash,
                    timing: crate::model::EffectTiming::Duration,
                    scope: EffectScope::Video,
                    time: 0.1,
                    duration: 0.4,
                    intensity: 0.8,
                    color: "#ffffff".into(),
                    easing: BoostEasing::EaseOut,
                },
                FlashEffect {
                    id: "gray".into(),
                    kind: EffectKind::DarkGray,
                    timing: crate::model::EffectTiming::Clip,
                    scope: EffectScope::All,
                    time: 0.2,
                    duration: 0.4,
                    intensity: 0.7,
                    color: "#ffffff".into(),
                    easing: BoostEasing::Ease,
                },
            ],
        );
        let video_effect = graph.find("[video_effect0]").unwrap();
        let text = graph.find("drawtext=").unwrap();
        let all_effect = graph.find("[all_effect1]").unwrap();
        assert!(video_effect < text && text < all_effect);
        assert!(graph.contains("colorchannelmixer="));
        assert!(graph.contains(":enable='between(t\\,0.200000\\,0.600000)'"));
    }
    #[test]
    fn structured_args_cfr_optional_audio() {
        let mut v = Video {
            path: "/tmp/a ' unicode é.mp4".into(),
            width: 1920,
            height: 1080,
            duration: 2.,
            fps: 29.97,
            has_audio: true,
            color_transfer: String::new(),
        };
        let o = ExportOptions {
            ai_enhance: false,
            ai_upscale: false,
            ai_upscale_lite: false,
            ai_keep_resolution: false,
            effects: Vec::new(),
            quality: 480,
            fps: 60,
            folder: "/tmp".into(),
            filename: "out.mp4".into(),
        };
        let a = export_args(&v, &Preset::default(), &o, Path::new("/tmp/out.mp4")).unwrap();
        assert!(a.contains(&v.path));
        assert!(a.contains(&"[audio_edit]".into()));
        assert!(a.iter().any(|value| value.contains("apad[audio_edit]")));
        assert!(a.iter().any(|value| value.contains("volume=1.0000")));
        assert!(a.contains(&"-shortest".into()));
        assert!(a.contains(&"cfr".into()));
        v.has_audio = false;
        let a = export_args(&v, &Preset::default(), &o, Path::new("/tmp/out.mp4")).unwrap();
        assert!(a.contains(&"-an".into()));
        assert!(!a.contains(&"aac".into()));
    }
    #[test]
    fn microsecond_progress() {
        assert_eq!(progress_seconds("out_time_us=1500000"), Some(1.5));
        assert_eq!(progress_seconds("out_time_us=N/A"), None);
        assert_eq!(progress_seconds("out_time_us=-1"), None);
    }
    #[test]
    fn even_output_and_invalid_fps() {
        for (q, d) in [(480, (480, 854)), (720, (720, 1280)), (1080, (1080, 1920))] {
            let o = ExportOptions {
                ai_enhance: false,
                ai_upscale: false,
                ai_upscale_lite: false,
                ai_keep_resolution: false,
                effects: Vec::new(),
                quality: q,
                fps: 30,
                folder: "".into(),
                filename: "".into(),
            };
            assert_eq!(o.resolution().unwrap(), d);
        }
        let o = ExportOptions {
            ai_enhance: false,
            ai_upscale: false,
            ai_upscale_lite: false,
            ai_keep_resolution: false,
            effects: Vec::new(),
            quality: 720,
            fps: 24,
            folder: "".into(),
            filename: "".into(),
        };
        assert!(o.resolution().is_err());
    }
}
