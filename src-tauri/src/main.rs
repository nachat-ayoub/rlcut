#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    #[cfg(target_os = "linux")]
    {
        // Prefer a predictable CPU decoder for the small editor proxy. Hardware
        // video decoding in WebKit can fail on school PC graphics drivers.
        if std::env::var_os("GST_PLUGIN_FEATURE_RANK").is_none() {
            std::env::set_var(
                "GST_PLUGIN_FEATURE_RANK",
                "avdec_h264:512,vaapih264dec:0,vah264dec:0,nvh264dec:0",
            );
        }
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
    #[cfg(target_os = "linux")]
    if let Some(appdir) = std::env::var_os("APPDIR") {
        let root = std::path::PathBuf::from(appdir);
        // The media pipeline must not mix host plugins with bundled libraries.
        std::env::set_var("GST_PLUGIN_PATH_1_0", "");
        std::env::set_var("GST_PLUGIN_PATH", "");
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
