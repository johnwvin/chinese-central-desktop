import { useEffect, useRef, useState, type CSSProperties } from "react";
import { desktopInvoke } from "./desktop";
import { BOOKMARKS_CHANGED, BrowserBookmarks, bookmarkDetails, bookmarkPage, canBookmark, hasBookmark } from "./BrowserBookmarks";
import { AdBlockDialog, BookmarkDialog } from "./BrowserDialogs";
import { ActionIcon } from "../ui/ActionIcon";

const GOOGLE = "https://www.google.com/";
const AD_BLOCK_KEY = "cc-browser-ad-blocking";
const BLOCK_CHANGE = "cc-browser-blocking";
const OVERLAYS = "#menu.open, .tabmenu, .volpop, .ccd-scrim";

interface LocationState {
  tabId: number;
  url: string;
  back: boolean;
  forward: boolean;
  title?: string;
}

export const browserLocations = new Map<number, LocationState>();
let commands: Promise<unknown> = Promise.resolve();

export function browserCommand<T = void>(tabId: number, action: string, options: Record<string, unknown> = {}) {
  const command = commands.then(() => desktopInvoke<T>("browser_tab", { tabId, action, ...options }));
  commands = command.catch(() => {});
  return command;
}

function destination(input: string): URL {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(input)) return new URL(input);
  if (/^[^\s/:]+\.[^\s/:]+(?::\d+)?(?:[/?#].*)?$/.test(input)) return new URL(`https://${input}`);
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", input);
  return url;
}

export function BrowserPane({ tabId, shown, style, onClose, initialUrl, onLocationChange, onDefine, onOpenTab }: {
  tabId: number;
  shown: boolean;
  style: CSSProperties;
  onClose: () => void;
  initialUrl?: string;
  onLocationChange: (url: string, title: string) => void;
  onDefine: (text: string) => void;
  onOpenTab: (url: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const placement = useRef("");
  const [retry, setRetry] = useState(0);
  const [location, setLocation] = useState<LocationState>({ tabId, url: initialUrl ?? GOOGLE, back: false, forward: false });
  const locationCallback = useRef(onLocationChange);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [bookmark, setBookmark] = useState<{ url: string; title: string } & ReturnType<typeof bookmarkDetails> | null>(null);
  const [rules, setRules] = useState<string[] | null>(null);
  const [bookmarked, setBookmarked] = useState(() => hasBookmark(location.url));
  const [blockAds, setBlockAds] = useState(() => localStorage.getItem(AD_BLOCK_KEY) !== "false");

  useEffect(() => { locationCallback.current = onLocationChange; }, [onLocationChange]);

  useEffect(() => {
    const update = () => setBookmarked(hasBookmark(location.url));
    update();
    window.addEventListener(BOOKMARKS_CHANGED, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(BOOKMARKS_CHANGED, update);
      window.removeEventListener("storage", update);
    };
  }, [location.url]);

  useEffect(() => {
    const changed = (event: Event) => {
      const next = (event as CustomEvent<LocationState>).detail;
      if (next.tabId !== tabId || !/^https?:\/\//.test(next.url)) return;
      browserLocations.set(tabId, next);
      setLocation(next);
      locationCallback.current(next.url, next.title ?? "");
    };
    const blockChanged = () => {
      const enabled = localStorage.getItem(AD_BLOCK_KEY) !== "false";
      setBlockAds(enabled);
      void browserCommand(tabId, "refresh-element-rules", { blockAds: enabled }).catch(() => {});
    };
    window.addEventListener("cc-browser-location", changed);
    window.addEventListener(BLOCK_CHANGE, blockChanged);
    return () => {
      window.removeEventListener("cc-browser-location", changed);
      window.removeEventListener(BLOCK_CHANGE, blockChanged);
      browserLocations.delete(tabId);
      void browserCommand(tabId, "close").catch(() => {});
    };
  }, [tabId]);

  useEffect(() => {
    const close = (event: Event) => {
      if ((event as CustomEvent<number>).detail === tabId) onClose();
    };
    window.addEventListener("cc-browser-close", close);
    return () => window.removeEventListener("cc-browser-close", close);
  }, [tabId, onClose]);

  useEffect(() => {
    const action = (event: Event) => {
      const detail = (event as CustomEvent<{ tabId: number; action: string; value: string }>).detail;
      if (detail.tabId !== tabId || !shown) return;
      if (detail.action === "define") onDefine(detail.value);
      else if (detail.action === "open" && canBookmark(detail.value)) onOpenTab(detail.value);
      else if (detail.action === "error") setError(detail.value);
    };
    window.addEventListener("cc-browser-action", action);
    return () => window.removeEventListener("cc-browser-action", action);
  }, [tabId, shown, onDefine, onOpenTab]);

  useEffect(() => {
    let alive = true;
    let frame = 0;
    const position = () => {
      const rect = host.current?.getBoundingClientRect();
      const covered = document.querySelector(OVERLAYS);
      const bounds = shown && !covered && rect && rect.width > 1 && rect.height > 1
        ? { x: rect.left, y: rect.top, width: rect.width, height: rect.height } : null;
      const key = JSON.stringify(bounds);
      if (key === placement.current) return;
      placement.current = key;
      void browserCommand(tabId, "place", { bounds, url: initialUrl, blockAds: localStorage.getItem(AD_BLOCK_KEY) !== "false" })
        .catch((cause) => { if (alive) setError(String(cause)); });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    const resize = new ResizeObserver(schedule);
    if (host.current) resize.observe(host.current);
    const overlays = new MutationObserver(schedule);
    const strip = document.getElementById("strip");
    if (shown && strip) overlays.observe(strip, { childList: true, subtree: true });
    if (shown) overlays.observe(document.body, { childList: true });
    overlays.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      resize.disconnect();
      overlays.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [tabId, shown, retry, style.left, initialUrl]);

  const run = (action: string, options: Record<string, unknown> = {}) => {
    setError("");
    if (action === "back" || action === "forward" || action === "home") setDraft(null);
    void browserCommand(tabId, action, options).catch((cause) => setError(String(cause)));
  };

  return <section className="pane browser-pane" style={style} aria-label="Browser">
    <form className="browser-toolbar" onSubmit={(event) => {
      event.preventDefault();
      const input = (draft ?? location.url).trim();
      if (!input) return;
      try {
        run("navigate", { url: destination(input).href });
        setDraft(null);
      } catch {
        setError("Enter a valid address or search term.");
      }
    }}>
      <button type="button" title="Back" aria-label="Back" disabled={!location.back} onClick={() => run("back")}><ActionIcon name="back" /></button>
      <button type="button" title="Forward" aria-label="Forward" disabled={!location.forward} onClick={() => run("forward")}><ActionIcon name="forward" /></button>
      <button type="button" title="Reload" aria-label="Reload" onClick={() => run("reload")}><ActionIcon name="reload" /></button>
      <button type="button" title="Google home" aria-label="Home" onClick={() => run("home")}><ActionIcon name="home" /></button>
      <input type="text" aria-label="Address or search Google"
        spellCheck={false} autoComplete="off" value={draft ?? location.url}
        onFocus={(event) => event.currentTarget.select()} onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Escape") setDraft(null); }} />
      <button type="button" className="browser-bookmark-star" data-saved={bookmarked}
        disabled={!canBookmark(location.url)} title={bookmarked ? "Page bookmarked" : "Bookmark this page"}
        aria-label={bookmarked ? "Page bookmarked" : "Bookmark this page"} onClick={() => {
          try { setBookmark({ url: location.url, title: location.title || location.url, ...bookmarkDetails(location.url) }); setError(""); }
          catch (cause) { setError(String(cause)); }
        }}><ActionIcon name="star" /></button>
      <button type="button" title="Bookmarks" aria-label="Bookmarks" aria-expanded={bookmarksOpen}
        onClick={() => setBookmarksOpen((open) => !open)}><ActionIcon name="bookmark" /></button>
      <button type="button" className="browser-ad-block" aria-pressed={blockAds} aria-haspopup="dialog" aria-label="Ad blocker" title={blockAds ? "Ad blocker on" : "Ad blocker off"} onClick={() => {
        void browserCommand<string[]>(tabId, "list-element-rules").then((saved) => setRules(saved ?? [])).catch((cause) => setError(String(cause)));
      }}><ActionIcon name="shield" /><span className="browser-status-dot" /></button>
    </form>
    {error && <div className="browser-error" role="alert">{error} <button type="button" onClick={() => {
      setError(""); placement.current = ""; setRetry((value) => value + 1);
    }} title="Retry" aria-label="Retry"><ActionIcon name="reload" /></button></div>}
    <div className="browser-content">
      <div className="browser-host" ref={host} />
      {bookmarksOpen && <BrowserBookmarks
        onOpen={(url) => { setDraft(null); run("navigate", { url }); }} onClose={() => setBookmarksOpen(false)} />}
    </div>
    {bookmark && <BookmarkDialog title={bookmark.saved?.title ?? bookmark.title} folder={bookmark.saved?.folder ?? ""} folders={bookmark.folders}
      onClose={() => setBookmark(null)} onSave={(name, folder) => {
        try { bookmarkPage(bookmark.url, name, folder); setBookmark(null); setError(""); }
        catch (cause) { setBookmark(null); setError(String(cause)); }
      }} />}
    {rules && <AdBlockDialog enabled={blockAds} rules={rules} onClose={() => setRules(null)}
      onToggle={() => {
        localStorage.setItem(AD_BLOCK_KEY, String(!blockAds));
        window.dispatchEvent(new Event(BLOCK_CHANGE));
        run("reload", { blockAds: !blockAds });
      }}
      onPick={() => { setRules(null); run("pick-element"); }}
      onRemove={(selector) => {
        void browserCommand<string[]>(tabId, "remove-element-rule", { selector }).then((saved) => setRules(saved ?? [])).catch((cause) => {
          setRules(null); setError(String(cause));
        });
      }} />}
  </section>;
}
