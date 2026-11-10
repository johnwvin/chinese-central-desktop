//! Windows keyboard layouts and TSF input methods for the app bar.

use serde::Serialize;
use std::mem::size_of;
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize,
    CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, TreeScope_Descendants};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_SHIFT,
};

type Hwnd = isize;
type Hkl = isize;
type Bool = i32;

const GA_ROOT: u32 = 2;
const LOCALE_SLANGUAGE: u32 = 0x0002;

#[repr(C)]
#[derive(Default)]
struct Rect { left: i32, top: i32, right: i32, bottom: i32 }

#[repr(C)]
#[derive(Default)]
struct GuiThreadInfo {
    size: u32,
    flags: u32,
    active: Hwnd,
    focus: Hwnd,
    capture: Hwnd,
    menu_owner: Hwnd,
    move_size: Hwnd,
    caret: Hwnd,
    caret_rect: Rect,
}

#[link(name = "user32")]
extern "system" {
    fn GetForegroundWindow() -> Hwnd;
    fn FindWindowW(class_name: *const u16, window_name: *const u16) -> Hwnd;
    fn GetAncestor(hwnd: Hwnd, flags: u32) -> Hwnd;
    fn GetWindowThreadProcessId(hwnd: Hwnd, process_id: *mut u32) -> u32;
    fn GetGUIThreadInfo(thread_id: u32, info: *mut GuiThreadInfo) -> Bool;
    fn GetKeyboardLayout(thread_id: u32) -> Hkl;
}

#[link(name = "kernel32")]
extern "system" {
    fn GetLocaleInfoW(locale: u32, field: u32, buffer: *mut u16, buffer_size: i32) -> i32;
    fn CallNamedPipeW(name: *const u16, request: *const u8, request_size: u32,
        response: *mut u8, response_size: u32, bytes_read: *mut u32, timeout: u32) -> Bool;
}

