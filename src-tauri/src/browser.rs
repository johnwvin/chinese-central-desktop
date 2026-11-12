use serde::Deserialize;
use std::collections::HashSet;
use std::net::IpAddr;
use std::sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc, Mutex, OnceLock, RwLock};
use std::time::Duration;
use tauri::webview::{NewWindowResponse, WebviewBuilder};
use tauri::{LogicalPosition, LogicalSize, Manager, Rect, Url, Webview, WebviewUrl};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{
    take_pwstr, AcceleratorKeyPressedEventHandler, DocumentTitleChangedEventHandler, HistoryChangedEventHandler,
    NavigationStartingEventHandler, SourceChangedEventHandler, WebResourceRequestedEventHandler,
};
use windows::core::{w, Interface};
use windows::Win32::System::Com::IStream;
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL};

#[path = "browser_tools.rs"]
mod tools;

const GOOGLE: &str = "https://www.google.com/";

#[derive(Deserialize)]
pub struct Bounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

struct AdSettings {
    enabled: AtomicBool,
    whitelist: RwLock<HashSet<String>>,
}

impl AdSettings {
    fn blocks_on(&self, host: &str) -> bool {
        self.enabled.load(Ordering::Relaxed)
            && !self.whitelist.read().is_ok_and(|sites| sites.contains(host.trim_end_matches('.')))
    }
}

pub struct BrowserSettings(Arc<AdSettings>);

impl Default for BrowserSettings {
    fn default() -> Self {
        Self(Arc::new(AdSettings {
            enabled: AtomicBool::new(true),
            whitelist: RwLock::new(HashSet::new()),
        }))
    }
}

fn local_host(url: &Url) -> bool {
    let Some(host) = url.host_str() else { return false };
    let host = host.trim_matches(['[', ']']).trim_end_matches('.');
    host == "localhost" || host.ends_with(".localhost") || match host.parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip.is_loopback() || ip.is_unspecified(),
        Ok(IpAddr::V6(ip)) => ip.is_loopback() || ip.is_unspecified()
            || ip.to_ipv4_mapped().is_some_and(|ip| ip.is_loopback() || ip.is_unspecified()),
        Err(_) => false,
    }
}

fn allowed(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && url.host_str().is_some() && !local_host(url)
}

struct AdRules {
    blocked: HashSet<&'static str>,
    allowed: HashSet<&'static str>,
}

fn ad_host(host: &str) -> bool {
    static RULES: OnceLock<AdRules> = OnceLock::new();
    let rules = RULES.get_or_init(|| {
        let mut rules = AdRules { blocked: HashSet::new(), allowed: HashSet::new() };
        for line in include_str!("browser-ad-domains.txt").lines() {
            if line.is_empty() || line.starts_with('#') { continue; }
            if let Some(exception) = line.strip_prefix("@@") {
                rules.allowed.insert(exception);
            } else {
                rules.blocked.insert(line);
            }
        }
        rules
    });
    let mut domain = host.trim_end_matches('.');
    let mut blocked = false;
    loop {
        if rules.allowed.contains(domain) { return false; }
        blocked |= rules.blocked.contains(domain);
        let Some((_, suffix)) = domain.split_once('.') else { return blocked };
        domain = suffix;
    }
}

fn report_location(shell: &Webview, tab_id: u64, browser: &ICoreWebView2) {
    let mut back = Default::default();
    let mut forward = Default::default();
    let mut source = Default::default();
    let url = unsafe {
        let _ = browser.CanGoBack(&mut back);
        let _ = browser.CanGoForward(&mut forward);
        if browser.Source(&mut source).is_ok() { take_pwstr(source) } else { String::new() }
    };
    let mut title = Default::default();
    let title = unsafe {
        if browser.DocumentTitle(&mut title).is_ok() { take_pwstr(title) } else { String::new() }
    };
    let detail = serde_json::json!({ "tabId": tab_id, "back": back.as_bool(), "forward": forward.as_bool(), "url": url, "title": title });
    let _ = shell.eval(format!("window.dispatchEvent(new CustomEvent('cc-browser-location', {{detail: {detail}}}));"));
}

