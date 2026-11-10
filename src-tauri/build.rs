fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&["app_fullscreen", "browser_tab", "set_reader_find_active"]),
        ),
    )
    .expect("Could not build Chinese Central desktop permissions");
}
