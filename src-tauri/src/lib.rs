#[cfg(feature = "desktop")]
mod commands;
pub mod model;
#[cfg(feature = "serialization")]
pub mod presets;
#[cfg(feature = "serialization")]
pub mod settings;
pub mod video;
#[cfg(feature = "desktop")]
pub fn run() {
    use tauri::Manager;
    tauri::Builder::default()
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            let cache = app.path().app_cache_dir()?.join("previews");
            let resource = app.path().resource_dir()?;
            app.manage(commands::AppState::new(
                settings::data_file(data),
                cache,
                video::binaries::Binaries::detect(&resource),
            ));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::initialize,
            commands::save_store,
            commands::pick_video,
            commands::pick_music,
            commands::import_music_path,
            commands::search_youtube,
            commands::youtube_audio_preview,
            commands::music_waveform,
            commands::pick_folder,
            commands::project_thumbnails,
            commands::list_system_fonts,
            commands::load_font_bytes,
            commands::save_google_font,
            commands::save_text_stamp,
            commands::import_video,
            commands::create_proxy,
            commands::create_timeline_proxy,
            commands::preparation_progress,
            commands::cancel_preparation,
            commands::playback_open,
            commands::playback_control,
            commands::playback_frame,
            commands::playback_close,
            commands::clear_cache,
            commands::clear_ai_cache,
            commands::start_export,
            commands::export_progress,
            commands::cancel_export,
            commands::open_export,
            commands::import_preset,
            commands::export_preset,
            commands::import_project,
            commands::export_project
        ])
        .build(tauri::generate_context!())
        .expect("Unable to build rlcut")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                let state = app.state::<commands::AppState>();
                state.shutdown();
            }
        });
}
