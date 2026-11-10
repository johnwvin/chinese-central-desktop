#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const PORT: u16 = 8821;
#[cfg(windows)]
mod browser;
#[cfg(windows)]
mod reader_find;
#[cfg(windows)]
mod windows_input;
#[cfg(windows)]
use windows_input::{toggle_windows_ime, windows_input_state};

#[tauri::command]
fn app_fullscreen(window: tauri::Window, action: String) -> Result<bool, String> {
    let current = window.is_fullscreen().map_err(|error| error.to_string())?;
    let next = match action.as_str() {
        "status" | "restore" => return Ok(current),
        "toggle" => !current,
        "exit" => false,
        _ => return Err("Unknown fullscreen action".into()),
    };
    window.set_fullscreen(next).map_err(|error| error.to_string())?;
    Ok(next)
}

fn server_ready() -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], PORT));
    let timeout = Duration::from_millis(200);
    let Ok(mut stream) = TcpStream::connect_timeout(&address, timeout) else { return false };
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let request = b"GET /api/central/edition HTTP/1.1\r\nHost: 127.0.0.1:8821\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() { return false; }
    let mut response = String::new();
    stream.take(4096).read_to_string(&mut response).is_ok()
        && response.split_once("\r\n\r\n").is_some_and(|(headers, body)| {
            headers.starts_with("HTTP/1.1 200 ") && body.trim() == "chinese-central-vanilla"
        })
}

fn backend_path() -> Option<PathBuf> {
    let executable = std::env::current_exe().ok()?;
    let folder = executable.parent()?;
    let sibling = folder.join("Chinese Central Vanilla Server.exe");
    if sibling.is_file() {
        return Some(sibling);
    }

    None
}

fn main() {
    let owned_server: Arc<Mutex<Option<Child>>> = Arc::new(Mutex::new(None));
    if !server_ready() {
        let backend = backend_path().expect("Chinese Central Vanilla Server.exe was not found beside the desktop app");
        let child = Command::new(backend)
            .args(["--port", "8821"])
            .spawn()
            .expect("Could not start the Chinese Central server");
        *owned_server.lock().unwrap() = Some(child);
        let until = Instant::now() + Duration::from_secs(15);
        while !server_ready() && Instant::now() < until {
            thread::sleep(Duration::from_millis(100));
        }
        assert!(server_ready(), "Chinese Central server did not start");
    }

    tauri::Builder::default()
        .manage(browser::BrowserSettings::default())
        .manage(reader_find::ReaderFind::default())
        .setup(|app| { reader_find::install(app)?; Ok(()) })
        .invoke_handler(tauri::generate_handler![
            app_fullscreen,
            windows_input_state, toggle_windows_ime, browser::browser_tab, reader_find::set_reader_find_active,
        ])
        .build(tauri::generate_context!())
        .expect("Could not build the desktop window")
        .run(move |_app, event| {
            match event {
                tauri::RunEvent::Exit => {
                    if let Some(mut child) = owned_server.lock().unwrap().take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                }
                _ => {}
            }
        });
}
