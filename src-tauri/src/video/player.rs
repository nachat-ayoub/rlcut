//! Native-clock playback with a single bounded decoded-frame queue. The UI
//! consumes binary RGBA packets and never starts a browser media decoder.
use crate::model::Segment;
#[cfg(target_os = "linux")]
use std::ffi::{c_char, c_int, c_void, CStr, CString};
#[cfg(target_os = "linux")]
unsafe extern "C" {
    fn rl_player_open(
        path: *const c_char,
        w: c_int,
        h: c_int,
        error: *mut c_char,
        size: usize,
    ) -> *mut c_void;
    fn rl_player_free(player: *mut c_void);
    fn rl_player_play(player: *mut c_void, playing: c_int) -> c_int;
    fn rl_player_volume(player: *mut c_void, volume: f64);
    fn rl_player_seek(player: *mut c_void, time: f64) -> c_int;
    fn rl_player_position(player: *mut c_void) -> f64;
    fn rl_player_status(player: *mut c_void, error: *mut c_char, size: usize) -> c_int;
    fn rl_player_frame(player: *mut c_void, w: c_int, h: c_int, pts: *mut f64) -> *mut u8;
    fn rl_frame_free(frame: *mut u8);
}
#[cfg(target_os = "linux")]
pub struct Player {
    handle: *mut c_void,
    width: u32,
    height: u32,
    playing: bool,
    seeking: Option<f64>,
    ended: bool,
    segments: Vec<Segment>,
    rgba: Vec<u8>,
    sequence: u32,
    frame_time: f64,
    position: f64,
    volume: f64,
    error: Option<String>,
}
#[cfg(not(target_os = "linux"))]
pub struct Player;
// Every call is protected by the application's player mutex; GStreamer owns
// its internal streaming threads and provides thread-safe control functions.
unsafe impl Send for Player {}
#[cfg(target_os = "linux")]
impl Player {
    pub fn open(
        path: &str,
        width: u32,
        height: u32,
        time: f64,
        segments: Vec<Segment>,
    ) -> Result<Self, String> {
        let file = CString::new(path).map_err(|_| "Invalid playback path")?;
        let mut error = [0i8; 1024];
        let handle = unsafe {
            rl_player_open(
                file.as_ptr(),
                width as c_int,
                height as c_int,
                error.as_mut_ptr(),
                error.len(),
            )
        };
        if handle.is_null() {
            return Err(unsafe { CStr::from_ptr(error.as_ptr()) }
                .to_string_lossy()
                .into());
        }
        let mut player = Self {
            handle,
            width,
            height,
            playing: false,
            seeking: None,
            ended: false,
            segments,
            rgba: Vec::new(),
            sequence: 0,
            frame_time: time,
            position: time,
            volume: -1.,
            error: None,
        };
        player.update_volume(time);
        player.seek(time)?;
        Ok(player)
    }
    pub fn play(&mut self, playing: bool) -> Result<(), String> {
        if unsafe { rl_player_play(self.handle, playing as c_int) } == 0 {
            return Err("Native player could not change playback state".into());
        }
        self.playing = playing;
        self.ended = false;
        Ok(())
    }
    pub fn seek(&mut self, time: f64) -> Result<(), String> {
        let time = self.kept(time).unwrap_or_else(|| {
            self.segments
                .last()
                .map_or(0., |s| (s.end - 0.001).max(s.start))
        });
        if unsafe { rl_player_seek(self.handle, time) } == 0 {
            return Err("Native player could not seek".into());
        }
        self.update_volume(time);
        self.seeking = Some(time);
        self.ended = false;
        Ok(())
    }
    fn kept(&self, time: f64) -> Option<f64> {
        for s in &self.segments {
            if time < s.start {
                return Some(s.start);
            }
            if time < s.end {
                return Some(time);
            }
        }
        None
    }
    fn update_volume(&mut self, time: f64) {
        let volume = self
            .segments
            .iter()
            .find(|segment| time >= segment.start && time < segment.end)
            .or_else(|| self.segments.iter().find(|segment| time < segment.start))
            .or_else(|| self.segments.last())
            .map_or(1., |segment| segment.volume);
        if (volume - self.volume).abs() > 0.001 {
            unsafe { rl_player_volume(self.handle, volume) };
            self.volume = volume;
        }
    }
    pub fn segments(&mut self, segments: Vec<Segment>) -> Result<(), String> {
        self.segments = segments;
        let time = unsafe { rl_player_position(self.handle) };
        if let Some(next) = self.kept(time) {
            if (next - time).abs() > 0.01 {
                self.seek(next)?;
            }
        } else {
            self.play(false)?;
            self.seek(time)?;
        }
        Ok(())
    }
    pub fn tick(&mut self) -> Result<(), String> {
        let mut error = [0i8; 1024];
        let status = unsafe { rl_player_status(self.handle, error.as_mut_ptr(), error.len()) };
        if status < 0 {
            return Err(unsafe { CStr::from_ptr(error.as_ptr()) }
                .to_string_lossy()
                .into());
        }
        if status == 1 {
            self.play(false)?;
            self.ended = true;
        }
        // During steady playback PTS is the media-clocked position we display
        // and use for segment boundaries. Avoid a synchronous pipeline query
        // on every 8 ms worker tick; retain it for paused/seeking state.
        let mut time = if self.playing && self.seeking.is_none() {
            self.position
        } else {
            unsafe { rl_player_position(self.handle) }
        };
        if self.playing && self.seeking.is_none() {
            match self.kept(time) {
                Some(next) if (next - time).abs() > 0.01 => {
                    self.seek(next)?;
                    time = next;
                }
                None => {
                    self.play(false)?;
                    self.ended = true;
                }
                _ => {}
            }
        }
        self.update_volume(time);
        let mut pts = 0.;
        let bytes = unsafe {
            rl_player_frame(
                self.handle,
                self.width as c_int,
                self.height as c_int,
                &mut pts,
            )
        };
        if !bytes.is_null() {
            if self
                .seeking
                .is_none_or(|target| (pts - target).abs() < 0.15)
            {
                let length = self.width as usize * self.height as usize * 4;
                self.rgba = unsafe { std::slice::from_raw_parts(bytes, length) }.to_vec();
                self.sequence = self.sequence.wrapping_add(1);
                self.frame_time = pts;
                time = pts;
                self.seeking = None;
            }
            unsafe { rl_frame_free(bytes) };
        }
        self.position = time;
        Ok(())
    }
    pub fn pump(&mut self) {
        if self.error.is_none() {
            if let Err(error) = self.tick() {
                let _ = self.play(false);
                self.error = Some(error);
            }
        }
    }

