#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    #[cfg(target_os = "linux")]
    if let Some(appdir) = std::env::var_os("APPDIR") {
        let root = std::path::PathBuf::from(appdir);
        std::env::set_var(
            "GST_PLUGIN_SYSTEM_PATH_1_0",
            root.join("usr/lib/x86_64-linux-gnu/gstreamer-1.0"),
        );
        std::env::set_var(
            "GST_PLUGIN_SCANNER_1_0",
            root.join("usr/lib/x86_64-linux-gnu/gstreamer1.0/gstreamer-1.0/gst-plugin-scanner"),
        );
        std::env::set_var(
            "GST_REGISTRY_1_0",
            std::env::temp_dir().join(format!("rlcut-gstreamer-{}.bin", std::process::id())),
        );
    }
    rlcut_lib::run()
}
