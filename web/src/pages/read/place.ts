import { useEffect, useState } from "react";
import { keep, kept, pullSettings } from "../../api/kept";

/**
 * Where you are in a book, kept somewhere that survives the browser.
 *
 * IT WAS ONLY EVER IN localStorage. That is the right working copy -- it is
 * there the instant a page paints, and the shelf needs every book's place
 * before it can draw a single progress bar -- but it belongs to the browser,
 * not to you. A browser set to clear site data when it closes, a second
 * browser, a new profile, a reinstall: every book back at page one, with
 * nothing having gone wrong as far as the app was concerned. It was saved,
 * faithfully, somewhere that forgets.
 *
 * So localStorage stays the working copy and every change is mirrored into
 * your-settings.json -- the app's own file, on your disk, beside the tab strip
 * and the volume and everything else that has always come back. The next load
 * pulls it in before a reader opens.
 *
 * WHICHEVER WAS PUT DOWN LAST WINS. Each book carries the time its place was
 * written, so a chapter read here after the file was last written is not
 * dragged back to where the file thinks you were. Without that the pull would
 * be a slow way of undoing the last thing you did.
 */

const AT = "cc-book-at:";
const OFF = "cc-book-off:";
const OF = "cc-book-of:";
const PAGE = "cc-book-page:";
const PAGES = "cc-book-pages:";
const FLOW = "cc-book-flow:";
const MARKS = "cc-book-marks:";
/** When this book's place was last written, so a pull knows which is newer. */
const WHEN = "cc-book-t:";

const KEYS = [AT, OFF, OF, PAGE, PAGES, FLOW, MARKS, WHEN];

/** One book's place, as it travels to the file and back. */
interface Kept {
  at?: number;
  off?: number;
  of?: number;
  page?: number;
  pages?: number;
  flow?: boolean;
  marks?: unknown[];
  t?: number;
}

/**
 * The working copy, in memory.
 *
 * localStorage is written through to as well, and read from at startup, but
 * this is what everything here works off: a browser with storage turned off
 * still reads books, and still keeps your place in them for as long as it is
 * open -- and mirrors it to the file, which is the copy that lasts anyway.
 */
const MEM: Record<string, string> = {};

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// Startup: whatever this browser already had.
(function hydrate() {
  const ls = local();
  if (!ls) return;
  try {
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && KEYS.some((p) => k.startsWith(p))) MEM[k] = ls.getItem(k) ?? "";
    }
  } catch {
    // A storage that will not be enumerated. The pull still fills this in.
  }
})();

function put(key: string, value: string): void {
  MEM[key] = value;
  try {
    local()?.setItem(key, value);
  } catch {
    // Full, or turned off. The mirror is the copy that matters.
  }
}

/** The book a key belongs to, or "" for a key that is not a book's. */
function bookOf(key: string): string {
  for (const p of KEYS) if (key.startsWith(p)) return key.slice(p.length);
  return "";
}

export function remember(key: string, value: string): void {
  const f = bookOf(key);
  // Not a book's: the PDF zoom, and anything else a reader keeps. It is still
  // the app's setting rather than the browser's, so it goes the general way.
  // Nothing in this app is browser-only -- see api/kept.ts.
  if (!f) {
    keep(key, value);
    return;
  }
  put(key, value);
  // A place written is a place worth keeping, and worth timestamping so the
  // next pull can tell it from what the file holds.
  if (!key.startsWith(WHEN)) {
    put(WHEN + f, String(Date.now()));
    push(f);
  }
}

