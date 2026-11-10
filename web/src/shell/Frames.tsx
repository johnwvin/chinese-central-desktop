import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { labelFor, parse, realUrl, type Tab } from "./tabs";
import { BrowserPane } from "./BrowserPane";
import type { Shell } from "./useShell";
import { installFullscreenKeys } from "./desktop";
import { installHover } from "./hover";
import { installTabBarShortcut } from "./tabBarShortcut";

/**
 * Every live frame, by tab id.
 *
 * Module-level rather than a ref because the strip needs it too: Back and
 * Forward in a tab's menu drive that tab's own history, which lives on its
 * frame's window and nowhere else.
 */
export const frames = new Map<number, HTMLIFrameElement>();

/**
 * The last `nav` each tab was actually sent to, so one bump moves a frame once
 * however many times React renders after it.
 */
const sent = new Map<number, number>();

export function Frames({ shell }: { shell: Shell }) {
  const stackRef = useRef<HTMLDivElement>(null);
  const draggingSplit = useRef<number | null>(null);
  // What `wire` needs that changes between renders. The listeners it hangs on
  // a frame are installed once and live as long as the frame does, so they
  // read the current theme through here rather than closing over a stale one.
  const latest = useRef(shell);
  latest.current = shell;

  /**
   * A page paints itself from its own settings before anything else runs, so
   * the theme has to be written into it rather than inherited.
   */
  const dress = (frame: HTMLIFrameElement, tab: Tab) => {
    const now = latest.current;
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) return;
    if (now.theme === "auto") doc.documentElement.removeAttribute("data-theme");
    else doc.documentElement.setAttribute("data-theme", now.theme);
    win.__ccVol?.(now.volume);
    try {
      // What the right-click menu inside a page calls to put a lookup beside
      // the page instead of on top of it.
      if (win) win.__ccSplitOpen = (url: string) => url && shell.openBeside(String(url), tab.id);
      // The same lookup, into the dictionary already open beside this page
      // rather than a new one. Which dictionary that is -- or whether there is
      // one at all -- is worked out in the reducer, where the panes are as
      // they are now rather than as they were when this page loaded.
      if (win) {
        win.__ccSplitReplace = (url: string) => {
          if (!url) return;
          shell.lookupBeside(String(url), tab.id);
        };
      }
      // A way out, for the few things that are not ours. `w.open` is replaced
      // real browser tab -- but that caught the right-click menu's Search
      // Google too, which opened an app tab that then sat blank. This is the
      // shell's own `open`, which nothing has touched, so a link that really
      // does belong outside gets a real tab in the browser the app runs in.
      if (win) win.__ccOpenExternal = (url: string) => {
        if (url) window.open(String(url), "_blank", "noopener");
      };
    } catch {
      // Same-origin only; a page we cannot reach simply opens on top.
    }

    say(tab, frame, doc);
  };

  /**
   * What the tab is called and where it now points.
   *
   * The frame's own location, not the address the tab was opened with: a page
   * that navigates itself -- Home's search box, the dictionary following a
   * cross-reference -- used to leave the tab wearing the name it was opened
   * with for the rest of its life.
   */
  const say = (tab: Tab, frame: HTMLIFrameElement, doc: Document | null) => {
    let url = tab.url;
    try {
      const got = realUrl(frame.contentWindow?.location.href ?? "");
      if (got) url = got;
    } catch {
      // Another origin: the address it was opened with is all we have.
    }
    shell.relabel(tab.id, url, labelFor(url, doc));
  };

  /**
   * Everything a frame needs doing to it once it has a document: dressed, and
   * then taught that a new tab means one of ours.
   */
  const wire = (frame: HTMLIFrameElement, tab: Tab) => {
    let doc: Document | null = null;
    let win: Window | null = null;
    try {
      doc = frame.contentDocument;
      win = frame.contentWindow;
    } catch {
      return; // Another origin.
    }
    if (!doc || !win) return;
    const d = doc;
    const w = win;

    dress(frame, tab);
    installTabBarShortcut(d);
    installFullscreenKeys(d);
    installHover(d, w);
    // A page that draws its heading a moment after it loads -- which is most
    // of them -- is named from what it settles on, not from the empty frame.
    window.setTimeout(() => dress(frame, tab), 80);
    window.setTimeout(() => dress(frame, tab), 400);

    const relabel = () => {
      try {
        say(tab, frame, frame.contentDocument);
      } catch {
        // A frame that has gone away has nothing to be called.
      }
    };

    // The dictionary moves between words with pushState, so waiting on the
    // next load would leave the tab named after the word before last.
    try {
      const hist = w.history as History & { __ccHist?: boolean };
      if (!hist.__ccHist) {
        hist.__ccHist = true;
        const push = hist.pushState;
        const replace = hist.replaceState;
        hist.pushState = function (...args: Parameters<History["pushState"]>) {
          const r = push.apply(this, args);
          relabel();
          return r;
        };
        hist.replaceState = function (...args: Parameters<History["replaceState"]>) {
          const r = replace.apply(this, args);
          relabel();
          return r;
        };
        w.addEventListener("popstate", relabel);
        // A word can change without the address doing so at all, so keep a
        // slow eye on the heading too.
        w.setInterval(relabel, 1200);
      }
    } catch {
      // Nothing to hook on a page we cannot reach.
    }

    // Anything that asked for a browser tab gets one of ours instead.
    try {
      w.open = ((url?: string | URL) => {
        // Which tab asked matters: a word looked up from the dictionary joins
        // the dictionary's group rather than landing on its own at the end.
        if (url) shell.add(String(url), true, tab.id);
        return null;
      }) as Window["open"];
    } catch {
      // Same-origin only.
    }

    // Only once per frame: wire is called on load and again for a frame that
    // had already finished, and a second set of listeners meant one press did
    // everything twice.
    const marked = w as Window & { __ccWired?: boolean };
    if (marked.__ccWired) return;
    marked.__ccWired = true;

    // Ctrl+W is a desktop-app shortcut here: events inside an iframe do not
    // reach the tab strip's document listener, so close the tab whose page
    // currently has keyboard focus.
    d.addEventListener("keydown", (event) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      const key = (event.key || "").toLowerCase();
      if (key === "w") {
        event.preventDefault();
        event.stopImmediatePropagation();
        shell.close(tab.id);
      } else if (key === "d") {
        const selected = String(w.getSelection ? w.getSelection() : "").trim();
        if (!selected) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        const define = (w as Window & {
          __ccDefineSelection?: (text?: string) => boolean;
          __ccSplitReplace?: (url: string) => void;
        }).__ccDefineSelection;
        if (define) define();
        else (w as Window & { __ccSplitReplace?: (url: string) => void })
          .__ccSplitReplace?.("/dictionary?q=" + encodeURIComponent(selected));
      }
    }, true);

    d.addEventListener(
      "click",
      (ev) => {
        const a = (ev.target as HTMLElement | null)?.closest?.("a[href]") as
          | HTMLAnchorElement
          | null;
        if (!a) return;
        const blank = a.target === "_blank";
        const aside = ev.ctrlKey || ev.metaKey;
        // Home is the pinned tab and has to stay Home: following a link on it
        // in place left no Home tab at all. Its links open a tab.
        let atHome = false;
        try {
          atHome = w.location.pathname === "/home";
        } catch {
          atHome = false;
        }
        const href = a.getAttribute("href") || "";
        if (
          atHome &&
          ev.isTrusted &&
          !blank &&
          !aside &&
          a.origin === window.location.origin &&
          href &&
          href.charAt(0) !== "#"
        ) {
          ev.preventDefault();
          shell.add(a.href, true);
          return;
        }
        if (!blank && !aside) return;
        if (!a.href || a.href.indexOf("javascript:") === 0) return;
        ev.preventDefault();
        // A ctrl-click opens behind what you are reading; a target="_blank"
        // link is a page you asked to go to.
        shell.add(a.href, !aside);
      },
      true,
    );

    d.addEventListener(
      "auxclick",
      (ev) => {
        if (ev.button !== 1) return;
        const a = (ev.target as HTMLElement | null)?.closest?.("a[href]") as
          | HTMLAnchorElement
          | null;
        if (!a || !a.href) return;
        ev.preventDefault();
        shell.add(a.href, false);
      },
      true,
    );

    d.addEventListener(
      "submit",
      (ev) => {
        const form = ev.target as HTMLFormElement | null;
        if (!form) return;
        // Home is the pinned tab and has to stay Home. Its links already open
        // a tab; its search box is a form, and submitting it in place walked
        // Home off to the dictionary and left the app with no Home at all.
        let atHome = false;
        try {
          atHome = w.location.pathname === "/home";
        } catch {
          atHome = false;
        }
        if (form.target !== "_blank" && !atHome) return;
        ev.preventDefault();
        let url = form.getAttribute("action") || "/";
        if ((form.method || "get").toLowerCase() === "get") {
          const qs = new URLSearchParams(new FormData(form) as unknown as string[][]).toString();
          if (qs) url += (url.indexOf("?") < 0 ? "?" : "&") + qs;
        }
        shell.add(url, true, tab.id);
      },
      true,
    );
  };

  // Theme and volume changes reach every frame, not only the one on screen --
  useEffect(() => {
    for (const tab of shell.tabs) {
      const frame = frames.get(tab.id);
      if (frame) dress(frame, tab);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.theme, shell.volume]);

  // A frame served straight from cache can be complete before the load
  // listener ever gets a turn, which used to leave it unwired: no theme, no
  // volume, and every link in it opening a real browser tab.
  useEffect(() => {
    const late = window.setTimeout(() => {
      for (const tab of shell.tabs) {
        const frame = frames.get(tab.id);
        if (!frame) continue;
        try {
          const doc = frame.contentDocument;
          if (doc && doc.readyState === "complete" && realUrl(doc.URL)) wire(frame, tab);
        } catch {
          // Another origin: nothing to wire.
        }
      }
    }, 120);
    return () => window.clearTimeout(late);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.tabs]);

  /**
   * Send a frame where the strip says it should be.
   *
   * Only for a tab that was deliberately pointed somewhere -- at the moment
   * that means a lookup taking over the dictionary already open beside a page.
   * Everything else navigates itself and the strip follows, which is the whole
   * reason `src` is written once and left alone.
   *
   * It cannot be done by writing `src`: sending an open dictionary to the word
   * it is already pointed at writes the same string, React sees no change, and
   * a pane that had been clicked away somewhere else stays there. So the tab
   * carries a counter that changes every time, and the navigation is done
   * here, by hand. `replace` rather than an assignment, so walking the
   * dictionary from word to word does not build a back-history of them.
   */
  useEffect(() => {
    for (const tab of shell.tabs) {
      if (tab.nav == null) continue;
      if (sent.get(tab.id) === tab.nav) continue;
      sent.set(tab.id, tab.nav);
      const frame = frames.get(tab.id);
      if (!frame) continue;
      try {
        frame.contentWindow?.location.replace(tab.src);
      } catch {
        // Another origin, or not loaded yet: `src` still carries the address.
      }
    }
  }, [shell.tabs]);

  const count = shell.panes.length || 1;
  useEffect(() => {
    if (shell.splitWidths.length !== count) shell.setSplitWidths(Array(count).fill(1 / count));
  }, [count, shell.splitWidths.length, shell.setSplitWidths]);
  const widths = shell.splitWidths.length === count ? shell.splitWidths : Array(count).fill(1 / count);

  const resizeSplit = (event: ReactPointerEvent<HTMLDivElement>, boundary: number) => {
    if (draggingSplit.current !== boundary || !stackRef.current) return;
    const bounds = stackRef.current.getBoundingClientRect();
    if (!bounds.width) return;
    const current = shell.splitWidths.length === count ? shell.splitWidths : Array(count).fill(1 / count);
    const before = current.slice(0, boundary).reduce((sum, value) => sum + value, 0);
    const pair = current[boundary] + current[boundary + 1];
    const min = Math.min(0.12, 0.9 / count);
    const leftWidth = Math.max(min, Math.min(pair - min, (event.clientX - bounds.left) / bounds.width - before));
    const next = [...current];
    next[boundary] = leftWidth;
    next[boundary + 1] = pair - leftWidth;
    shell.setSplitWidths(next);
  };

  /**
   * The frames are drawn in the order the tabs were made, and never reordered.
   *
   * Moving an iframe in the document reloads the page inside it -- the browser
   * gives no way to carry one across. So the stack must not be a picture of
   * the strip: dragging a tab along the row, or a group closing up so its tabs
   * sit together, reorders the tabs, and every frame React had to shift threw
   * away the page it was holding and fetched it again. That is the flash, and
   * with it went your place on the page, the video you were watching and the
   * answer you were halfway through typing.
   *
   * Sorting by id is enough: it is the order they were made in and it never
   * changes. Where a pane sits on screen is set on the element below, not by
   * where it is in the document.
   */
  const stack = [...shell.tabs].sort((a, b) => a.id - b.id);

  return (
    <div ref={stackRef} className={"stack" + (count > 1 ? " split" : "")}>
      {stack.map((tab) => {
        const at = shell.panes.indexOf(tab.id);
        const shown = at >= 0;
        const style: CSSProperties = {
          visibility: shown ? "visible" : "hidden",
          zIndex: shown ? 1 : 0,
          left: shown ? `${widths.slice(0, at).reduce((sum, value) => sum + value, 0) * 100}%` : 0,
          width: shown ? `${widths[at] * 100}%` : "100%",
          borderLeft: shown && at > 0 ? "1px solid var(--tb-line)" : "0",
        };
        const url = parse(tab.src);
        if (url.origin === window.location.origin && url.pathname === "/browser") {
          return <BrowserPane key={tab.id} tabId={tab.id}
            shown={shown} style={style} initialUrl={url.searchParams.get("url") ?? undefined}
            onLocationChange={(pageUrl, title) => shell.relabel(tab.id, `/browser?url=${encodeURIComponent(pageUrl)}`, title || "Browser")}
            onDefine={(text) => shell.lookupBeside("/dictionary?q=" + encodeURIComponent(text), tab.id)}
            onOpenTab={(address) => shell.open("/browser?url=" + encodeURIComponent(address), { fresh: true })}
            onClose={() => shell.close(tab.id)} />;
        }
        return (
          <iframe
            key={tab.id}
            title={tab.label}
            ref={(el) => {
              if (el) frames.set(tab.id, el);
              else frames.delete(tab.id);
            }}
            src={tab.src}
            allowFullScreen
            className={
              "pane" +
              (tab.id === shell.activeId ? " on" : "") +
              (shown && tab.id !== shell.activeId ? " sp" : "")
            }
            style={style}
            onLoad={(e) => wire(e.currentTarget, tab)}
          />
        );
      })}
      {count > 1 && widths.slice(0, -1).map((_, boundary) => {
        const position = widths.slice(0, boundary + 1).reduce((sum, value) => sum + value, 0);
        const adjust = (delta: number) => {
          const current = shell.splitWidths.length === count ? shell.splitWidths : Array(count).fill(1 / count);
          const pair = current[boundary] + current[boundary + 1];
          const min = Math.min(0.12, 0.9 / count);
          const next = [...current];
          next[boundary] = Math.max(min, Math.min(pair - min, current[boundary] + delta));
          next[boundary + 1] = pair - next[boundary];
          shell.setSplitWidths(next);
        };
        return <div key={boundary} className="pane-splitter" role="separator" aria-label={`Resize panes ${boundary + 1} and ${boundary + 2}`}
          aria-orientation="vertical" aria-valuenow={Math.round(position * 100)} tabIndex={0}
          style={{ left: `${position * 100}%` }}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") { event.preventDefault(); adjust(-0.02); }
            if (event.key === "ArrowRight") { event.preventDefault(); adjust(0.02); }
          }}
          onPointerDown={(event) => { draggingSplit.current = boundary; event.currentTarget.setPointerCapture(event.pointerId); resizeSplit(event, boundary); }}
          onPointerMove={(event) => resizeSplit(event, boundary)}
          onPointerUp={() => { draggingSplit.current = null; }}
          onPointerCancel={() => { draggingSplit.current = null; }} />;
      })}
    </div>
  );
}

declare global {
  interface Window {
    __ccVol?: (volume: number) => void;
    /** This platform's own trim, for a volume control drawn on a player. */
    /** How such a control writes that trim back. */
    __ccSetTrim?: (level: number, keep: boolean) => void;
    __ccSplitOpen?: (url: string) => void;
    __ccSplitReplace?: (url: string) => void;
    __ccOpenExternal?: (url: string) => void;
  }
}