fn configure(view: &Webview, shell: Webview, tab_id: u64, settings: Arc<AdSettings>, rule_path: std::path::PathBuf) -> Result<(), String> {
    let (send, receive) = mpsc::sync_channel(1);
    view.with_webview(move |platform| {
        let result = (|| -> windows::core::Result<()> {
            let controller = platform.controller();
            let environment = platform.environment();
            unsafe {
                let browser = controller.CoreWebView2()?;
                browser.Settings()?.SetIsWebMessageEnabled(false)?;
                tools::install(&browser, &environment, rule_path, settings.clone(), shell.clone(), tab_id)?;
                if let Ok(modern) = browser.cast::<ICoreWebView2_22>() {
                    modern.AddWebResourceRequestedFilterWithRequestSourceKinds(
                        w!("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                    )?;
                } else {
                    browser.AddWebResourceRequestedFilter(w!("*"), COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?;
                }
                let mut token = 0;
                let page_host = Arc::new(Mutex::new(String::new()));
                let navigating = page_host.clone();
                let navigation = NavigationStartingEventHandler::create(Box::new(move |_, args| {
                    if let Some(args) = args {
                        let mut uri = Default::default();
                        args.Uri(&mut uri)?;
                        if let Ok(mut host) = navigating.lock() {
                            *host = Url::parse(&take_pwstr(uri)).ok()
                                .and_then(|url| url.host_str().map(str::to_owned)).unwrap_or_default();
                        }
                    }
                    Ok(())
                }));
                browser.add_NavigationStarting(&navigation, &mut token)?;
                let requests = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut uri = Default::default();
                    args.Request()?.Uri(&mut uri)?;
                    let Ok(url) = Url::parse(&take_pwstr(uri)) else { return Ok(()) };
                    let block_ads = page_host.lock().is_ok_and(|host| settings.blocks_on(&host));
                    let blocked = local_host(&url) || (block_ads && url.host_str().is_some_and(ad_host));
                    if blocked {
                        let response = environment.CreateWebResourceResponse(
                            None::<&IStream>, 403, w!("Blocked"), w!("Content-Type: text/plain"),
                        )?;
                        args.SetResponse(&response)?;
                    }
                    Ok(())
                }));
                browser.add_WebResourceRequested(&requests, &mut token)?;

                let history_shell = shell.clone();
                let history = HistoryChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(browser) = sender { report_location(&history_shell, tab_id, &browser); }
                    Ok(())
                }));
                browser.add_HistoryChanged(&history, &mut token)?;
                let location_shell = shell.clone();
                let source = SourceChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(browser) = sender { report_location(&location_shell, tab_id, &browser); }
                    Ok(())
                }));
                browser.add_SourceChanged(&source, &mut token)?;

                let title_shell = shell.clone();
                let title = DocumentTitleChangedEventHandler::create(Box::new(move |sender, _| {
                    if let Some(browser) = sender { report_location(&title_shell, tab_id, &browser); }
                    Ok(())
                }));
                browser.add_DocumentTitleChanged(&title, &mut token)?;

                let keys = AcceleratorKeyPressedEventHandler::create(Box::new(move |_, args| {
                    let Some(args) = args else { return Ok(()) };
                    let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
                    let mut key = 0;
                    args.KeyEventKind(&mut kind)?;
                    args.VirtualKey(&mut key)?;
                    if kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN && key == u32::from(b'W') && GetKeyState(VK_CONTROL.into()) < 0 {
                        args.SetHandled(true)?;
                        let _ = shell.eval(format!("window.dispatchEvent(new CustomEvent('cc-browser-close', {{detail: {tab_id}}}));"));
                    }
                    Ok(())
                }));
                controller.add_AcceleratorKeyPressed(&keys, &mut token)?;
            }
            Ok(())
        })();
        let _ = send.send(result.map_err(|error| error.to_string()));
    }).map_err(|error| error.to_string())?;
    receive.recv_timeout(Duration::from_secs(5)).map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn browser_tab(
    webview: Webview,
    settings: tauri::State<'_, BrowserSettings>,
    tab_id: u64,
    action: String,
    bounds: Option<Bounds>,
    url: Option<String>,
    block_ads: Option<bool>,
    ad_whitelist: Option<Vec<String>>,
    selector: Option<String>,
) -> Result<Option<Vec<String>>, String> {
    if webview.label() != "main" {
        return Err("Only the main window can control browser tabs.".into());
    }
    let app = webview.app_handle();
    let label = format!("browser-{tab_id}");
    let existing = app.get_webview(&label);
    if let Some(enabled) = block_ads {
        settings.0.enabled.store(enabled, Ordering::Relaxed);
    }
    if let Some(hosts) = ad_whitelist {
        *settings.0.whitelist.write().map_err(|error| error.to_string())? = hosts.into_iter().collect();
    }
    let rule_path = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("browser-element-filters.json");

    if action == "place" {
        let Some(bounds) = bounds else {
            return existing.map_or(Ok(()), |view| view.hide()).map(|_| None).map_err(|e| e.to_string());
        };
        if ![bounds.x, bounds.y, bounds.width, bounds.height].into_iter().all(f64::is_finite)
            || bounds.width <= 0.0 || bounds.height <= 0.0 {
            return Err("Invalid browser tab size.".into());
        }
        let position = LogicalPosition::new(bounds.x, bounds.y);
        let size = LogicalSize::new(bounds.width, bounds.height);
        if let Some(view) = existing {
            view.set_bounds(Rect { position: position.into(), size: size.into() }).map_err(|e| e.to_string())?;
            return view.show().map(|_| None).map_err(|e| e.to_string());
        }

        let popup_app = app.clone();
        let popup_label = label.clone();
        let start = Url::parse(url.as_deref().unwrap_or(GOOGLE)).map_err(|e| e.to_string())?;
        if !allowed(&start) { return Err("Enter a public HTTP or HTTPS address.".into()); }
        let builder = WebviewBuilder::new(label, WebviewUrl::External(Url::parse("about:blank").unwrap()))
            .focused(false)
            .devtools(false)
            .disable_drag_drop_handler()
            .data_directory(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("browser-webview"))
            .on_navigation(|url| url.as_str() == "about:blank" || allowed(url))
            .on_new_window(move |url, _| {
                if allowed(&url) {
                    if let Some(view) = popup_app.get_webview(&popup_label) {
                        let _ = view.navigate(url);
                    }
                }
                NewWindowResponse::Deny
            });
        let view = webview.window().add_child(builder, position, size).map_err(|e| e.to_string())?;
        if let Err(error) = configure(&view, webview, tab_id, settings.0.clone(), rule_path) {
            let _ = view.close();
            return Err(error);
        }
        // Start navigation only after the request filters and history handlers are installed.
        return view.navigate(start).map(|_| None).map_err(|e| e.to_string());
    }

    let Some(view) = existing else { return Ok(None) };
    if action == "list-element-rules" || action == "remove-element-rule" {
        let address = view.url().map_err(|e| e.to_string())?;
        if !allowed(&address) { return Ok(Some(Vec::new())); }
        let host = address.host_str().unwrap();
        if action == "list-element-rules" {
            return tools::list(&rule_path, host).map(Some);
        }
        let rules = tools::change(&rule_path, host, selector.as_deref().unwrap_or_default(), false)?;
        let enabled = settings.0.blocks_on(host);
        view.with_webview(move |platform| unsafe {
            if let Ok(browser) = platform.controller().CoreWebView2() {
                tools::apply(&browser, &rule_path, enabled);
            }
        }).map_err(|e| e.to_string())?;
        return Ok(Some(rules));
    }
    let ad_settings = settings.0.clone();
    match action.as_str() {
        "close" => view.close(),
        "reload" => view.reload(),
        "home" => view.navigate(Url::parse(GOOGLE).unwrap()),
        "pick-element" | "refresh-element-rules" => view.with_webview(move |platform| unsafe {
            if let Ok(browser) = platform.controller().CoreWebView2() {
                if action == "pick-element" {
                    tools::pick(&browser, rule_path, ad_settings, webview, tab_id);
                } else {
                    tools::apply_for_site(&browser, &rule_path, &ad_settings);
                }
            }
        }),
        "navigate" => {
            let url = Url::parse(url.as_deref().unwrap_or_default()).map_err(|e| e.to_string())?;
            if !allowed(&url) { return Err("Enter a public HTTP or HTTPS address.".into()); }
            view.navigate(url)
        }
        "back" | "forward" => view.with_webview(move |platform| unsafe {
            if let Ok(browser) = platform.controller().CoreWebView2() {
                if action == "back" { let _ = browser.GoBack(); }
                else { let _ = browser.GoForward(); }
            }
        }),
        _ => return Err("Unknown browser action.".into()),
    }.map(|_| None).map_err(|e| e.to_string())
}