#[link(name = "imm32")]
extern "system" {
    fn ImmGetDescriptionW(layout: Hkl, buffer: *mut u16, buffer_size: u32) -> u32;
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputLayout {
    id: String,
    name: String,
    short: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputState {
    layout: String,
    short: String,
    mode: Option<&'static str>,
    mode_control: bool,
    method: &'static str,
    name: String,
}

fn window_handle(window: &tauri::Window) -> Result<Hwnd, String> {
    window.hwnd().map(|handle| handle.0 as Hwnd).map_err(|error| error.to_string())
}

fn focused_window(window: &tauri::Window) -> Result<Hwnd, String> {
    let root = window_handle(window)?;
    unsafe {
        let foreground = GetForegroundWindow();
        if foreground != 0 && GetAncestor(foreground, GA_ROOT) == root {
            let mut info = GuiThreadInfo { size: size_of::<GuiThreadInfo>() as u32, ..Default::default() };
            if GetGUIThreadInfo(0, &mut info) != 0 && info.focus != 0
                && GetAncestor(info.focus, GA_ROOT) == root {
                return Ok(info.focus);
            }
        }
        let thread = GetWindowThreadProcessId(root, std::ptr::null_mut());
        let mut info = GuiThreadInfo { size: size_of::<GuiThreadInfo>() as u32, ..Default::default() };
        if thread != 0 && GetGUIThreadInfo(thread, &mut info) != 0 && info.focus != 0 {
            return Ok(info.focus);
        }
    }
    Ok(root)
}

fn active_layout(hwnd: Hwnd) -> Hkl {
    unsafe { GetKeyboardLayout(GetWindowThreadProcessId(hwnd, std::ptr::null_mut())) }
}

fn language_name(layout: Hkl) -> String {
    let mut buffer = [0u16; 128];
    let count = unsafe { GetLocaleInfoW((layout as u32) & 0xffff, LOCALE_SLANGUAGE, buffer.as_mut_ptr(), buffer.len() as i32) };
    if count > 1 { String::from_utf16_lossy(&buffer[..count as usize - 1]) }
    else { format!("Input {:04X}", (layout as u32) & 0xffff) }
}

fn ime_description(layout: Hkl) -> String {
    let mut buffer = [0u16; 128];
    let count = unsafe { ImmGetDescriptionW(layout, buffer.as_mut_ptr(), buffer.len() as u32) };
    String::from_utf16_lossy(&buffer[..count as usize])
}

fn layout_info(layout: Hkl) -> InputLayout {
    let lang = (layout as u32) & 0xffff;
    let language = language_name(layout);
    let ime = ime_description(layout);
    let short = if lang == 0x0804 && (ime.to_lowercase().contains("pinyin") || ime.contains("拼音")) {
        "拼".to_string()
    } else if lang == 0x0804 {
        "中".to_string()
    } else if (lang & 0x03ff) == 0x0009 {
        "ENG".to_string()
    } else {
        language.chars().take(3).collect::<String>().to_uppercase()
    };
    InputLayout {
        id: format!("{:016X}", layout as usize),
        name: if ime.is_empty() { language } else { format!("{language} · {ime}") },
        short,
    }
}

fn taskbar_input() -> Option<(String, &'static str, Option<&'static str>)> {
    // The Windows language bar reflects the active TSF mode. IMM state can
    // change without changing Microsoft Pinyin's actual typing mode.
    let tray_class: Vec<u16> = "Shell_TrayWnd\0".encode_utf16().collect();
    let tray = unsafe { FindWindowW(tray_class.as_ptr(), std::ptr::null()) };
    if tray == 0 { return None; }
    unsafe {
        let apartment = CoInitializeEx(None, COINIT_MULTITHREADED);
        // The command may run on a thread that Tauri already initialized as
        // an STA. COM remains usable there; only uninitialize our own call.
        let initialized = apartment.is_ok();
        if !initialized && apartment.0 != 0x80010106u32 as i32 { return None; }
        let result = (|| {
            let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok()?;
            let taskbar = automation.ElementFromHandle(HWND(tray as *mut std::ffi::c_void)).ok()?;
            let all = automation.CreateTrueCondition().ok()?;
            let elements = taskbar.FindAll(TreeScope_Descendants, &all).ok()?;
            let mut method = "other";
            let mut name = String::new();
            let mut mode = None;
            for index in 0..elements.Length().ok()? {
                let Ok(element) = elements.GetElement(index) else { continue };
                let Ok(label) = element.CurrentName() else { continue };
                let label = label.to_string();
                if !label.starts_with("Tray Input Indicator") { continue; }
                let lower = label.to_lowercase();
                if lower.contains("english mode") { mode = Some("english"); }
                else if lower.contains("chinese mode") { mode = Some("chinese"); }
                else {
                    if lower.contains("microsoft pinyin") { method = "microsoft_pinyin"; }
                    else if lower.contains("weasel") || label.contains("小狼毫") { method = "weasel"; }
                    name = label.trim_start_matches("Tray Input Indicator").trim()
                        .split("\r\n\r\n").next().unwrap_or("").replace("\r\n", " · ");
                }
            }
            if name.is_empty() { None } else { Some((name, method, mode)) }
        })();
        if initialized { CoUninitialize(); }
        result
    }
}

fn weasel_ime_mode() -> Option<&'static str> {
    let user = std::env::var("USERNAME").ok()?;
    let name: Vec<u16> = format!(r"\\.\pipe\{user}\WeaselNamedPipe")
        .encode_utf16().chain(std::iter::once(0)).collect();
    // Matches WEASEL_IPC_GET_ASCII_MODE (WM_APP + 17). An older server
    // returns zero without changing its state.
    let request = [0x8011_u32, 0, 0];
    let mut response = 0_u32;
    let mut read = 0_u32;
    let result = unsafe { CallNamedPipeW(name.as_ptr(), request.as_ptr().cast(),
        size_of::<[u32; 3]>() as u32, (&mut response as *mut u32).cast(),
        size_of::<u32>() as u32, &mut read, 250) };
    if result == 0 || read != size_of::<u32>() as u32 { return None; }
    match response { 1 => Some("chinese"), 2 => Some("english"), _ => None }
}

#[tauri::command]
pub fn windows_input_state(window: tauri::Window) -> Result<InputState, String> {
    let hwnd = focused_window(&window)?;
    let layout = active_layout(hwnd);
    let mut current = layout_info(layout);
    let (name, method, reported_mode) = taskbar_input()
        .unwrap_or_else(|| (current.name.clone(), "other", None));
    current.short = match method {
        "weasel" => "Weasel".into(),
        "microsoft_pinyin" => "拼".into(),
        _ => current.short,
    };
    let mode = if method == "weasel" { weasel_ime_mode() } else { reported_mode };
    Ok(InputState { layout: current.id, short: current.short, name,
        mode, mode_control: method != "other", method })
}

#[tauri::command]
pub fn toggle_windows_ime(window: tauri::Window) -> Result<(), String> {
    if !taskbar_input().is_some_and(|(_, method, _)| method != "other") {
        return Err("Select Microsoft Pinyin or Weasel first".into());
    }
    let hwnd = focused_window(&window)?;
    if ((active_layout(hwnd) as u32) & 0x03ff) != 0x0004 {
        return Err("Select a Chinese input method first".into());
    }
    // Both Microsoft Pinyin and the installed Weasel scheme switch their
    // Chinese/English input mode with Shift. IMM calls can report success
    // while the active text service ignores the requested change.
    let key = |flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT {
            wVk: VK_SHIFT, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0,
        } },
    };
    let keys = [key(0), key(KEYEVENTF_KEYUP)];
    if unsafe { SendInput(keys.len() as u32, keys.as_ptr(), size_of::<INPUT>() as i32) } != keys.len() as u32 {
        return Err("Windows did not receive the input-mode shortcut".into());
    }
    Ok(())
}