    pub fn frame(&self, last: u32) -> Result<Vec<u8>, String> {
        if let Some(error) = self.error.as_ref() {
            return Err(error.clone());
        }
        let time = self.position;
        let ready = self.seeking.is_none() && !self.rgba.is_empty();
        let changed = ready && last != self.sequence;
        let mut packet = Vec::with_capacity(32 + if changed { self.rgba.len() } else { 0 });
        packet.extend(self.width.to_le_bytes());
        packet.extend(self.height.to_le_bytes());
        packet.extend(self.sequence.to_le_bytes());
        let flags =
            u32::from(self.playing) | (u32::from(ready) << 1) | (u32::from(self.ended) << 2);
        packet.extend(flags.to_le_bytes());
        packet.extend(
            if ready {
                time.max(self.frame_time)
            } else {
                self.seeking.unwrap_or(time)
            }
            .to_le_bytes(),
        );
        packet.extend(self.frame_time.to_le_bytes());
        if changed {
            packet.extend_from_slice(&self.rgba);
        }
        Ok(packet)
    }
}
#[cfg(target_os = "linux")]
impl Drop for Player {
    fn drop(&mut self) {
        unsafe { rl_player_free(self.handle) };
    }
}
#[cfg(not(target_os = "linux"))]
impl Player {
    pub fn open(_: &str, _: u32, _: u32, _: f64, _: Vec<Segment>) -> Result<Self, String> {
        Err("Native playback packaging is currently available on Linux".into())
    }
    pub fn play(&mut self, _: bool) -> Result<(), String> {
        Err("Native playback unavailable".into())
    }
    pub fn seek(&mut self, _: f64) -> Result<(), String> {
        Err("Native playback unavailable".into())
    }
    pub fn segments(&mut self, _: Vec<Segment>) -> Result<(), String> {
        Err("Native playback unavailable".into())
    }
    pub fn pump(&mut self) {}
    pub fn tick(&mut self) -> Result<(), String> {
        Err("Native playback unavailable".into())
    }
    pub fn frame(&self, _: u32) -> Result<Vec<u8>, String> {
        Err("Native playback unavailable".into())
    }
}
