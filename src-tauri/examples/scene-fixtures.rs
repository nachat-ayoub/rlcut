use rlcut_lib::{
    model::{Preset, Video},
    video::geometry::{geometry, Layer},
};
use serde_json::json;
fn layer(p: Layer) -> serde_json::Value {
    json!({"x":p.x,"y":p.y,"width":p.width,"height":p.height})
}
fn main() {
    let mut fixtures = Vec::new();
    for (sw, sh) in [(1280, 720), (1920, 1080), (720, 1280)] {
        for (w, h) in [(480, 854), (720, 1280), (1080, 1920)] {
            for variant in 0..4 {
                let v = Video {
                    path: "fixture.mp4".into(),
                    width: sw,
                    height: sh,
                    duration: 3.,
                    fps: 60.,
                    has_audio: true,
                    color_transfer: "bt709".into(),
                };
                let mut p = Preset::default();
                if variant == 1 {
                    p.gameplay.x = 0.;
                    p.gameplay.y = 1.;
                    p.gameplay.scale = 2.7;
                    p.boost.scale = 1.8;
                    p.background.scale = 1.4;
                }
                if variant == 2 {
                    p.boost.width = 0.25;
                    p.boost.height = 0.12;
                    p.boost.x = 1.;
                    p.boost.y = 0.;
                    p.boost.feather = 0.1;
                    p.gameplay.scale = 0.37;
                }
                if variant == 3 {
                    p.gameplay.x = 0.499;
                    p.gameplay.y = 0.4999;
                }
                let g = geometry(&v, &p, w, h).unwrap();
                fixtures.push(json!({"video":v,"preset":p,"scene":{"width":w,"height":h,"background":layer(g.background),"gameplay":layer(g.gameplay),"boost":layer(g.boost),"crop":layer(g.crop)}}));
            }
        }
    }
    println!("{}", serde_json::to_string(&fixtures).unwrap());
}
