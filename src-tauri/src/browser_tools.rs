use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{Url, Webview};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{
    take_pwstr, CallDevToolsProtocolMethodCompletedHandler, ContextMenuRequestedEventHandler,
    CustomItemSelectedEventHandler, NavigationCompletedEventHandler,
};
use windows::core::{w, Interface, PCWSTR};
use windows::Win32::System::Com::IStream;

use super::{allowed, AdSettings};

type Rules = BTreeMap<String, Vec<String>>;
static FILE_LOCK: Mutex<()> = Mutex::new(());

fn read(path: &Path) -> Result<Rules, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| e.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Rules::new()),
        Err(error) => Err(error.to_string()),
    }
}

pub fn list(path: &Path, host: &str) -> Result<Vec<String>, String> {
    let _lock = FILE_LOCK.lock().map_err(|e| e.to_string())?;
    Ok(read(path)?.remove(host).unwrap_or_default())
}

pub fn change(path: &Path, host: &str, selector: &str, add: bool) -> Result<Vec<String>, String> {
    if selector.trim().is_empty() || selector.len() > 2048 {
        return Err("Invalid element filter.".into());
    }
    let _lock = FILE_LOCK.lock().map_err(|e| e.to_string())?;
    let mut saved = read(path)?;
    let rules = saved.entry(host.to_owned()).or_default();
    if add && !rules.iter().any(|rule| rule == selector) {
        if rules.len() >= 500 {
            return Err("This site already has 500 element filters.".into());
        }
        rules.push(selector.to_owned());
    } else if !add {
        rules.retain(|rule| rule != selector);
    }
    let result = rules.clone();
    if result.is_empty() {
        saved.remove(host);
    }
    let parent = path.parent().ok_or("Invalid element filter path.")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temporary = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(&saved).map_err(|e| e.to_string())?;
    fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())?;
    Ok(result)
}

fn current_host(browser: &ICoreWebView2) -> Option<String> {
    let mut address = Default::default();
    unsafe { browser.Source(&mut address).ok()? };
    let url = Url::parse(&take_pwstr(address)).ok()?;
    allowed(&url).then(|| url.host_str().unwrap().to_owned())
}

fn event(shell: &Webview, tab_id: u64, action: &str, value: &str) {
    let detail = serde_json::json!({ "tabId": tab_id, "action": action, "value": value });
    let _ = shell.eval(format!("window.dispatchEvent(new CustomEvent('cc-browser-action', {{detail: {detail}}}));"));
}

pub fn apply(browser: &ICoreWebView2, path: &Path, enabled: bool) {
    let Some(host) = current_host(browser) else { return };
    let rules = if enabled { list(path, &host).unwrap_or_default() } else { Vec::new() };
    let args = serde_json::json!([host, rules]);
    let script = format!(r#"(([host, selectors]) => {{
      if (location.hostname !== host) return;
      const previous = window.__ccElementStyles;
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter(sheet => sheet !== previous);
      if (!selectors.length) return;
      const sheet = new CSSStyleSheet();
      for (const selector of selectors) {{
        try {{
          document.querySelector(selector);
          sheet.insertRule(':is(' + selector + '):not(html,body,cc-element-picker) {{ display:none !important; }}');
        }} catch {{}}
      }}
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      window.__ccElementStyles = sheet;
    }})({args});"#);
    let wide: Vec<u16> = script.encode_utf16().chain([0]).collect();
    let _ = unsafe { browser.ExecuteScript(PCWSTR(wide.as_ptr()), None::<&ICoreWebView2ExecuteScriptCompletedHandler>) };
}

pub fn apply_for_site(browser: &ICoreWebView2, path: &Path, settings: &AdSettings) {
    let enabled = current_host(browser).is_some_and(|host| settings.blocks_on(&host));
    apply(browser, path, enabled);
}

