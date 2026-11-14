import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadPdfjs,
  remember,
  remembered,
  type Doc,
  type Lib,
  type OutlineItem,
} from "./pdfjs";
import { JumpHistory, type ReadingSpot } from "./jumpHistory";
import { ReaderFind, matchRange, showFindRange, waitForFind } from "./ReaderFind";

type Chapter = { title: string; page: number; depth: number };
type Bookmark = { id: number; at: number; off: number; name: string };

function savedBookmarks(key: string): Bookmark[] {
  try {
    const value = JSON.parse(remembered(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/**
 * A PDF, drawn as sheets down the middle of the page.
 *
 * Each sheet is a canvas with the PDF's own text laid invisibly on top of it.
 * The text layer is the whole point: it is what makes a selection, and a
 * selection is what the right-click menu works from.
 *
 * The drawing is written against the DOM rather than through React on purpose.
 * A three-hundred-page book is three hundred canvases whose contents are
 * painted by pdf.js and never by us; making React own them would mean
 * re-creating them, and a re-created canvas is a blank one.
 */
export function PdfReader({ f }: { f: string }) {
  const marksKey = "cc-book-marks:" + f;
  const [failed, setFailed] = useState(false); // fall back to the browser's viewer
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState(0);
  const [at, setAt] = useState(1);
  const [typed, setTyped] = useState("1");
  const [travel, setTravel] = useState({ back: false, forward: false });
  const [sideOpen, setSideOpen] = useState(true);
  const [sideTab, setSideTab] = useState<"pages" | "chapters" | "bookmarks">("pages");
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => savedBookmarks(marksKey));
  const [bookmarkName, setBookmarkName] = useState("");

  const pagesBox = useRef<HTMLDivElement>(null);
  const thumbsBox = useRef<HTMLDivElement>(null);
  const outer = useRef<HTMLDivElement>(null);
  const control = useRef<Controller | null>(null);

  const url = useMemo(() => "/bookfile/" + f.split("/").map(encodeURIComponent).join("/") + "?reader=" + Date.now(), [f]);

  const saveBookmarks = (next: Bookmark[]) => {
    setBookmarks(next);
    remember(marksKey, JSON.stringify(next));
  };

  const addBookmark = () => {
    const spot = control.current?.bookmarkSpot();
    if (!spot) return;
    saveBookmarks([
      ...bookmarks,
      { id: Date.now(), at: spot.page, off: spot.frac, name: bookmarkName.trim() },
    ]);
    setBookmarkName("");
    setSideTab("bookmarks");
  };

  useEffect(() => {
    document.title = (f.split("/").pop() || "").replace(/\.pdf$/i, "");
  }, [f]);

  useEffect(() => {
    let live = true;
    loadPdfjs()
      .then((lib) => lib.getDocument(url).promise.then((doc) => ({ lib, doc })))
      .then(({ lib, doc }) => {
        if (!live || !pagesBox.current || !thumbsBox.current || !outer.current) return;
        setReady(true);
        setCount(doc.numPages);
        const c = new Controller(lib, doc, pagesBox.current, thumbsBox.current, outer.current, f,
          (n) => {
            setAt(n);
            setTyped(String(n));
          }, setTravel);
        control.current = c;
        void readOutline(doc)
          .then((items) => {
            if (live) setChapters(items);
          })
          .catch(() => {
            if (live) setChapters([]);
          });
        return c.start();
      })
      .catch((e: unknown) => {
        // Nothing drawn, so hand it back to the browser rather than show an
        // empty page: reading it matters more than selecting from it.
        //
        // Said out loud, though. This swallowed the reason entirely, so the
        // reader changing into a different reader looked like the app having
        // been altered rather than something having gone wrong -- there was
        // no way, from the outside or the console, to find out what.
        console.warn("[reader] built-in reader could not start:", e);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
      control.current?.stop();
      control.current = null;
    };
  }, [url, f]);

  if (failed) {
    return (
      <div id="rd-pdf">
        {/* Say which reader this is. Falling back silently meant the book
            opened in a viewer with different controls, no lookup on
            selection, and no explanation -- indistinguishable from the app
            having been changed underfoot. */}
        <p
          style={{
            margin: "0 0 8px",
            fontSize: "13px",
            opacity: 0.8,
          }}
        >
          The built-in reader could not start, so this is the browser&rsquo;s own
          PDF viewer. Close the tab and open the book again to retry.
        </p>
        <iframe id="rd-frame" src={url} title="" />
      </div>
    );
  }

  return (
    <>
      <div id="rd-pdfjs" hidden={!ready} ref={outer}>
        <ReaderFind units={count} text={(unit) => control.current?.searchText(unit + 1) ?? Promise.resolve("")}
          reveal={async ({ unit, occurrence }, query, signal) => {
            const layer = await control.current?.searchPage(unit + 1, signal);
            if (!layer || signal.aborted) return;
            const range = matchRange(layer, query, occurrence);
            if (range) showFindRange(range);
          }} />
        <div className="pf-reader-layout">
          <div className="pf-side-layer">
          {!sideOpen && (
            <button
              type="button"
              className="pf-icon-button pf-menu-button pf-open-side"
              aria-expanded={false}
              aria-controls="pf-sidebar"
              aria-label="Show PDF controls and navigation"
              title="Show PDF controls and navigation"
              onClick={() => setSideOpen(true)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" /></svg>
            </button>
          )}
          <aside id="pf-sidebar" aria-label="PDF navigation" hidden={!sideOpen}>
            <div className="pf-side-controls">
              <div className="pf-side-head">
                <button
                  type="button"
                  className="pf-icon-button pf-menu-button"
                  aria-expanded={sideOpen}
                  aria-controls="pf-sidebar"
                  aria-label="Hide PDF controls and navigation"
                  title="Hide PDF controls and navigation"
                  onClick={() => setSideOpen(false)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" /></svg>
                </button>
                <div className="rd-history" aria-label="Reading jump history">
                  <button type="button" disabled={!travel.back} onClick={() => control.current?.historyBack()} aria-label="Back to previous reading position" title="Back to previous reading position">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-2" /></svg>
                  </button>
                  <button type="button" disabled={!travel.forward} onClick={() => control.current?.historyForward()} aria-label="Forward to next reading position" title="Forward to next reading position">
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h2" /></svg>
                  </button>
                </div>
                <span className="pfat">
                  Page{" "}
                  <input
                    type="text"
                    id="pf-at"
                    inputMode="numeric"
                    autoComplete="off"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onBlur={() => control.current?.goto(Number(typed))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                  />{" "}
                  / <b id="pf-of">{count || "?"}</b>
                </span>
              </div>
              <div className="pf-side-row">
                <button
                  type="button"
                  className="pf-icon-button"
                  id="pf-prev"
                  disabled={at <= 1}
                  aria-label="Previous page"
                  title="Previous page"
                  onClick={() => control.current?.goto(control.current.aim - 1)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
                </button>
                <button
                  type="button"
                  className="pf-icon-button"
                  id="pf-next"
                  disabled={at >= count}
                  aria-label="Next page"
                  title="Next page"
                  onClick={() => control.current?.goto(control.current.aim + 1)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                </button>
                <span className="pf-tool-separator" aria-hidden="true" />
                <button type="button" className="pf-icon-button" id="pf-out" aria-label="Zoom out" title="Zoom out" onClick={() => control.current?.zoomBy(1 / 1.2)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 12h10" /></svg>
                </button>
                <button type="button" className="pf-icon-button" id="pf-fit" aria-label="Fit page" title="Fit page" onClick={() => control.current?.fit()}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" /></svg>
                </button>
                <button type="button" className="pf-icon-button" id="pf-in" aria-label="Zoom in" title="Zoom in" onClick={() => control.current?.zoomBy(1.2)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v10M7 12h10" /></svg>
                </button>
              </div>
            </div>
            <div className="pf-side-tabs" role="tablist" aria-label="PDF navigation views">
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === "pages"}
                onClick={() => setSideTab("pages")}
              >
                Pages
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === "chapters"}
                onClick={() => setSideTab("chapters")}
              >
                Chapters
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sideTab === "bookmarks"}
                onClick={() => setSideTab("bookmarks")}
              >
                Bookmarks
              </button>
            </div>
            <div className="pf-thumbs" ref={thumbsBox} hidden={sideTab !== "pages"} />
            <nav className="pf-outline" aria-label="PDF chapters" hidden={sideTab !== "chapters"}>
              {chapters === null ? (
                <p>Loading chapters&hellip;</p>
              ) : chapters.length ? (
                chapters.map((chapter, i) => (
                  <button
                    type="button"
                    key={`${chapter.page}-${i}`}
                    className={chapter.page <= at && (i === chapters.length - 1 || chapters[i + 1].page > at) ? "current" : ""}
                    style={{ paddingLeft: 12 + chapter.depth * 16 }}
                    onClick={() => control.current?.goto(chapter.page)}
                    title={`Page ${chapter.page}`}
                  >
                    {chapter.title || `Page ${chapter.page}`}
                  </button>
                ))
              ) : (
                <p>This PDF does not define any chapters.</p>
              )}
            </nav>
            <section className="rd-bookmarks" aria-label="PDF bookmarks" hidden={sideTab !== "bookmarks"}>
              <div className="rd-bookmark-add">
                <input
                  type="text"
                  value={bookmarkName}
                  placeholder="Name (optional)"
                  aria-label="Bookmark name"
                  onChange={(e) => setBookmarkName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addBookmark()}
                />
                <button type="button" className="rd-bookmark-save" onClick={addBookmark} aria-label="Save bookmark" title="Save bookmark">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3.8L6 21V4.75Z" /></svg>
                </button>
              </div>
              {bookmarks.length ? (
                <div className="rd-bookmark-list">
                  {bookmarks.map((mark) => (
                    <div className="rd-bookmark" key={mark.id}>
                      <button type="button" className="rd-bookmark-jump" title={mark.name || `Page ${mark.at}`}
                        onClick={() => control.current?.gotoSpot(mark.at, mark.off)}>
                        <b>{mark.name || `Page ${mark.at}`}</b>
                        {mark.name ? <span>Page {mark.at}</span> : null}
                      </button>
                      <button type="button" className="rd-bookmark-delete" aria-label={`Delete ${mark.name || `Page ${mark.at}`}`} title="Delete bookmark" onClick={() => saveBookmarks(bookmarks.filter((item) => item.id !== mark.id))}>&times;</button>
                    </div>
                  ))}
                </div>
              ) : <div className="rd-bookmark-empty">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3.8L6 21V4.75Z" /></svg>
                <b>No bookmarks</b>
                <span>Save this page to return to it later.</span>
              </div>}
            </section>
          </aside>
          </div>
          <div id="pf-pages" ref={pagesBox} />
        </div>
      </div>
      {ready ? null : (
        <p className="note" id="rd-msg">
          Opening&hellip;
        </p>
      )}
    </>
  );
}

const ZOOM_KEY = "cc-pdf-zoom";

async function readOutline(doc: Doc): Promise<Chapter[]> {
  const outline = await doc.getOutline();
  if (!outline) return [];
  const chapters: Chapter[] = [];
  const visit = async (items: OutlineItem[], depth: number) => {
    for (const item of items) {
      let dest = item.dest;
      if (typeof dest === "string") dest = await doc.getDestination(dest);
      if (Array.isArray(dest) && dest[0] != null) {
        let page: number;
        if (typeof dest[0] === "number") page = dest[0] + 1;
        else page = (await doc.getPageIndex(dest[0])) + 1;
        chapters.push({ title: item.title.trim(), page, depth });
      }
      if (item.items?.length) await visit(item.items, depth + 1);
    }
  };
  await visit(outline, 0);
  return chapters;
}

/** The sheets, the scrolling and the zoom, kept off React's hands. */
class Controller {
  aim = 1;

  private scale = 0;
  private fitting = true;
  private sheets: HTMLDivElement[] = [];
  private at = 1;
  private settled = 0;
  private refit = 0;
  private live = true;
  /**
   * Where you are reading: which sheet, and how far down it.
   *
   * A page number is not a place. Opening a lookup beside the book halves the
   * frame, the sheets are laid out again at the new width, and a scroll
   * position in pixels now means somewhere else entirely -- so the book
   * jumped, and on a short document the browser clamped it back to the top.
   * This is what gets put back afterwards.
   */
  private spot = { page: 1, frac: 0 };
  // True between the frame changing width and the place being restored, so
  // the sweep that runs in between does not take the half-laid-out page for
  // where you meant to be.
  private settling = false;
  /**
   * Nothing is written down until the page we opened at has been reached.
   *
   * THIS IS WHY A BOOK OPENED SOMEWHERE ELSE EVERY TIME. The place was put
   * back once, immediately, against sheets whose size and position were still
   * being worked out -- the fit is measured from a frame that may not have
   * its final width yet, and every sheet is sized from that one number. The
   * moment anything moved, the scroll that had been set pointed at a
   * different page. Then `sweep` looked to see where we were, found that
   * page, and wrote it down over the good one. Restart, drift, save the
   * drift; restart, drift further.
   *
   * The EPUB reader has had this since it had the same fault, and says so
   * over its own copy: the second write is the one that sticks. This is that,
   * for the other reader.
   */
  private landed = false;
  private readonly dpr = Math.min(2, window.devicePixelRatio || 1);
  private readonly key: string;
  private readonly offKey: string;
  private readonly ofKey: string;

  private readonly lib: Lib;
  private readonly doc: Doc;
  private readonly box: HTMLDivElement;
  private readonly thumbs: HTMLDivElement;
  private readonly outer: HTMLElement;
  private readonly said: (n: number) => void;
  private readonly travelChanged: (state: { back: boolean; forward: boolean }) => void;
  private readonly jumps = new JumpHistory();

  async searchText(n: number) {
    const page = await this.doc.getPage(n);
    const { items } = await page.getTextContent() as { items: { str?: string; hasEOL?: boolean }[] };
    return items.map((item) => (item.str ?? "") + (item.hasEOL ? " " : "")).join("");
  }

  async searchPage(n: number, signal: AbortSignal) {
    if (n !== this.aim) this.goto(n);
    this.draw(n);
    return waitForFind(() => {
      const sheet = this.sheets[n - 1];
      return !sheet || sheet.querySelector(".pf-wait") ? null : sheet.querySelector(".textLayer");
    }, signal);
  }

  constructor(
    lib: Lib,
    doc: Doc,
    box: HTMLDivElement,
    thumbs: HTMLDivElement,
    outer: HTMLElement,
    f: string,
    said: (n: number) => void,
    travelChanged: (state: { back: boolean; forward: boolean }) => void,
  ) {
    this.lib = lib;
    this.doc = doc;
    this.box = box;
    this.thumbs = thumbs;
    this.outer = outer;
    this.said = said;
    this.travelChanged = travelChanged;
    this.key = "cc-book-at:" + f;
    this.offKey = "cc-book-off:" + f;
    this.ofKey = "cc-book-of:" + f;
    const was = remembered(ZOOM_KEY);
    if (was === "fit") this.fitting = true;
    else if (was) {
      this.scale = Number(was) || 0;
      this.fitting = !this.scale;
    }
  }

  async start() {
    const first = await this.doc.getPage(1);
    if (!this.live) return;
    // How many pages there are, so the shelf can say how far through you are
    // without opening the file again to count.
    remember(this.ofKey, String(this.doc.numPages));
    const v1 = first.getViewport({ scale: 1 });
    if (!this.scale || this.fitting) {
      this.scale = this.fitScale(v1.width);
      this.fitting = true;
    }
    this.build(v1.width / v1.height);
    this.buildThumbs();
    this.watch();

    const resume = Number(remembered(this.key)) || 1;
    const off = Number(remembered(this.offKey)) || 0;
    if (resume >= 1 && resume <= this.doc.numPages && (resume > 1 || off > 0)) {
      this.at = this.aim = resume;
      this.spot = { page: resume, frac: off };
      this.said(resume);
      this.markThumb(resume);
      this.settleTo();
    } else {
      this.landed = true;
      this.markThumb(1);
      this.draw(1);
    }
  }

  stop() {
    this.live = false;
    window.removeEventListener("scroll", this.soon);
    window.removeEventListener("resize", this.onResize);
    document.removeEventListener("visibilitychange", this.soon);
    window.removeEventListener("focus", this.soon);
    document.removeEventListener("keydown", this.onKey);
    this.thumbWatch?.disconnect();
    window.clearTimeout(this.settled);
    window.clearTimeout(this.refit);
  }

  // The sheet, as wide as the window allows and no wider than the paper
  // really is.
  private fitScale(w1: number) {
    const room = Math.min(Math.max(260, this.outer.clientWidth || 900), 1100) - 8;
    return Math.max(0.2, Math.min(2.5, room / w1));
  }

  /**
   * Every page gets its sheet up front, sized from the first page's shape, so
   * the scrollbar is honest before anything is drawn. Each sheet is corrected
   * to its own size the moment it is.
   */
  private build(ratio: number) {
    this.box.innerHTML = "";
    this.sheets = [];
    for (let i = 1; i <= this.doc.numPages; i++) {
      const sheet = document.createElement("div");
      sheet.className = "pf-page";
      sheet.dataset.n = String(i);
      sheet.style.width = Math.round(612 * this.scale) + "px";
      sheet.style.height = Math.round((612 * this.scale) / ratio) + "px";
      const wait = document.createElement("div");
      wait.className = "pf-wait";
      wait.textContent = String(i);
      sheet.appendChild(wait);
      this.box.appendChild(sheet);
      this.sheets.push(sheet);
    }
  }

  private thumbWatch: IntersectionObserver | null = null;

  private buildThumbs() {
    this.thumbs.innerHTML = "";
    this.thumbWatch?.disconnect();
    this.thumbWatch = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          this.thumbWatch?.unobserve(entry.target);
          void this.drawThumb(entry.target as HTMLButtonElement);
        }
      },
      { root: this.thumbs, rootMargin: "240px 0px" },
    );
    for (let n = 1; n <= this.doc.numPages; n++) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "pf-thumb";
      button.dataset.n = String(n);
      button.title = `Page ${n}`;
      button.innerHTML = `<span class="pf-thumb-paper"><span>${n}</span></span><b>${n}</b>`;
      button.addEventListener("click", () => this.goto(n));
      this.thumbs.appendChild(button);
      this.thumbWatch.observe(button);
    }
  }

  private async drawThumb(button: HTMLButtonElement) {
    const n = Number(button.dataset.n);
    const paper = button.querySelector<HTMLElement>(".pf-thumb-paper");
    if (!paper || !this.live) return;
    try {
      const page = await this.doc.getPage(n);
      const unit = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 128 / unit.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width * this.dpr);
      canvas.height = Math.ceil(vp.height * this.dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (!this.live) return;
      const text = await page.getTextContent();
      const layer = document.createElement("div");
      layer.className = "textLayer";
      layer.style.setProperty("--scale-factor", String(128 / unit.width));
      paper.replaceChildren(canvas, layer);
      await this.lib.renderTextLayer({
        textContentSource: text,
        container: layer,
        viewport: vp,
        textDivs: [],
      }).promise;
    } catch {
      // Keep the numbered placeholder when a preview cannot be rendered.
    }
  }

  private markThumb(n: number) {
    this.thumbs.querySelector(".pf-thumb.current")?.classList.remove("current");
    const current = this.thumbs.querySelector<HTMLButtonElement>(`.pf-thumb[data-n="${n}"]`);
    current?.classList.add("current");
    // Do not use scrollIntoView here. It scrolls every overflow ancestor,
    // including the sidebar itself (overflow:hidden can still be scrolled by
    // script), which pushed the controls above the panel's clipped edge.
    if (current) {
      const item = current.getBoundingClientRect();
      const list = this.thumbs.getBoundingClientRect();
      if (item.top < list.top) this.thumbs.scrollTop -= list.top - item.top;
      else if (item.bottom > list.bottom) this.thumbs.scrollTop += item.bottom - list.bottom;
    }
  }

  private draw(n: number) {
    const sheet = this.sheets[n - 1];
    if (!sheet || sheet.dataset.done) return;
    sheet.dataset.done = "1";
    this.doc
      .getPage(n)
      .then(async (page) => {
        if (!this.live) return;
        const vp = page.getViewport({ scale: this.scale });
        sheet.style.width = Math.round(vp.width) + "px";
        sheet.style.height = Math.round(vp.height) + "px";
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(vp.width * this.dpr);
        canvas.height = Math.ceil(vp.height * this.dpr);
        sheet.appendChild(canvas);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        const text = await page.getTextContent();
        const layer = document.createElement("div");
        layer.className = "textLayer";
        // pdf.js 3 sizes the spans off this, not off the viewport.
        layer.style.setProperty("--scale-factor", String(this.scale));
        sheet.appendChild(layer);
        await this.lib.renderTextLayer({
          textContentSource: text,
          container: layer,
          viewport: vp,
          textDivs: [],
        }).promise;
        sheet.querySelector(".pf-wait")?.remove();
      })
      .catch(() => {
        sheet.dataset.done = "";
        const wait = sheet.querySelector(".pf-wait");
        if (wait) wait.textContent = `Page ${n} would not draw.`;
      });
  }

  /**
   * Draw what is near the window, and keep the page number honest.
   *
   * Worked out from the scroll position rather than watched for with an
   * observer: an observer needs a frame to run in, and a tab opened in the
   * background has not been painted yet, so the sheets in it would sit blank
   * until something else woke them.
   */
  private sweep = () => {
    if (!this.sheets.length || !this.live) return;
    const top = window.scrollY || document.documentElement.scrollTop || 0;
    const tall = window.innerHeight || 800;
    const near = tall * 1.5;
    let here = this.at;
    let mostVisible = 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    for (let i = 0; i < this.sheets.length; i++) {
      const sheet = this.sheets[i];
      const y = sheet.offsetTop;
      const h = sheet.offsetHeight;
      if (y - near < top + tall && y + h + near > top) this.draw(i + 1);
      if (y < top + tall && y + h > top) {
        const rect = sheet.getBoundingClientRect();
        const visibleWidth = Math.max(0, Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0));
        const visibleHeight = Math.max(0, Math.min(rect.bottom, tall) - Math.max(rect.top, 0));
        const visibleArea = visibleWidth * visibleHeight;
        if (visibleArea > mostVisible) {
          mostVisible = visibleArea;
          here = i + 1;
        }
      }
    }
    if (here !== this.at) {
      this.at = this.aim = here;
      // Where we have drifted to on the way in is not where you were.
      if (this.landed) remember(this.key, String(this.at));
      this.said(this.at);
      this.markThumb(this.at);
    }
    this.note();
  };

  /**
   * Where you are, as a sheet and how far down it -- and written down, so the
   * book opens where you left it rather than at the top of the right page.
   */
  private note() {
    if (this.settling || !this.landed) return;
    const sheet = this.sheets[this.at - 1];
    if (!sheet) return;
    const top = window.scrollY || document.documentElement.scrollTop || 0;
    const frac = (top - sheet.offsetTop) / Math.max(1, sheet.offsetHeight);
    this.spot = { page: this.at, frac };
    remember(this.offKey, frac.toFixed(4));
  }

  /**
   * Back to where the book was left, and stay there until the page stops
   * moving under it.
   *
   * One scroll is not enough. The sheets are laid out from a guess at the
   * width, the pages nearest the viewport then render at their real size, and
   * a lookup opened beside the book changes the width again -- each of those
   * moves every sheet below it, and the number that was scrolled to stops
   * meaning the same place. So it is put back, and put back again, for as
   * long as the page is still changing height, and only then is anything
   * written down.
   *
   * A timer rather than an animation frame, for the same reason the EPUB
   * reader uses one: a book opened in a tab you are not looking at gets no
   * frames at all, and the place would not go back until you looked -- by
   * which time the save had already recorded the wrong page.
   */
  private settleTo() {
    let was = -1;
    let tries = 0;
    const put = () => {
      if (!this.live) return;
      this.goSpot();
      // Drawing the neighbours is what corrects their sizes, which is the
      // thing being waited for.
      this.sweep();
      const tall = document.body.scrollHeight;
      if (tall !== was && tries++ < 40) {
        was = tall;
        window.setTimeout(put, 80);
        return;
      }
      this.landed = true;
    };
    window.setTimeout(put, 0);
  }

  /** And back to it, wherever that sheet has ended up. */
  private goSpot() {
    const sheet = this.sheets[this.spot.page - 1];
    if (!sheet) return;
    this.draw(this.spot.page);
    window.scrollTo(0, Math.max(0, sheet.offsetTop + this.spot.frac * sheet.offsetHeight));
  }

  private soon = () => {
    window.clearTimeout(this.settled);
    this.settled = window.setTimeout(this.sweep, 80);
  };

  private watch() {
    this.sweep();
    window.addEventListener("scroll", this.soon, { passive: true });
    window.addEventListener("resize", this.onResize);
    // And when the tab is finally looked at, in case it was opened behind
    // this one and nothing has scrolled since.
    document.addEventListener("visibilitychange", this.soon);
    window.addEventListener("focus", this.soon);
    document.addEventListener("keydown", this.onKey);
  }

  goto(n: number) {
    n = Math.max(1, Math.min(this.doc.numPages, Math.round(n) || 1));
    this.jumpTo({ at: n, off: 0 });
  }

  zoomBy(by: number) {
    void this.zoom(this.scale * by, false);
  }

  fit() {
    void this.zoom(this.scale, true);
  }

  /**
   * Zoom throws away what is drawn and draws it again at the new size: scaling
   * a canvas up is a blurry page, and this is a reader.
   */
  private async zoom(next: number, isFit: boolean) {
    this.scale = Math.max(0.25, Math.min(4, next));
    this.note();
    this.fitting = isFit;
    remember(ZOOM_KEY, isFit ? "fit" : String(this.scale));
    const back = this.at;
    const first = await this.doc.getPage(1);
    if (!this.live) return;
    const v1 = first.getViewport({ scale: 1 });
    if (isFit) this.scale = this.fitScale(v1.width);
    this.build(v1.width / v1.height);
    // Back to where you were rather than to the top of the page you were on:
    // a paragraph two thirds down a sheet is a place, and a rebuild that
    // forgets it is a rebuild you feel.
    this.at = this.aim = back;
    this.goSpot();
    this.said(back);
    this.sweep();
  }

  /**
   * A frame that changes width refits, if fitting is what it was on -- and
   * either way it goes back to the place you were reading.
   *
   * Opening a lookup beside the book is a width change, and losing your page
   * every time you look a word up is not a reader.
   */
  private onResize = () => {
    this.settling = true;
    window.clearTimeout(this.refit);
    this.refit = window.setTimeout(() => {
      if (this.fitting) {
        void this.zoom(this.scale, true).then(() => {
          this.settling = false;
        });
        return;
      }
      // Nothing to rebuild at a fixed zoom, but the sheets have still moved.
      this.goSpot();
      this.settling = false;
      this.soon();
    }, 250);
  };

  bookmarkSpot() {
    this.note();
    return { page: this.spot.page, frac: Math.min(1, Math.max(0, this.spot.frac)) };
  }

  gotoSpot(page: number, frac: number) {
    const n = Math.max(1, Math.min(this.doc.numPages, Math.round(page) || 1));
    this.jumpTo({ at: n, off: Math.min(1, Math.max(0, Number(frac) || 0)) });
  }

  private currentSpot(): ReadingSpot {
    this.sweep();
    const sheet = this.sheets[this.at - 1];
    if (!sheet) return { at: this.at, off: 0 };
    const top = window.scrollY || document.documentElement.scrollTop || 0;
    return { at: this.at, off: (top - sheet.offsetTop) / Math.max(1, sheet.offsetHeight) };
  }

  private landAt(spot: ReadingSpot) {
    this.at = this.aim = spot.at;
    this.spot = { page: spot.at, frac: spot.off };
    this.draw(spot.at);
    this.goSpot();
    this.said(spot.at);
    this.markThumb(spot.at);
    // A direct jump can leave the old saved page in place: sweep only writes
    // the page number when it detects a change, and we already set this.at.
    remember(this.key, String(spot.at));
    remember(this.offKey, Math.min(1, Math.max(0, spot.off)).toFixed(4));
    this.sweep();
  }

  private showTravel() {
    this.travelChanged({ back: this.jumps.canBack, forward: this.jumps.canForward });
  }

  private jumpTo(spot: ReadingSpot) {
    this.jumps.push(this.currentSpot(), spot);
    this.landAt(spot);
    this.showTravel();
  }

  historyBack() {
    const spot = this.jumps.back(this.currentSpot());
    if (spot) this.landAt(spot);
    this.showTravel();
  }

  historyForward() {
    const spot = this.jumps.forward(this.currentSpot());
    if (spot) this.landAt(spot);
    this.showTravel();
  }

  // Arrow keys turn the page, unless something is being typed into or a
  // selection is being dragged out.
  private onKey = (ev: KeyboardEvent) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (ev.key === "ArrowRight" || ev.key === "PageDown") {
      ev.preventDefault();
      this.goto(this.aim + 1);
    } else if (ev.key === "ArrowLeft" || ev.key === "PageUp") {
      ev.preventDefault();
      this.goto(this.aim - 1);
    } else if (ev.key === "Home") {
      ev.preventDefault();
      this.goto(1);
    } else if (ev.key === "End") {
      ev.preventDefault();
      this.goto(this.doc.numPages);
    }
  };
}
