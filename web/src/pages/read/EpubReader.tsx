import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { api, type Spine } from "../../api/central";
import { remember, remembered } from "./pdfjs";
import { JumpHistory, type ReadingSpot } from "./jumpHistory";
import { paginateEpub } from "./epubPages";
import { ReaderFind, matchRange, searchableText, showFindRange, waitForFind } from "./ReaderFind";

type Bookmark = { id: number; at: number; off: number; name: string };

const documentTop = (element: Element) => window.scrollY + element.getBoundingClientRect().top;

function savedBookmarks(key: string): Bookmark[] {
  try {
    const value = JSON.parse(remembered(key) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/**
 * An EPUB as separate reading sheets, shown one at a time or in a long scroll.
 * The chosen view and position are remembered per book.
 *
 * A port of the EPUB half of READ_JS in server.py.
 */
export function EpubReader({ f }: { f: string }) {
  const atKey = "cc-book-at:" + f;
  const offKey = "cc-book-off:" + f;
  const ofKey = "cc-book-of:" + f;
  const flowKey = "cc-book-flow:" + f;
  const marksKey = "cc-book-marks:" + f;

  const [spine, setSpine] = useState<Spine | null>(null);
  const [failed, setFailed] = useState("");
  const [at, setAt] = useState(0);
  const [flow, setFlow] = useState(() => remembered(flowKey) === "1");
  const [navOpen, setNavOpen] = useState(true);
  const [navTab, setNavTab] = useState<"chapters" | "bookmarks">("chapters");
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() => savedBookmarks(marksKey));
  const [bookmarkName, setBookmarkName] = useState("");
  const [travel, setTravel] = useState({ back: false, forward: false });
  const [pageNumber, setPageNumber] = useState(0);
  const [pageCounts, setPageCounts] = useState<number[]>([]);
  const [pageWidth, setPageWidth] = useState<number | null>(null);
  const [sheetHeight] = useState(() => Math.max(560, (window.innerHeight || 600) - 40));
  const [pageInput, setPageInput] = useState("");
  const [flowPage, setFlowPage] = useState(0);

  const page = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const chapterCache = useRef(new Map<number, string>());
  const currentAt = useRef(0);
  const currentPage = useRef(0);
  const visiblePages = useRef<HTMLElement[]>([]);
  const loadedRef = useRef(0);
  const flowGeneration = useRef(0);
  const loading = useRef(false);
  const jumps = useRef(new JumpHistory());
  const navigation = useRef(0);
  // Nothing is written down until the place we opened at has actually been
  // reached. Without this the book saved its position twice on the way in --
  // once at the top of the fresh page, before the restore had run -- and the
  // second write was the one that stuck, so it always opened at the top.
  const landed = useRef(false);
  const resizing = useRef(false);
  useLayoutEffect(() => {
    const width = page.current?.parentElement?.clientWidth ?? 0;
    if (width > 0) setPageWidth(width);
  }, []);
  const chapters = spine?.chapters ?? [];
  const count = chapters.length;
  const bookTotal = pageCounts.length === count && count > 0 ? pageCounts.reduce((sum, n) => sum + n, 0) : 0;
  const bookPage = bookTotal ? pageCounts.slice(0, at).reduce((sum, n) => sum + n, 0) + (flow ? flowPage : pageNumber) + 1 : 0;

  useEffect(() => {
    if (bookPage) setPageInput(String(bookPage));
    if (bookPage && bookTotal) {
      remember("cc-book-page:" + f, String(bookPage));
      remember("cc-book-pages:" + f, String(bookTotal));
    }
  }, [bookPage, bookTotal, f]);

  // Count existing reading sheets across the spine; chapters are not pages.
  useEffect(() => {
    if (!spine || !measure.current || !page.current) return;
    let generation = 0, alive = true;
    const countPages = async () => {
      const run = ++generation;
      setPageCounts([]);
      if (!measure.current || measure.current.getBoundingClientRect().width < 1) return;
      await document.fonts.ready;
      const counts: number[] = [];
      for (let i = 0; i < count; i++) {
        let html = chapterCache.current.get(i);
        if (html === undefined) {
          const part = await api.chapter(f, i);
          if (part.error) throw new Error(part.error);
          html = part.html ?? "";
          chapterCache.current.set(i, html);
        }
        if (!alive || run !== generation || !measure.current) return;
        const stage = document.createElement("section");
        stage.className = "rd-epub-chapter";
        measure.current.replaceChildren(stage);
        const sheets = await paginateEpub(stage, html);
        counts.push(sheets.length);
      }
      if (!alive || run !== generation) return;
      measure.current?.replaceChildren();
      setPageCounts(counts);
    };
    void countPages().catch(() => {
      if (alive) setFailed("The book's pages could not be counted.");
    });
    return () => { alive = false; generation++; };
  }, [spine, f, count]);

  useEffect(() => {
    api
      .spine(f)
      .then((d) => {
        if (d.error) setFailed(d.error);
        else setSpine(d);
      })
      .catch(() => setFailed("That book would not open."));
  }, [f]);

  // ---- one visible sheet at a time ----

  const show = useCallback(
    (i: number, off = 0) => {
      const request = ++navigation.current;
      api
        .chapter(f, i)
        .then(async (d) => {
          if (request !== navigation.current) return;
          if (d.error) {
            setFailed(d.error);
            return;
          }
          if (!page.current) return;
          chapterCache.current.set(i, d.html ?? "");
          const chapter = document.createElement("section");
          chapter.className = "rd-epub-chapter";
          page.current.replaceChildren(chapter);
          const pages = await paginateEpub(chapter, d.html ?? "");
          if (request !== navigation.current) return;
          visiblePages.current = pages;
          const index = Math.min(pages.length - 1, Math.max(0, Math.floor(off * pages.length)));
          pages.forEach((sheet, n) => { sheet.hidden = n !== index; });
          currentPage.current = index;
          setPageNumber(index);
          currentAt.current = d.i ?? i;
          setAt(d.i ?? i);
          remember(atKey, String(d.i ?? i));
          remember(offKey, (index / Math.max(1, pages.length)).toFixed(4));
          window.scrollTo({ top: 0 });
          landed.current = true;
        })
        .catch(() => { if (request === navigation.current) setFailed("That chapter would not open."); });
    },
    [f, atKey],
  );

  // ---- separate sheets in one continuous scroll ----

  const loadMore = useCallback(() => {
    if (loading.current || loadedRef.current >= count) return;
    const i = loadedRef.current;
    const generation = flowGeneration.current;
    loading.current = true;
    let continueLoading = false;
    api.chapter(f, i).then(async (d) => {
      if (generation !== flowGeneration.current || d.error || !page.current) return;
      const chapter = document.createElement("section");
      chapter.className = "rd-epub-chapter";
      chapter.id = "rd-ch-" + i;
      page.current.appendChild(chapter);
      chapterCache.current.set(i, d.html ?? "");
      await paginateEpub(chapter, d.html ?? "");
      if (generation !== flowGeneration.current) return;
      loadedRef.current = i + 1;
      const tall = Math.max(window.innerHeight || 0, 700);
      continueLoading = document.body.scrollHeight < tall * 2 || i + 1 < 3;
    }).catch(() => undefined).finally(() => {
      if (generation !== flowGeneration.current) return;
      loading.current = false;
      if (continueLoading) loadMore();
    });
  }, [f, count, chapters]);

  // Restore the chapter, position, and view that were last used.
  const opened = useRef(false);
  useEffect(() => {
    if (!spine || opened.current) return;
    opened.current = true;
    const was = Number(remembered(atKey)) || 0;
    const off = Number(remembered(offKey)) || 0;
    if (flow) {
      loadMore();
      goTo(was, off);
    } else {
      show(was < count ? was : 0, off);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spine]);

  /**
   * In long scroll, land at the saved fraction of the requested chapter.
   */
  const goTo = useCallback(
    (i: number, off = 0) => {
      const request = ++navigation.current;
      let tries = 0;
      const land = () => {
        if (request !== navigation.current) return;
        const mark = document.getElementById("rd-ch-" + i);
        // Where a chapter ends is where the next one's mark is. Without that
        // mark the fraction would be measured against everything loaded so
        // far, so wait for it -- unless there is no next chapter to wait for.
        const next = document.getElementById("rd-ch-" + (i + 1));
        if (mark && (off <= 0.01 || next || i + 1 >= count)) {
          const start = documentTop(mark);
          const end = next ? documentTop(next) : document.body.scrollHeight;
          const span = Math.max(1, end - start);
          const sheets = [...mark.querySelectorAll<HTMLElement>(".rd-epub-sheet")];
          const sheetIndex = Math.min(sheets.length - 1, Math.max(0, Math.floor(off * sheets.length)));
          const sheet = sheets[sheetIndex];
          window.scrollTo(0, sheet ? Math.round(documentTop(sheet) +
            Math.max(0, Math.min(1, off * sheets.length - sheetIndex)) * sheet.offsetHeight) : Math.round(start + off * span));
          currentAt.current = i;
          setAt(i);
          remember(atKey, String(i));
          remember(offKey, off.toFixed(4));
          landed.current = true;
          return;
        }
        if (tries++ > 400) {
          landed.current = true;
          return;
        }
        loadMore();
        window.setTimeout(land, 60);
      };
      land();
    },
    [loadMore, count],
  );

  /**
   * Where you are in the book: which chapter, and how far through it.
   *
   * A chapter and a fraction survive changes in window width and reading mode.
   */
  const readSpot = useCallback((): { at: number; off: number } => {
    const top = window.scrollY || document.documentElement.scrollTop || 0;
    if (!flow) {
      return { at: currentAt.current, off: currentPage.current / Math.max(1, visiblePages.current.length) };
    }
    const marks = Array.from(document.querySelectorAll<HTMLElement>(".rd-epub-chapter[id]"));
    let here = 0;
    let start = 0;
    let end = document.body.scrollHeight;
    for (const mark of marks) {
      const markTop = documentTop(mark);
      if (markTop > top + 4) {
        end = markTop;
        break;
      }
      here = Number(mark.id.replace("rd-ch-", "")) || 0;
      start = markTop;
      end = document.body.scrollHeight;
    }
    const sheets = [...(document.getElementById("rd-ch-" + here)?.querySelectorAll<HTMLElement>(".rd-epub-sheet") ?? [])];
    let index = 0;
    for (let i = 0; i < sheets.length; i++) {
      if (documentTop(sheets[i]) <= top + 4) index = i;
      else break;
    }
    if (sheets[index]) return { at: here, off: (index + Math.min(1, Math.max(0,
      (top - documentTop(sheets[index])) / Math.max(1, sheets[index].offsetHeight)))) / sheets.length };
    return { at: here, off: Math.min(1, Math.max(0, (top - start) / Math.max(1, end - start))) };
  }, [flow]);

  const showTravel = () => setTravel({ back: jumps.current.canBack, forward: jumps.current.canForward });
  const openSpot = (spot: ReadingSpot) => {
    landed.current = false;
    if (flow) goTo(spot.at, spot.off);
    else show(spot.at, spot.off);
  };
  const jumpTo = (i: number, off = 0) => {
    if (!count) return;
    const spot = { at: Math.max(0, Math.min(count - 1, i)), off };
    const from = landed.current ? readSpot() : jumps.current.current ?? { at, off: 0 };
    jumps.current.push(from, spot);
    showTravel();
    openSpot(spot);
  };
  const turnPage = (direction: -1 | 1) => {
    if (flow) { goPage(bookPage + direction); return; }
    const next = currentPage.current + direction;
    if (next >= 0 && next < visiblePages.current.length) {
      visiblePages.current[currentPage.current].hidden = true;
      visiblePages.current[next].hidden = false;
      currentPage.current = next;
      setPageNumber(next);
      remember(offKey, (next / visiblePages.current.length).toFixed(4));
      window.scrollTo({ top: 0 });
    } else if (direction < 0 && at > 0) {
      jumpTo(at - 1, 1);
    } else if (direction > 0 && at < count - 1) {
      jumpTo(at + 1);
    }
  };
  const historyBack = () => {
    const from = landed.current ? readSpot() : jumps.current.current ?? { at, off: 0 };
    const spot = jumps.current.back(from);
    if (spot) openSpot(spot);
    showTravel();
  };
  const historyForward = () => {
    const from = landed.current ? readSpot() : jumps.current.current ?? { at, off: 0 };
    const spot = jumps.current.forward(from);
    if (spot) openSpot(spot);
    showTravel();
  };

  /**
   * And it is written down as you read.
   *
   * On a delay, so a scroll is one write rather than a hundred, and again on
   * the way out -- closing the tab mid-chapter should not cost you the page.
   */
  useEffect(() => {
    if (!spine) return;
    // How many there are, so the shelf can say how far through you are without
    // opening the book again to count.
    remember(ofKey, String(spine.chapters?.length ?? 0));
    const keep = () => {
      if (!landed.current || resizing.current) return;
      const spot = readSpot();
      remember(atKey, String(spot.at));
      remember(offKey, spot.off.toFixed(4));
      // Reading straight through, the picker should say which chapter you are
      // in rather than which one you last jumped to.
      if (flow) setAt(spot.at);
    };
    let timer = 0;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(keep, 250);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", keep);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", keep);
      keep();
    };
  }, [spine, flow, readSpot, atKey, offKey, ofKey]);

  /**
   * Keep the first visible character in place when fullscreen or a side panel
   * changes the viewport. Anchoring a whole chapter loses the reading position
   * when earlier sheets in that chapter change height.
   */
  useEffect(() => {
    const box = page.current;
    if (!box) return;
    let anchor: { node: Text; offset: number; top: number } | null = null;
    let width = box.clientWidth, height = window.innerHeight;
    let restoreTimer = 0, captureTimer = 0;
    const changed = () => Math.abs(box.clientWidth - width) > 1 || window.innerHeight !== height;
    const characterBox = (node: Text, offset: number) => {
      const range = document.createRange();
      // A range must include the whole character for supplementary Han text.
      if (offset > 0 && /[\uDC00-\uDFFF]/.test(node.data[offset]) && /[\uD800-\uDBFF]/.test(node.data[offset - 1])) offset--;
      range.setStart(node, offset);
      const length = (node.data.codePointAt(offset) ?? 0) > 0xffff ? 2 : 1;
      range.setEnd(node, Math.min(node.length, offset + length));
      return range.getClientRects()[0];
    };

    const mark = () => {
      // Only once the book has reached the place it opened at: an anchor taken
      // from the empty page would drag it back there.
      if (!landed.current) return;
      if (changed()) { resize(); return; }
      if (resizing.current) return;
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (!node.data.trim() || node.parentElement?.closest("[hidden],script,style,.rd-epub-measure")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        if (![...range.getClientRects()].some((rect) => rect.bottom > 8 && rect.top < window.innerHeight)) continue;
        // Remember the character on the first visible line, even when one
        // text node contains an entire chapter rather than one paragraph.
        let low = 0, high = node.length - 1;
        while (low < high) {
          const middle = Math.floor((low + high) / 2);
          const rect = characterBox(node, middle);
          if (!rect || rect.bottom <= 8) low = middle + 1;
          else high = middle;
        }
        const rect = characterBox(node, low);
        if (!rect) continue;
        anchor = { node, offset: low, top: rect.top };
        return;
      }
    };
    const back = () => {
      // Not while the book is still finding the place it opened at: this and
      // the restore would be two hands on the scrollbar, and this one -- which
      // fires on every reflow as the pictures arrive -- always won. That is
      // why a book with a place saved still opened at the top.
      if (landed.current && anchor?.node.isConnected && anchor.offset < anchor.node.length) {
        const rect = characterBox(anchor.node, anchor.offset);
        if (rect) {
          const shifted = rect.top - anchor.top;
          if (Math.abs(shifted) > 1) window.scrollBy(0, shifted);
        }
      }
      width = box.clientWidth; height = window.innerHeight;
      resizing.current = false;
      mark();
    };
    const resize = () => {
      if (!changed() && !resizing.current) return;
      resizing.current = true;
      window.clearTimeout(restoreTimer);
      // The desktop fullscreen transition can deliver several resize events;
      // wait for the final viewport size before restoring the text anchor.
      restoreTimer = window.setTimeout(back, 220);
    };

    mark();
    window.addEventListener("scroll", mark, { passive: true });
    window.addEventListener("resize", resize);
    const watch = new ResizeObserver(resize);
    watch.observe(box);
    const content = new MutationObserver(() => {
      window.clearTimeout(captureTimer);
      captureTimer = window.setTimeout(mark, 0);
    });
    content.observe(box, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
    return () => {
      window.removeEventListener("scroll", mark);
      window.removeEventListener("resize", resize);
      window.clearTimeout(restoreTimer);
      window.clearTimeout(captureTimer);
      resizing.current = false;
      watch.disconnect();
      content.disconnect();
    };
  }, [spine, flow]);

  useEffect(() => {
    if (!flow) return;
    const onScroll = () => {
      const near =
        document.body.scrollHeight - window.scrollY - window.innerHeight < window.innerHeight;
      if (near) loadMore();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [flow, loadMore]);

  // Arrow keys turn the page, unless something is being typed into.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const tag = (ev.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (ev.key === "ArrowRight" || (!flow && ev.key === "PageDown")) {
        ev.preventDefault();
        if (flow) goPage(bookPage + 1);
        else turnPage(1);
      } else if (ev.key === "ArrowLeft" || (!flow && ev.key === "PageUp")) {
        ev.preventDefault();
        if (flow) goPage(bookPage - 1);
        else turnPage(-1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  /**
   * Belt and braces: the chapter arrives with nothing to click, and a click
   * inside the page goes nowhere regardless. A book that could replace the tab
   * it is being read in is a book that can lose your place, and a dead link in
   * a decade-old EPUB would do it.
   */
  useEffect(() => {
    const box = page.current;
    if (!box) return;
    const stop = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      if (target?.closest?.("a")) {
        ev.preventDefault();
        ev.stopPropagation();
      }
    };
    box.addEventListener("click", stop, true);
    return () => box.removeEventListener("click", stop, true);
  }, [spine]);

  const go = (i: number) => jumpTo(i);

  const goPage = (number: number) => {
    if (!bookTotal) return;
    let remaining = Math.max(1, Math.min(bookTotal, Math.round(number) || bookPage)) - 1;
    for (let i = 0; i < pageCounts.length; i++) {
      if (remaining < pageCounts[i]) {
        const offset = remaining / pageCounts[i];
        jumpTo(i, offset);
        return;
      }
      remaining -= pageCounts[i];
    }
  };

  useEffect(() => {
    if (!flow) return;
    const update = () => {
      if (resizing.current) return;
      const width = window.innerWidth || document.documentElement.clientWidth;
      const height = window.innerHeight || document.documentElement.clientHeight;
      let visibleArea = 0;
      let visibleSheet: HTMLElement | null = null;
      for (const sheet of page.current?.querySelectorAll<HTMLElement>(".rd-epub-sheet") ?? []) {
        const rect = sheet.getBoundingClientRect();
        const visibleWidth = Math.max(0, Math.min(rect.right, width) - Math.max(rect.left, 0));
        const visibleHeight = Math.max(0, Math.min(rect.bottom, height) - Math.max(rect.top, 0));
        const area = visibleWidth * visibleHeight;
        if (area > visibleArea) {
          visibleArea = area;
          visibleSheet = sheet;
        }
      }
      if (!visibleSheet) return;
      const chapter = visibleSheet.closest<HTMLElement>(".rd-epub-chapter[id]");
      if (!chapter) return;
      const chapterIndex = Number(chapter.id.replace("rd-ch-", ""));
      const sheets = [...chapter.querySelectorAll<HTMLElement>(".rd-epub-sheet")];
      const sheetIndex = sheets.indexOf(visibleSheet);
      if (chapterIndex >= 0 && sheetIndex >= 0) {
        setAt(chapterIndex);
        setFlowPage(sheetIndex);
      }
    };
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [flow]);

  const toggleFlow = () => {
    // Where you are now, read before the layout it was measured against is
    // torn down. The two views are two ways of showing one place in a book,
    // and switching between them should not be a way of losing it.
    const spot = readSpot();
    landed.current = false;
    const next = !flow;
    flowGeneration.current++;
    setFlow(next);
    remember(flowKey, next ? "1" : "0");
    if (page.current) page.current.innerHTML = "";
    if (next) {
      loadedRef.current = 0;
      loading.current = false;
      loadMore();
      goTo(spot.at, spot.off);
    } else {
      show(spot.at, spot.off);
    }
  };

  const saveBookmarks = (next: Bookmark[]) => {
    setBookmarks(next);
    remember(marksKey, JSON.stringify(next));
  };

  const addBookmark = () => {
    const spot = readSpot();
    saveBookmarks([
      ...bookmarks,
      { id: Date.now(), at: spot.at, off: spot.off, name: bookmarkName.trim() },
    ]);
    setBookmarkName("");
    setNavTab("bookmarks");
  };

  const goBookmark = (mark: Bookmark) => {
    jumpTo(mark.at, mark.off);
  };

  if (failed) {
    return (
      <p className="note" id="rd-msg">
        {failed}
      </p>
    );
  }
  if (!spine) {
    return (
      <p className="note" id="rd-msg">
        Opening&hellip;
      </p>
    );
  }

  return (
    <div id="rd-epub" style={{
      "--rd-sheet-height": `${sheetHeight}px`,
      "--rd-page-width": pageWidth ? `${pageWidth}px` : "100%",
    } as CSSProperties}>
      <ReaderFind units={count} text={async (unit) => {
        let html = chapterCache.current.get(unit);
        if (html === undefined) {
          const part = await api.chapter(f, unit);
          if (part.error) throw new Error(part.error);
          html = part.html ?? "";
          chapterCache.current.set(unit, html);
        }
        const template = document.createElement("template");
        template.innerHTML = html;
        return searchableText(template.content);
      }} reveal={async ({ unit, occurrence }, query, signal) => {
        if (currentAt.current !== unit || !landed.current) jumpTo(unit);
        const chapter = await waitForFind(() => {
          if (!landed.current || currentAt.current !== unit) return null;
          const element = flow ? document.getElementById("rd-ch-" + unit) : page.current?.firstElementChild;
          return element && !element.querySelector(".rd-epub-measure") ? element : null;
        }, signal);
        if (!chapter || signal.aborted) return;
        const range = matchRange(chapter, query, occurrence);
        if (!range) return;
        if (!flow) {
          const sheet = range.startContainer.parentElement?.closest(".rd-epub-sheet");
          const index = visiblePages.current.findIndex((entry) => entry === sheet);
          if (index >= 0) {
            visiblePages.current.forEach((entry, n) => { entry.hidden = n !== index; });
            currentPage.current = index;
            setPageNumber(index);
            remember(offKey, (index / visiblePages.current.length).toFixed(4));
          }
        }
        showFindRange(range);
      }} />
      <button type="button" className="rd-epub-reopen" hidden={navOpen}
        onClick={() => setNavOpen(true)} aria-controls="rd-epub-nav" aria-expanded={navOpen}>
        &#9776; Contents
      </button>
      <div className={`rd-epub-layout${navOpen ? " side-open" : ""}`}>
        <aside id="rd-epub-nav" aria-label="EPUB chapters" hidden={!navOpen}>
          <div className="rd-epub-controls">
            <div className="rd-epub-control-head">
              <strong>Reading</strong>
              <details className="rd-reader-settings">
                <summary aria-label="Reader settings" title="Reader settings">
                  <span aria-hidden="true">⚙</span>
                </summary>
                <div className="rd-reader-settings-menu">
                  <span>Reading mode</span>
                  <button type="button" className="rd-epub-mode" id="rd-flow" onClick={toggleFlow}>
                    {flow ? "Show one page" : "Long scroll"}
                  </button>
                </div>
              </details>
              <button type="button" onClick={() => setNavOpen(false)} aria-label="Hide reader sidebar" title="Hide sidebar">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
              </button>
            </div>
            <label htmlFor="rd-pick">Chapter</label>
            <select id="rd-pick" value={String(at)} onChange={(e) => go(Number(e.target.value))}>
              {chapters.map((c) => (
                <option key={c.i} value={String(c.i)}>{c.i + 1}. {c.label}</option>
              ))}
            </select>
            <div className="rd-epub-page-turn">
              <button type="button" id="rd-prev" disabled={!bookTotal || bookPage <= 1} onClick={() => turnPage(-1)} aria-label="Previous page">&#8249;</button>
              <span aria-live="polite">{bookTotal ? `Page ${bookPage} of ${bookTotal}` : "Counting pages…"}</span>
              <button type="button" id="rd-next" disabled={!bookTotal || bookPage >= bookTotal} onClick={() => turnPage(1)} aria-label="Next page">&#8250;</button>
            </div>
            <form className="rd-epub-page-jump" onSubmit={(event) => { event.preventDefault(); goPage(Number(pageInput)); }}>
              <label htmlFor="rd-page-number">Go to page</label>
              <div>
                <input id="rd-page-number" type="number" min="1" max={bookTotal || undefined}
                  value={pageInput} disabled={!bookTotal} onChange={(event) => setPageInput(event.target.value)} />
                <button type="submit" disabled={!bookTotal}>Go</button>
              </div>
            </form>
            <span className="rd-epub-progress">Chapter {at + 1} of {count}</span>
          </div>
          <div className="rd-history" aria-label="Reading jump history">
            <button type="button" disabled={!travel.back} onClick={historyBack} aria-label="Back to previous reading position" title="Back to previous reading position">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-2" /></svg>
            </button>
            <button type="button" disabled={!travel.forward} onClick={historyForward} aria-label="Forward to next reading position" title="Forward to next reading position">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 14 5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h2" /></svg>
            </button>
          </div>
          <div className="rd-epub-tabs" role="tablist" aria-label="EPUB navigation views">
            <button type="button" role="tab" aria-selected={navTab === "chapters"} onClick={() => setNavTab("chapters")}>Chapters</button>
            <button type="button" role="tab" aria-selected={navTab === "bookmarks"} onClick={() => setNavTab("bookmarks")}>Bookmarks</button>
          </div>
          <nav hidden={navTab !== "chapters"}>
            {chapters.map((chapter) => (
              <button
                type="button"
                key={chapter.i}
                className={chapter.i === at ? "current" : ""}
                onClick={() => go(chapter.i)}
                title={`Chapter ${chapter.i + 1}`}
              >
                <span>{chapter.i + 1}</span>
                {chapter.label}
              </button>
            ))}
          </nav>
          <section className="rd-bookmarks" aria-label="EPUB bookmarks" hidden={navTab !== "bookmarks"}>
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
                    <button type="button" className="rd-bookmark-jump" title={mark.name || `Chapter ${mark.at + 1}`}
                      onClick={() => goBookmark(mark)}>
                      <b>{mark.name || `Chapter ${mark.at + 1}`}</b>
                      {mark.name ? <span>Chapter {mark.at + 1}</span> : null}
                    </button>
                    <button type="button" className="rd-bookmark-delete" aria-label={`Delete ${mark.name || `Chapter ${mark.at + 1}`}`} title="Delete bookmark" onClick={() => saveBookmarks(bookmarks.filter((item) => item.id !== mark.id))}>&times;</button>
                  </div>
                ))}
              </div>
            ) : <div className="rd-bookmark-empty">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-3.8L6 21V4.75Z" /></svg>
              <b>No bookmarks</b>
              <span>Save this chapter to return to it later.</span>
            </div>}
          </section>
        </aside>
        <div id="rd-page" className={flow ? "rd-flow" : undefined}>
          <div ref={page} />
          <div className="rd-epub-index" ref={measure} aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
