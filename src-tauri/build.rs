fn main() {
    #[cfg(feature = "desktop")]
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux") {
        use std::process::Command;
        let out = std::env::var("OUT_DIR").unwrap();
        let object = format!("{out}/player.o");
        let mut cc = Command::new("cc");
        cc.args(["-c", "-O2", "-fPIC", "native/player.c", "-o", &object]);
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
        // Link the stable runtime ABI directly. Ubuntu's runtime packages do
        // not install the unversioned linker names supplied by -dev packages.
        for library in [
            "libgstapp-1.0.so.0",
            "libgstreamer-1.0.so.0",
            "libgobject-2.0.so.0",
            "libglib-2.0.so.0",
        ] {
            println!("cargo:rustc-link-arg=-Wl,-l:{library}");
        }
        println!("cargo:rerun-if-changed=native/player.c");
    }
    #[cfg(feature = "desktop")]
    tauri_build::build();
}