pub fn pick(browser: &ICoreWebView2, path: std::path::PathBuf, settings: Arc<AdSettings>, shell: Webview, tab_id: u64) {
    let Some(host) = current_host(browser) else { return };
    if !settings.blocks_on(&host) { return; }
    let args = serde_json::json!({
        "expression": include_str!("browser-element-picker.js"),
        "awaitPromise": true,
        "returnByValue": true,
    }).to_string();
    let wide: Vec<u16> = args.encode_utf16().chain([0]).collect();
    let target = browser.clone();
    let result_shell = shell.clone();
    let done = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |status, result| {
        if status.is_err() || current_host(&target).as_deref() != Some(host.as_str()) {
            return Ok(());
        }
        let result: serde_json::Value = serde_json::from_str(&result).unwrap_or_default();
        if let Some(selector) = result["result"]["value"].as_str() {
            match change(&path, &host, selector, true) {
                Ok(_) => apply_for_site(&target, &path, &settings),
                Err(error) => event(&result_shell, tab_id, "error", &error),
            }
        }
        Ok(())
    }));
    if let Err(error) = unsafe { browser.CallDevToolsProtocolMethod(w!("Runtime.evaluate"), PCWSTR(wide.as_ptr()), &done) } {
        event(&shell, tab_id, "error", &error.to_string());
    }
}

pub unsafe fn install(
    browser: &ICoreWebView2,
    environment: &ICoreWebView2Environment,
    path: std::path::PathBuf,
    settings: Arc<AdSettings>,
    shell: Webview,
    tab_id: u64,
) -> windows::core::Result<()> {
    let mut token = 0;
    let navigation = NavigationCompletedEventHandler::create(Box::new(move |sender, _| {
        if let Some(browser) = sender {
            apply_for_site(&browser, &path, &settings);
        }
        Ok(())
    }));
    browser.add_NavigationCompleted(&navigation, &mut token)?;
    let (Ok(modern), Ok(factory)) = (browser.cast::<ICoreWebView2_11>(), environment.cast::<ICoreWebView2Environment9>()) else {
        return Ok(());
    };
    let menu = ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else { return Ok(()) };
        let items = args.MenuItems()?;
        let target = args.ContextMenuTarget()?;
        let mut count = 0;
        items.Count(&mut count)?;
        for index in (0..count).rev() {
            let mut name = Default::default();
            items.GetValueAtIndex(index)?.Name(&mut name)?;
            if take_pwstr(name) != "copy" {
                items.RemoveValueAtIndex(index)?;
            }
        }
        let append = |label: PCWSTR, action: &'static str, value: String| -> windows::core::Result<()> {
            let item = factory.CreateContextMenuItem(label, None::<&IStream>, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND)?;
            let shell = shell.clone();
            let selected = CustomItemSelectedEventHandler::create(Box::new(move |_, _| {
                event(&shell, tab_id, action, &value);
                Ok(())
            }));
            let mut token = 0;
            item.add_CustomItemSelected(&selected, &mut token)?;
            let mut end = 0;
            items.Count(&mut end)?;
            items.InsertValueAtIndex(end, &item)
        };
        let mut has_selection = Default::default();
        target.HasSelection(&mut has_selection)?;
        if has_selection.as_bool() {
            let mut selection = Default::default();
            target.SelectionText(&mut selection)?;
            let value: String = take_pwstr(selection).trim().chars().take(300).collect();
            if !value.is_empty() {
                append(w!("Define"), "define", value)?;
            }
        }
        let mut has_link = Default::default();
        let mut address = Default::default();
        target.HasLinkUri(&mut has_link)?;
        if has_link.as_bool() {
            target.LinkUri(&mut address)?;
        } else {
            target.PageUri(&mut address)?;
        }
        if let Ok(url) = Url::parse(&take_pwstr(address)) {
            if allowed(&url) {
                append(w!("Open in new browser tab"), "open", url.into())?;
            }
        }
        Ok(())
    }));
    modern.add_ContextMenuRequested(&menu, &mut token)
}
