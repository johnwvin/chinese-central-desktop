use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{App, Manager, Webview};
use webview2_com::Microsoft::Web::WebView2::Win32::{
    COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
};
use webview2_com::AcceleratorKeyPressedEventHandler;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT};

#[derive(Default)]
pub struct ReaderFind(Arc<AtomicBool>);

#[tauri::command]
pub fn set_reader_find_active(webview: Webview, state: tauri::State<'_, ReaderFind>, active: bool) {
    if webview.label() == "main" {
        state.0.store(active, Ordering::Relaxed);
    }
}

pub fn install(app: &App) -> tauri::Result<()> {
    let Some(shell) = app.get_webview("main") else { return Ok(()) };
    let active = app.state::<ReaderFind>().0.clone();
    let target = shell.clone();
    shell.with_webview(move |platform| unsafe {
        let handler = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            if !active.load(Ordering::Relaxed) {
                return Ok(());
            }
            let mut key = 0;
            let mut kind = Default::default();
            args.VirtualKey(&mut key)?;
            args.KeyEventKind(&mut kind)?;
            if key == u32::from(b'F')
                && (kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN || kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN)
                && GetKeyState(VK_CONTROL.into()) < 0
                && [VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN].into_iter().all(|modifier| GetKeyState(modifier.into()) >= 0)
            {
                args.SetHandled(true)?;
                let shell = target.clone();
                let _ = target.run_on_main_thread(move || {
                    let _ = shell.eval("window.dispatchEvent(new Event('cc-desktop-reader-find'))");
                });
            }
            Ok(())
        }));
        let mut token = 0;
        if let Err(error) = platform.controller().add_AcceleratorKeyPressed(&handler, &mut token) {
            eprintln!("Could not register reader Find: {error}");
        }
    })
}
