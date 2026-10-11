fn main() {
    #[cfg(feature = "desktop")]
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        use std::process::Command;
        let out = std::env::var("OUT_DIR").unwrap();
        let flags = Command::new("pkg-config")
            .args(["--cflags", "gstreamer-1.0"])
            .output()
            .expect("GStreamer development headers are required");
        assert!(
            flags.status.success(),
            "GStreamer development headers are required"
        );
        let object = format!("{out}/player.o");
        let mut cc = Command::new("cc");
        cc.args(["-c", "-O2", "-fPIC", "native/player.c", "-o", &object]);
        cc.args(String::from_utf8(flags.stdout).unwrap().split_whitespace());
        assert!(
            cc.status().unwrap().success(),
            "Cannot compile native playback bridge"
        );
        assert!(Command::new("ar")
            .args(["crs", &format!("{out}/librlcut_player.a"), &object])
            .status()
            .unwrap()
            .success());
        println!("cargo:rustc-link-search=native={out}");
        println!("cargo:rustc-link-lib=static=rlcut_player");
        // Ubuntu's runtime package provides the versioned appsink library.
        println!("cargo:rustc-link-arg=-Wl,-l:libgstapp-1.0.so.0");
        for library in ["gstreamer-1.0", "gobject-2.0", "glib-2.0"] {
            println!("cargo:rustc-link-lib={library}");
        }
        println!("cargo:rerun-if-changed=native/player.c");
    }
    #[cfg(feature = "desktop")]
    tauri_build::build();
}