export function remembered(key: string): string | null {
  if (!bookOf(key)) return kept(key);
  if (key in MEM) return MEM[key];
  try {
    return local()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** One book, as the file wants it. */
function gather(f: string): Kept & { f: string } {
  const one: Kept & { f: string } = { f };
  const at = MEM[AT + f];
  const off = MEM[OFF + f];
  const of = MEM[OF + f];
  const flow = MEM[FLOW + f];
  const marks = MEM[MARKS + f];
  const t = MEM[WHEN + f];
  if (at != null) one.at = Number(at) || 0;
  if (off != null) one.off = Number(off) || 0;
  if (of != null) one.of = Number(of) || 0;
  if (MEM[PAGE + f] != null) one.page = Number(MEM[PAGE + f]) || 0;
  if (MEM[PAGES + f] != null) one.pages = Number(MEM[PAGES + f]) || 0;
  if (flow != null) one.flow = flow === "1";
  if (marks != null) {
    try {
      const parsed = JSON.parse(marks);
      if (Array.isArray(parsed)) one.marks = parsed;
    } catch {
      one.marks = [];
    }
  }
  if (t != null) one.t = Number(t) || 0;
  return one;
}

/**
 * The books this page has actually written to, and nothing else.
 *
 * Never the whole map. Two books can be open at once here -- a tab strip and a
 * split view see to that -- and each page holds the map as it stood when it
 * loaded, so a page that sent all of it would put the other book back where it
 * last saw it. A page sends what it changed; the server merges it into the
 * file. See go/internal/server/bookplace.go.
 */
const DIRTY = new Set<string>();

let timer = 0;
/**
 * To the file, on a delay.
 *
 * Reading scrolls, and the reader writes the place as you go; one write per
 * scroll would be a file rewritten a hundred times a chapter. The delay is
 * longer than the reader's own, so a scroll that has come to rest is one
 * write here.
 */
function push(f: string): void {
  DIRTY.add(f);
  window.clearTimeout(timer);
  timer = window.setTimeout(flush, 900);
}

function flush(): void {
  window.clearTimeout(timer);
  for (const f of DIRTY) {
    void fetch("/api/central/book-place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gather(f)),
    }).catch(() => {
      // The server has gone. The working copy still has it, and the next
      // change sends this book again -- it stays dirty until the page does.
    });
  }
  DIRTY.clear();
}

/**
 * On the way out, without waiting to be asked twice.
 *
 * A tab closed a paragraph after the last write has a place worth a beacon:
 * the browser is handed it to deliver and does so after the page is gone,
 * which a fetch started here would not survive to do.
 */
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    window.clearTimeout(timer);
    let left = false;
    for (const f of DIRTY) {
      try {
        const sent = navigator.sendBeacon?.(
          "/api/central/book-place",
          new Blob([JSON.stringify(gather(f))], { type: "application/json" }),
        );
        if (!sent) left = true;
      } catch {
        left = true;
      }
    }
    // No beacon, or it would not take it: try the ordinary way, which on a
    // page that is going away may or may not arrive. Better than not trying.
    if (left) flush();
    else DIRTY.clear();
  });
}

/** Fold the file's copy in, book by book, where it is the newer of the two. */
function take(books: unknown): void {
  if (!books || typeof books !== "object") return;
  for (const [f, raw] of Object.entries(books as Record<string, unknown>)) {
    if (!f || !raw || typeof raw !== "object") continue;
    const b = raw as Kept;
    const theirs = Number(b.t) || 0;
    const ours = Number(MEM[WHEN + f]) || 0;
    // Ours is newer, or the file has nothing to say about when: leave it. A
    // record with no time is one written before this existed, which is older
    // than anything this browser has done since.
    if (ours && theirs <= ours) continue;
    if (typeof b.at === "number") put(AT + f, String(b.at));
    if (typeof b.off === "number") put(OFF + f, String(b.off));
    if (typeof b.of === "number") put(OF + f, String(b.of));
    if (typeof b.page === "number") put(PAGE + f, String(b.page));
    if (typeof b.pages === "number") put(PAGES + f, String(b.pages));
    if (typeof b.flow === "boolean") put(FLOW + f, b.flow ? "1" : "0");
    if (Array.isArray(b.marks)) put(MARKS + f, JSON.stringify(b.marks));
    put(WHEN + f, String(theirs || Date.now()));
  }
}

let pulling: Promise<void> | null = null;
/**
 * The file's copy, once per page.
 *
 * Once, and shared: the shelf and a reader on the same page both want it, and
 * two of them would be two round trips for one answer.
 */
export function pullPlaces(): Promise<void> {
  if (pulling) return pulling;
  // The same read the rest of the settings come from: one file, one trip.
  pulling = pullSettings().then((all) => {
    take(all.books);
  });
  return pulling;
}

/**
 * True once the file's copy is in.
 *
 * A reader must not open before it: it reads its place the moment it mounts,
 * and opening at the top and then jumping is worse than opening a beat later
 * in the right place. It is a small file over a loopback socket.
 */
export function usePlaces(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void pullPlaces().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);
  return ready;
}
