/**
 * The dictionary page's behaviour: a port of DICT_JS in dictpage.py.
 *
 * The markup is in Dictionary.tsx and the look in dictionary.css; everything
 * that happens once a word is looked up happens here. It is written the way
 * the old page was -- one closure over a little shared state, filling six
 * panes by hand -- because that is what a port is. The panes are canvas and
 * SVG work with a stroke player in the middle of them; there is no version of
 * this that is a list of props.
 *
 * The data comes from /api/central/dict, whose shape is in ./types.
 */
import type { CharInfo, DictData, Entry, Related, TreeNode } from "./types";
import { defIn, entryDisplay } from "./text";
import { dictionaryHsk } from "./hsk";
import { watchStudy } from "../hsk/study";
import { pinyinPieces, pyPlaySeq } from "./pinyin";
import { queryLabel, searchMode, searchModes, searchParams } from "./search";
import { convertScriptText } from "../read/scriptMode";
import {
  favoriteKey,
  readFavorites,
  setFavorite,
  watchFavorites,
  type Favorite,
  type Starred,
} from "./favorites";

/* hanzi-writer is loaded from /dictdata at first use and sets a global; it
   has no types here, and inventing them would be a second description of a
   library the app only borrows. */
/* eslint-disable @typescript-eslint/no-explicit-any */
const W = window as any;

/* The old page ran once, because a page was loaded once. A React effect is
   not: StrictMode runs it twice in development, and twice would give every
   click two listeners and every stroke box a twin. */
declare global {
  interface Window {
    __ccDictionaryLookup?: (url: URL) => void;
  }
}

let started = false;

/** Wire up the dictionary. Runs once. */
export function startDictionary(): void {
  if (started) return;
  started = true;
  run();
}

function run(): void {
  const el = <T extends Element = HTMLElement>(s: string) =>
    document.querySelector(s) as T;
  let DATA: DictData | null = null;
  let activeSearch: URLSearchParams | undefined;
  let refreshHsk: (() => void) | undefined;
  watchStudy(() => refreshHsk?.());
  let TAB = "word";
  let MODE = "animate";
  let SPEED = 1;
  let SCRIPT = "simp"; // which script the tables speak
  function scriptOf(simp: string, trad: string): string {
    return SCRIPT === "trad" && trad ? trad : simp;
  }
  /**
   * A definition, in the script the tables are speaking.
   *
   * CC-CEDICT writes a cross-reference inside a definition as
   * `traditional|simplified[pinyin]`, and both halves were being printed --
   * so a table set to Simplified still read "as in 回來|回来[huí lái]". The
   * toggle is a toggle, so only the side in force is kept. A reference whose
   * two forms are the same is written without a bar and is left alone.
   */
  function defText(s: string | null | undefined): string {
    // How a reference is found is in ./text, shared with the pages that
    // print these definitions outside the dictionary.
    return defIn(s, SCRIPT);
  }
  function paintScript(): void {
    document.querySelectorAll<HTMLElement>("#script-toggle button").forEach((b) => {
      b.classList.toggle("here", b.dataset.s === SCRIPT);
    });
    document.querySelectorAll<HTMLElement>("#d-tabs .zh, .d-ranks .zh").forEach((label) => {
      label.textContent = SCRIPT === "trad" ? label.dataset.trad ?? "" : label.dataset.simp ?? "";
    });
  }
  document.querySelectorAll<HTMLElement>("#script-toggle button").forEach((b) => {
    b.addEventListener("click", () => {
      if (SCRIPT === b.dataset.s) return;
      SCRIPT = b.dataset.s!;
      paintScript();
      fetch("/api/central/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: SCRIPT }),
      }).catch(() => {});
      if (DATA && (DATA.q || activeSearch)) look(DATA.q, false, TAB, ENT, false, undefined, undefined, "refresh", activeSearch);
    });
  });
  // The stroke speed lives on disk with the rest of the user's data.
  fetch("/api/central/prefs", { cache: "no-store" })
    .then((r) => r.json())
    .then((p: any) => {
      const v = Number(p.strokeSpeed);
      if (v >= 0.25 && v <= 3) {
        SPEED = v;
        const r2 = document.querySelector<HTMLInputElement>(".sk-speed input");
        if (r2) {
          r2.value = String(SPEED);
          (r2.nextSibling as Text).textContent = SPEED + "×";
        }
      }
      if ((p.script === "trad" || p.script === "simp") && p.script !== SCRIPT) {
        SCRIPT = p.script;
        paintScript();
        if (DATA && (DATA.q || activeSearch)) look(DATA.q, false, TAB, ENT, false, undefined, undefined, "refresh", activeSearch);
      }
    })
    .catch(() => {});
  const TABS = ["word", "thesaurus", "examples", "strokes", "character", "etymology"];

  /* ---- favourites ----
     The starred words, as keys, so a star knows whether it is lit without
     asking the server every time a word is drawn. Refreshed from the server
     once, and from any other tab that changes them (see ./favorites). */
  let FAVS = new Set<string>();
  /** Repaints the star on screen, if there is one. */
  let paintStar: (() => void) | null = null;
  function takeFavorites(list: Favorite[]): void {
    FAVS = new Set(list.map((f) => favoriteKey(f.s, f.p)));
    if (paintStar) paintStar();
  }
  readFavorites().then(takeFavorites).catch(() => {});
  watchFavorites(takeFavorites);

  const STAR_PATH =
    "M12 2.8l2.83 5.74 6.33.92-4.58 4.47 1.08 6.3L12 17.25l-5.66 2.98 1.08-6.3-4.58-4.47 6.33-.92z";
  /** The star in a headword box's corner, for this word at this reading. */
  function favStar(fav: Starred): HTMLButtonElement {
    const key = favoriteKey(fav.s, fav.p);
    const b = document.createElement("button");
    b.type = "button";
    b.className = "d-star";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", STAR_PATH);
    svg.appendChild(path);
    b.appendChild(svg);
    function paint() {
      const on = FAVS.has(key);
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.title = on ? "Remove from favorites" : "Add to favorites";
      b.setAttribute("aria-label", b.title);
    }
    paint();
    paintStar = () => {
      if (document.contains(b)) paint();
    };
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const on = !FAVS.has(key);
      // Lit at once, and put back if the server will not keep it.
      if (on) FAVS.add(key);
      else FAVS.delete(key);
      paint();
      setFavorite(fav, on)
        .then(takeFavorites)
        .catch(() => {
          if (on) FAVS.delete(key);
          else FAVS.add(key);
          paint();
        });
    });
    return b;
  }

  // Word pages visited in this dictionary tab, with their last reading and position.
  interface Step {
    q: string;
    tab: string;
    ent: number | null;
    y: number;
  }
  type TrailUpdate = "visit" | "return" | "refresh";
  let trail: Step[] = [];

  function onWordPage(): boolean {
    return !!(DATA?.q && !DATA.error && !DATA.segments && DATA.chars?.length &&
      (DATA.entries.length <= 1 || ENT != null));
  }

  const results = el("#d-results");
  /** How this page stands right now, for the trail and for history.state. */
  function stepHere(): Step {
    return { q: (DATA && DATA.q) || "", tab: TAB, ent: ENT, y: results.scrollTop };
  }
  function saveWord(step: Step, update: TrailUpdate): void {
    if (!onWordPage()) return;
    const index = trail.findIndex((item) => item.q === step.q);
    if (update === "refresh") {
      if (index >= 0) trail[index] = step;
      return;
    }
    // Back/Forward can revisit a word without reviving a cleared crumb.
    if (index < 0 && update === "return") return;
    if (index >= 0) trail.splice(index, 1);
    trail.push(step);
  }

  /**
   * Where the next lookup should come to rest, once it has drawn.
   *
   * Not applied when it is set: `look` fetches, and the panes are not their
   * final height until they have been written and laid out. Set here, spent
   * in `land` at the end of a render.
   */
  let LANDAT: number | null = null;
  function land(): void {
    const y = LANDAT;
    LANDAT = null;
    if (y == null) return;
    /* Three times over, and not out of superstition. The panes are written
       synchronously but measured by the browser afterwards, so a scroll set
       in the same turn is clamped against a page that is still short. The
       frame after is right for everything the render already had; the last
       one is for the strokes tab, whose squares size themselves when their
       character data arrives. Setting the same number again costs nothing
       and is invisible when it was already there. */
    const put = () => {
      results.scrollTop = y;
    };
    put();
    if (y === 0) return;
    requestAnimationFrame(put);
    setTimeout(put, 160);
  }

  const crumbBar = el("#d-crumbs");
  let fitCrumbs: (() => void) | undefined;
  new ResizeObserver(() => fitCrumbs?.()).observe(crumbBar);
  crumbBar.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const overflow = crumbBar.querySelector<HTMLDetailsElement>("details[open]");
    if (!overflow) return;
    event.stopPropagation();
    overflow.open = false;
    overflow.querySelector("summary")?.focus();
  });
  document.addEventListener("pointerdown", (event) => {
    const overflow = crumbBar.querySelector<HTMLDetailsElement>("details[open]");
    if (overflow && event.target instanceof Node && !overflow.contains(event.target)) {
      overflow.open = false;
    }
  });

  function renderCrumbs(): void {
    const bar = crumbBar;
    bar.innerHTML = "";
    fitCrumbs = undefined;
    const current = onWordPage() ? DATA!.q : "";
    if (!trail.some((step) => step.q !== current)) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const overflow = document.createElement("details");
    overflow.className = "dcrumb-overflow";
    const summary = document.createElement("summary");
    summary.className = "dcrumb";
    summary.textContent = "…";
    summary.title = "Earlier visits";
    summary.setAttribute("aria-label", summary.title);
    const menu = document.createElement("div");
    menu.className = "dcrumb-menu";
    overflow.append(summary, menu);
    bar.appendChild(overflow);

    // After Clear, Back can show a word that is outside the new trail.
    const words = current && !trail.some((step) => step.q === current) ? [...trail, stepHere()] : trail;
    const crumbs: { crumb: HTMLElement; menuLink: HTMLAnchorElement }[] = [];
    words.forEach((s, index) => {
      const crumb = document.createElement("span");
      crumb.className = "dcrumb-step";
      const sep = document.createElement("span");
      sep.className = "dcrumb-sep";
      sep.textContent = "›";
      sep.setAttribute("aria-hidden", "true");
      if (s.q === current) {
        crumb.classList.add("dcrumb-current");
        const here = document.createElement("span");
        here.className = "dcrumb here";
        here.textContent = current;
        here.title = current;
        here.setAttribute("aria-current", "page");
        crumb.appendChild(here);
      } else {
        const a = document.createElement("a");
        a.href = wordPageUrl(s);
        a.className = "dcrumb";
        a.textContent = s.q;
        a.title = s.q;
        const goBack = (ev: MouseEvent) => {
          if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
          ev.preventDefault();
          overflow.open = false;
          LANDAT = s.y;
          look(s.q, true, s.tab, s.ent, false);
        };
        a.addEventListener("click", goBack);
        const menuLink = a.cloneNode(true) as HTMLAnchorElement;
        menuLink.addEventListener("click", goBack);
        menu.appendChild(menuLink);
        crumb.appendChild(a);
        crumbs.push({ crumb, menuLink });
      }
      if (index < words.length - 1) crumb.appendChild(sep);
      bar.appendChild(crumb);
    });
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "dcrumb-reset";
    reset.title = "Reset breadcrumbs";
    reset.setAttribute("aria-label", reset.title);
    reset.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10a8 8 0 1 1 1.8 7M4 4v6h6"/></svg>';
    reset.onclick = () => {
      trail = [];
      saveWord(stepHere(), "visit");
      renderCrumbs();
      el<HTMLInputElement>("#d-q").focus();
    };
    bar.appendChild(reset);
    fitCrumbs = () => {
      overflow.hidden = true;
      crumbs.forEach(({ crumb, menuLink }) => {
        crumb.hidden = false;
        menuLink.hidden = true;
      });
      const right = bar.getBoundingClientRect().right - parseFloat(getComputedStyle(bar).paddingRight) - bar.clientLeft;
      for (const { crumb, menuLink } of crumbs) {
        if (reset.getBoundingClientRect().right <= right + 0.5) break;
        overflow.hidden = false;
        crumb.hidden = true;
        menuLink.hidden = false;
      }
      if (overflow.hidden) overflow.open = false;
    };
    fitCrumbs();
  }

  function rememberPage(): void {
    const here = stepHere();
    saveWord(here, "refresh");
    try {
      history.replaceState({ ...history.state, y: here.y }, "");
    } catch { /* Saving the scroll position is optional. */ }
  }
  function followEntry(entry: Entry): void {
    const word = entryDisplay(entry, SCRIPT).head;
    look(word, true, "word", null, true, entry.p, entry);
  }
  function link(text: string, wholeWord = false, onOpen?: (() => void) | null): HTMLElement {
    const chars = Array.from(text);
    if (!wholeWord && chars.length !== 1 && chars.some((ch) => /\p{Script=Han}/u.test(ch))) {
      return charLinks(text);
    }
    const a = document.createElement("a");
    a.href = "/dictionary?q=" + encodeURIComponent(text);
    a.textContent = text;
    if (/\p{Script=Han}/u.test(text)) a.className = "zh-link";
    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      // A character or a word opens HERE, in the pane you are already looking
      // at, and the crumbs above the tabs are how you get back.
      //
      // It used to open a tab of its own, on the reasoning that a lookup
      // should not cost you the page you were reading. It cost something
      // else instead: in a split the new tab took the whole window, and
      // following three characters left three tabs to close.
      //
      // Ctrl-, middle- and shift-clicks are the strip's business and it has
      // already taken them, so this stays out of their way -- that is still
      // how you get a lookup into a tab of its own when you want one.
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      if (onOpen) {
        onOpen();
        return;
      }
      look(text, true, "word", null, true);
    });
    return a;
  }
  function charLinks(str: string): HTMLSpanElement {
    // Array.from splits by code point, so characters outside the BMP
    // stay whole -- a lone surrogate makes encodeURIComponent throw.
    const box = document.createElement("span");
    Array.from(str).forEach((ch) => {
      if (/\p{Script=Han}/u.test(ch)) box.appendChild(link(ch));
      else box.appendChild(document.createTextNode(ch));
    });
    return box;
  }
  function linkifyCharacters(root: Node): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const pending: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node as Text;
      if (!/\p{Script=Han}/u.test(text.data)) continue;
      if (text.parentElement?.closest("a, button, select, [role='button']")) continue;
      pending.push(text);
    }
    pending.forEach((text) => {
      const parent = text.parentNode;
      if (!parent) return;
      const fragment = document.createDocumentFragment();
      let plain = "";
      const flush = () => {
        if (!plain) return;
        fragment.appendChild(document.createTextNode(plain));
        plain = "";
      };
      Array.from(text.data).forEach((ch) => {
        if (/\p{Script=Han}/u.test(ch)) {
          flush();
          fragment.appendChild(link(ch));
        } else {
          plain += ch;
        }
      });
      flush();
      parent.replaceChild(fragment, text);
    });
  }
  // Dictionary content is assembled in several steps (and some character
  // panels arrive asynchronously), so link Han text whenever a pane changes.
  const characterLinks = new MutationObserver((records) => {
    records.forEach((record) => {
      record.addedNodes.forEach((added) => {
        if (added.parentElement?.closest("button, select, [role='button']")) return;
        if (
          added.nodeType === Node.TEXT_NODE &&
          /\p{Script=Han}/u.test(added.textContent || "")
        ) {
          const wrap = document.createElement("span");
          wrap.appendChild(added.cloneNode(true));
          linkifyCharacters(wrap);
          added.parentNode?.replaceChild(wrap, added);
        } else if (added.nodeType === Node.ELEMENT_NODE) {
          linkifyCharacters(added as Element);
        }
      });
    });
  });
  ["word", "thesaurus", "examples", "strokes", "character", "etymology"].forEach((tab) => {
    characterLinks.observe(document.querySelector("#pane-" + tab)!, {
      childList: true,
      subtree: true,
    });
  });
  function zhword(simp: string, trad: string, onOpen?: (() => void) | null): HTMLSpanElement {
    const box = document.createElement("span");
    const word = scriptOf(simp, trad);
    box.className = "zhword" + (Array.from(word).length > 6 ? " long-word" : "");
    box.appendChild(link(word, true, onOpen));
    return box;
  }

  /* Click any pinyin to hear it. How a reading is cut into syllables and
     which recording each one plays is in ./pinyin, shared with the
     favourites page. */
  function pyEl(marked: string | undefined, cls?: string): HTMLSpanElement {
    // Every syllable is its own button: a click speaks that syllable
    // alone, never the whole run.
    const s = document.createElement("span");
    s.className = "pyrun" + (cls ? " " + cls : "");
    pinyinPieces(marked).forEach(({ text, file }) => {
      if (!file) {
        s.appendChild(document.createTextNode(text));
        return;
      }
      const w = document.createElement("button");
      w.type = "button";
      w.className = "pys";
      w.textContent = text;
      w.title = "Play " + text;
      w.setAttribute("aria-label", w.title);
      w.addEventListener("click", (ev) => {
        ev.stopPropagation();
        pyPlaySeq([file]);
      });
      s.appendChild(w);
    });
    return s;
  }
  function sec(title: string): HTMLDivElement {
    const s = document.createElement("div");
    s.className = "ybsec";
    const h = document.createElement("div");
    h.className = "ybhead";
    h.textContent = title;
    s.appendChild(h);
    return s;
  }
  function table(s: HTMLElement): HTMLTableElement {
    const t = document.createElement("table");
    t.className = "ybtable";
    s.appendChild(t);
    return t;
  }
  function senseList(senses: string[]): HTMLOListElement {
    const list = document.createElement("ol");
    list.className = "dict-senses";
    for (const sense of senses) {
      if (!sense) continue;
      const item = document.createElement("li");
      item.textContent = sense;
      list.appendChild(item);
    }
    return list;
  }
  function row(
    t: HTMLTableElement,
    label: string | Node,
    value: string | Node | undefined | null,
  ): HTMLTableRowElement | null {
    if (value === "" || value == null) return null;
    const tr = document.createElement("tr");
    const lbl = document.createElement("td");
    lbl.className = "lbl";
    if (typeof label === "string") lbl.textContent = label;
    else lbl.appendChild(label);
    const td = document.createElement("td");
    if (typeof value === "string") td.textContent = value;
    else td.appendChild(value);
    tr.appendChild(lbl);
    tr.appendChild(td);
    t.appendChild(tr);
    return tr;
  }
  function bigzh(node: Node): HTMLSpanElement {
    // A cell whose whole value is characters shows them at reading size.
    const w = document.createElement("span");
    w.className = "bigzh";
    w.appendChild(node);
    return w;
  }
  function jyut(s: string): HTMLSpanElement {
    // Jyutping tone digits ride superscript: hon3 becomes hon³.
    const span = document.createElement("span");
    String(s)
      .split(/(\d+)/)
      .forEach((part, i) => {
        if (!part) return;
        if (i % 2) {
          const sup = document.createElement("sup");
          sup.textContent = part;
          span.appendChild(sup);
        } else {
          span.appendChild(document.createTextNode(part));
        }
      });
    return span;
  }
  function entryTr(
    t: HTMLTableElement,
    e: Entry,
    onOpen?: (() => void) | null,
    showHead = true,
  ): void {
    t.classList.add("entry-table");
    const display = entryDisplay(e, SCRIPT);
    const tr = document.createElement("tr");
    const a = document.createElement("td");
    a.className = "entry-word";
    const entryOpen = (display.variantOnly && display.head !== DATA?.q ? null : onOpen)
      ?? (() => followEntry(e));
    if (showHead) a.appendChild(zhword(display.head, display.head, entryOpen));
    if (entryOpen) {
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => entryOpen());
    }
    const c = document.createElement("td");
    c.textContent = display.definition;
    const under = document.createElement("div");
    under.className = "zhpy";
    under.appendChild(pyEl(e.p));
    a.appendChild(under);
    tr.appendChild(a);
    tr.appendChild(c);
    t.appendChild(tr);
  }
  /**
   * One word, with every reading it has, as a single row.
   *
   * A search of a sentence lists the words it found, and each of those rows
   * used to be `entries[0]` -- the first reading and nothing else. So 都 in a
   * sentence was "surname Du", which is the rarest of its three meanings and
   * almost never the one in front of you; the two that were wanted, dōu "all,
   * both" and dū "capital city", were sitting in the data and never drawn.
   * Searching the character on its own showed all three, so the dictionary
   * disagreed with itself depending on how you asked.
   *
   * Keep the word label once while aligning each reading with its definition
   * in the same two-column layout used by the other entry lists.
   */
  function segmentTr(t: HTMLTableElement, entries: Entry[]): void {
    const shown = new Set<string>();
    entries.forEach((e) => {
      const display = entryDisplay(e, SCRIPT);
      entryTr(t, e, null, !shown.has(display.head));
      shown.add(display.head);
    });
  }

  function note(pane: HTMLElement, text: string): void {
    const n = document.createElement("div");
    n.className = "quiet";
    n.style.padding = "4px 2px";
    n.textContent = text;
    pane.appendChild(n);
  }
  function hwbox(
    simp: string,
    trad: string,
    py: string,
    showTrad: boolean,
    onFlip?: (isTrad: boolean) => void,
  ): HTMLDivElement {
    const s = document.createElement("div");
    s.className = "ybsec hw-sec";
    const b = document.createElement("div");
    b.className = "hwbox";
    const ch = document.createElement("div");
    ch.className = "ch";
    b.appendChild(ch);
    let cur = showTrad && trad ? trad : simp;
    function paintHw() {
      ch.innerHTML = "";
      ch.appendChild(charLinks(cur));
    }
    paintHw();
    if (py) {
      const p = document.createElement("div");
      p.className = "py";
      p.appendChild(pyEl(py));
      b.appendChild(p);
    }
    s.appendChild(b);
    if (trad && trad !== simp) {
      // A local view flip only: it neither reads nor writes the global
      // script toggle, and touches nothing beyond this box.
      const tg = document.createElement("div");
      tg.className = "hw-toggle";
      const btns: Record<string, HTMLButtonElement> = {};
      ([["Simplified", "simp"], ["Traditional", "trad"]] as [string, string][]).forEach((o) => {
        const tb = document.createElement("button");
        tb.type = "button";
        tb.textContent = o[0];
        tb.addEventListener("click", () => {
          const want = o[1] === "trad" ? trad : simp;
          if (cur === want) return;
          cur = want;
          paintHw();
          paintTg();
          if (onFlip) onFlip(cur === trad);
        });
        btns[o[1]] = tb;
        tg.appendChild(tb);
      });
      function paintTg() {
        btns.simp.classList.toggle("here", cur === simp);
        btns.trad.classList.toggle("here", cur === trad);
      }
      paintTg();
      s.appendChild(tg);
    }
    return s;
  }
  function miniStrokesSec(d: DictData, str?: string): HTMLDivElement | null {
    // With `str` the boxes follow that exact string -- the headword
    // box's local Simplified/Traditional flip hands the shown form in.
    const infos: Record<string, CharInfo> = {};
    (d.chars || []).forEach((c) => {
      infos[c.ch] = c;
    });
    let chars: CharInfo[];
    if (str) {
      const seen: Record<string, boolean> = {};
      chars = Array.from(str)
        .filter((c) => {
          if (seen[c]) return false;
          seen[c] = true;
          return !infos[c] || infos[c].stroke;
        })
        .map((c) => infos[c] || ({ ch: c } as CharInfo));
    } else {
      chars = (d.chars || []).filter((c) => c.stroke);
    }
    if (!chars.length) return null;
    const ss = sec("Stroke Order");
    let pager: HTMLDivElement | null = null;
    const units: HTMLDivElement[] = [];
    if (chars.length > 1) {
      pager = document.createElement("div");
      pager.className = "chpager mini-pager";
      ss.appendChild(pager);
    }
    const rowBox = document.createElement("div");
    rowBox.className = "mini-strokes";
    loadHW()
      .then(() =>
        // A traditional-only character isn't in the server's list, so its
        // stroke file is asked for first and the character dropped quietly
        // if there is none.
        Promise.all(
          chars.map((ci) =>
            charData(ci.ch).then(
              () => ci,
              () => null,
            ),
          ),
        ),
      )
      .then((have) => {
        const kept = (have || []).filter(Boolean) as CharInfo[];
        const sts: Box[] = [];
        kept.forEach((ci, i) => {
          const one = document.createElement("div");
          one.className = "sk-one";
          one.hidden = i !== 0;
          units.push(one);
          rowBox.appendChild(one);
          sts.push(strokeBox(one, ci, { size: 150, cap: false, fixedMode: "animate" }));
          if (pager) {
            const pb = document.createElement("button");
            pb.type = "button";
            pb.textContent = ci.ch;
            if (i === 0) pb.className = "here";
            pb.addEventListener("click", () => {
              units.forEach((u, j) => {
                u.hidden = j !== i;
              });
              Array.prototype.forEach.call(pager!.children, (x: Element, j: number) => {
                x.classList.toggle("here", j === i);
              });
              sts[i].startPlay();
            });
            pager.appendChild(pb);
          }
        });
      });
    ss.appendChild(rowBox);
    return ss;
  }
  /**
   * Everything about this one character, to sit under its own stroke player.
   *
   * All of it in the one table, and no wider than the square above it, so a
   * column is one character top to bottom: the box, the transport, then every
   * fact about it in the same set of rows. What used to be printed loose
   * under the square -- the character, how it is said, what it means -- is in
   * here as rows now, so there is one thing under a player rather than a
   * caption, a paragraph and then a table.
   *
   * The label column is narrower than the shared 148px: on a 220px player the
   * standard width leaves barely sixty pixels for the answer.
   */
  /**
   * The reading this character has in the entry that is open, if that can be
   * said at all.
   *
   * A character on its own carries every reading the dictionary has for it,
   * and the strokes page was printing all of them: open 车 at "car" and it
   * still recited Che the surname and ju the war chariot underneath the
   * square. You asked about one of them.
   *
   * The entry's pinyin is one syllable per character of its headword, so the
   * reading wanted here is the syllable in this character's place. Only when
   * those two line up, one syllable each -- an entry whose pinyin does not
   * count out against its own characters says nothing about which reading
   * belongs where, and guessing at it would be worse than showing them all.
   */
  function readingOf(d: DictData, ci: CharInfo): string {
    if (ENT == null) return "";
    const e = d.entries[ENT];
    if (!e) return "";
    const syllables = String(e.p || "").trim().split(/\s+/).filter(Boolean);
    const heads = Array.from(e.s || "");
    if (!syllables.length || heads.length !== syllables.length) return "";
    const at = d.chars.indexOf(ci);
    return at >= 0 && at < syllables.length ? syllables[at] : "";
  }
  /** A character's reading, or "" when it has more than one to choose from. */
  function soleReading(ci: CharInfo): string {
    const all = String(ci.mandarin || "").trim().split(/\s+/).filter(Boolean);
    return all.length === 1 ? all[0] : "";
  }
  function factsTable(ci: CharInfo, reading?: string): HTMLDivElement {
    const box = document.createElement("div");
    box.className = "sk-facts";
    const t = document.createElement("table");
    t.className = "ybtable";
    const ch = document.createElement("span");
    ch.className = "bigch";
    ch.appendChild(link(ci.ch));
    row(t, "Character", ch);
    /* The reading being asked about, when an entry has been opened.
       Otherwise the character's own -- but only if it has just the one.

       `ci.mandarin` is every reading Unihan lists for the character, space
       separated, and printed whole it reads as a word: 地 came out as
       "de dì", which is not how anything is pronounced. Where there are
       several and nothing has been opened to say which one you meant, the
       row comes off the table altogether. The strokes are the same whichever
       reading you are after, so nothing is lost -- and a line you have to
       know to ignore is worse than a line that is not there. */
    const say = reading || soleReading(ci);
    row(t, "Pinyin", say ? pyEl(say) : "");
    /* NO MEANINGS HERE. They were the reason this page cared which entry you
       had open: a word with several of them had to have one chosen before the
       strokes could say whose meaning to print, and 钱 is two entries deep
       before you have asked anything about how it is written. This page is
       about the shape of a character -- its radical, its count, what it is
       built from -- and the meanings are a tab away on Word, where choosing
       between them is the whole point. Taking them out is what lets the
       strokes open on any search, chosen entry or not. */
    const radbits: string[] = [];
    if (ci.radch) radbits.push(ci.radch);
    if (ci.radical) radbits.push("(#" + ci.radical + ")");
    row(t, "Kangxi Radical", radbits.join(" "));
    row(t, "Total Strokes", ci.strokes == null ? "" : String(ci.strokes));
    const db = decompBox(ci.decomp);
    if (db) row(t, "Structure", db);
    if (!t.rows.length) return box;
    box.appendChild(t);
    return box;
  }
  function radicalSec(ci: CharInfo): HTMLDivElement {
    const s = sec("Radical/Strokes");
    const t = table(s);
    const radbits: string[] = [];
    if (ci.radch) radbits.push(ci.radch);
    if (ci.radical) radbits.push("(#" + ci.radical + ")");
    row(t, "Kangxi Radical", radbits.join(" "));
    row(t, "Total Strokes", ci.strokes == null ? "" : String(ci.strokes));
    return s;
  }
  // Most fonts have no glyph for the ideographic description characters
  // (they render as hollow boxes), so draw each layout as a tiny icon.
  const IDC_RECTS: Record<string, number[][]> = {
    "⿰": [[1, 1, 6, 14], [9, 1, 6, 14]],
    "⿱": [[1, 1, 14, 6], [1, 9, 14, 6]],
    "⿲": [[1, 1, 4, 14], [6, 1, 4, 14], [11, 1, 4, 14]],
    "⿳": [[1, 1, 14, 4], [1, 6, 14, 4], [1, 11, 14, 4]],
    "⿴": [[1, 1, 14, 14], [5, 5, 6, 6]],
    "⿵": [[1, 1, 14, 14], [5, 8, 6, 7]],
    "⿶": [[1, 1, 14, 14], [5, 1, 6, 7]],
    "⿷": [[1, 1, 14, 14], [8, 5, 7, 6]],
    "⿸": [[1, 1, 14, 14], [7, 7, 8, 8]],
    "⿹": [[1, 1, 14, 14], [1, 7, 8, 8]],
    "⿺": [[1, 1, 14, 14], [7, 1, 8, 8]],
    "⿻": [[1, 1, 9, 9], [6, 6, 9, 9]],
  };
  // The official Unicode names of the ideographic description
  // characters, lowercased.
  const IDC_NAMES: Record<string, string> = {
    "⿰": "left to right", "⿱": "above to below",
    "⿲": "left to middle and right", "⿳": "above to middle and below",
    "⿴": "full surround", "⿵": "surround from above",
    "⿶": "surround from below", "⿷": "surround from left",
    "⿸": "surround from upper left", "⿹": "surround from upper right",
    "⿺": "surround from lower left", "⿻": "overlaid",
  };
  function idcIcon(ch: string): Node {
    const rects = IDC_RECTS[ch];
    if (!rects) return document.createTextNode(ch);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("class", "idcicon");
    rects.forEach((r) => {
      const q = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      q.setAttribute("x", String(r[0]));
      q.setAttribute("y", String(r[1]));
      q.setAttribute("width", String(r[2]));
      q.setAttribute("height", String(r[3]));
      q.setAttribute("fill", "none");
      q.setAttribute("stroke", "currentColor");
      q.setAttribute("stroke-width", "1.9");
      svg.appendChild(q);
    });
    const wrap = document.createElement("span");
    wrap.className = "idc";
    wrap.title = IDC_NAMES[ch] || "";
    wrap.appendChild(svg);
    return wrap;
  }
  function decompBox(decomp: string | undefined): HTMLSpanElement | null {
    if (!decomp) return null;
    const box = document.createElement("span");
    box.style.fontSize = "20px";
    const names: string[] = [];
    Array.from(decomp).forEach((ch) => {
      if (ch >= "⿰" && ch <= "⿿") {
        box.appendChild(idcIcon(ch));
        if (IDC_NAMES[ch]) names.push(IDC_NAMES[ch]);
      } else if (ch.codePointAt(0)! > 0x2e7f && ch !== "？") {
        box.appendChild(link(ch));
      } else {
        box.appendChild(document.createTextNode(ch));
      }
    });
    // The symbol says its name out loud, not only in a tooltip.
    if (names.length) {
      const q = document.createElement("span");
      q.className = "quiet";
      q.style.display = "block";
      q.style.marginTop = "3px";
      q.textContent = names.join(", ");
      box.appendChild(q);
    }
    return box;
  }
  function structureSec(list: CharInfo[] | undefined): HTMLDivElement | null {
    // One labelled row per character: with more than one character on
    // the page, each structure says which character it belongs to.
    const rows: [string, HTMLSpanElement][] = [];
    (list || []).forEach((ci) => {
      const db = decompBox(ci.decomp);
      if (db) rows.push([ci.ch, db]);
    });
    if (!rows.length) return null;
    const s = sec("Character Structure");
    const t = table(s);
    rows.forEach((r) => {
      const zw = document.createElement("span");
      zw.className = "zhword";
      zw.appendChild(link(r[0]));
      row(t, zw, r[1]);
    });
    return s;
  }

  /* ---------------- Word ---------------- */
  let ENT: number | null = null;
  function openEntry(i: number | null): void {
    rememberPage();
    ENT = i;
    saveWord(stepHere(), "visit");
    renderCrumbs();
    renderWord(DATA!);
    // The thesaurus follows the reading that is open, so it is redrawn with
    // the word rather than left showing the one that was open before.
    renderThesaurus(DATA!);
    // And so do the examples: they are sentences using this reading, not
    // sentences with this character somewhere in them.
    renderExamples(DATA!);
    putUrl();
  }
  function renderWord(d: DictData): void {
    refreshHsk = undefined;
    const pane = el("#pane-word");
    pane.innerHTML = "";
    if (!d.entries.length && !d.chars.length) {
      note(pane, "Nothing found for that.");
      return;
    }
    const cols = document.createElement("div");
    cols.className = "ybcols";
    const left = document.createElement("div");
    left.className = "ybleft";
    const right = document.createElement("div");
    right.className = "ybright";
    cols.appendChild(left);
    cols.appendChild(right);
    pane.appendChild(cols);
    // Main used to be a block of its own above the related-word cards, so
    // it took a whole line however little it held. Everything on the right
    // shares one wrapping row now: Main first, the cards alongside it, and
    // they drop to the next line only when the width runs out.
    const cards = document.createElement("div");
    cards.className = "relgrid";
    right.appendChild(cards);

    const e0 = d.entries.length ? d.entries[ENT != null ? ENT : 0] : null;
    const entryView = e0 ? entryDisplay(e0, SCRIPT) : null;
    const simp = entryView?.variantOnly ? entryView.head : e0 ? e0.s : d.q;
    const trad = entryView?.variantOnly ? entryView.head : e0 ? e0.t : "";
    // The searched script wins; otherwise the global toggle decides
    // where the local switcher starts.
    const wantTrad =
      !!(e0 && trad && d.q === trad) || !!(SCRIPT === "trad" && trad && trad !== simp);
    // On a results list no reading has been chosen yet, so the headword
    // box holds its tongue; the pinyin appears once a result is opened.
    const results = d.entries.length > 1 && ENT == null;
    const parts = d.parts_by_entry?.[ENT != null ? ENT : 0] || d.parts || [];
    const fallbackPy =
      parts.length
        ? parts.map((p) => p.py).join(" ")
        : d.chars[0]
          ? d.chars[0].mandarin || ""
          : "";
    const miniHold = document.createElement("div");
    const factsHold = document.createElement("div");
    const factsByForm = new Map<string, DictData>([[d.q, d]]);
    let detailVersion = 0;
    function paintMini(showTrad: boolean) {
      const shown = showTrad && trad ? trad : simp;
      const version = ++detailVersion;
      miniHold.innerHTML = "";
      // The row's old boxes went with it -- see sweepBoxes.
      sweepBoxes();
      const m = miniStrokesSec(d, shown);
      if (m) miniHold.appendChild(m);
      factsHold.replaceChildren();
      const paintFacts = (formData: DictData) => {
        if (version !== detailVersion) return;
        factsHold.replaceChildren();
        if (formData.chars.length === 1 && Array.from(shown).length === 1) {
          factsHold.appendChild(radicalSec(formData.chars[0]));
        }
        const structure = structureSec(formData.chars);
        if (structure) factsHold.appendChild(structure);
      };
      const cached = factsByForm.get(shown);
      if (cached) paintFacts(cached);
      else fetch("/api/central/dict?q=" + encodeURIComponent(shown))
        .then((response) => response.json())
        .then((formData: DictData) => {
          if (!formData.chars) return;
          factsByForm.set(shown, formData);
          paintFacts(formData);
        }).catch(() => {});
    }
    const hw = hwbox(
      simp,
      trad !== simp ? trad : "",
      results ? "" : e0 ? e0.p : fallbackPy,
      wantTrad,
      paintMini,
    );
    left.appendChild(hw);
    // A star once there is one word at one reading to star -- not over a list
    // of readings still to be chosen between, for the same reason the pinyin
    // is held back there.
    const hwb = hw.querySelector<HTMLElement>(".hwbox");
    const hskWords = results
      ? d.entries.filter((entry) => entry.s === d.q || entry.t === d.q).map((entry) => entry.s)
      : [e0?.s ?? d.q];
    if (hskWords.length) {
      const section = sec("HSK Prep");
      section.hidden = true;
      const list = document.createElement("div");
      section.appendChild(list);
      left.appendChild(section);
      refreshHsk = dictionaryHsk(section, list, hskWords, results ? undefined : e0?.p);
    }
    if (hwb && !results) {
      hwb.classList.add("has-star");
      hwb.appendChild(
        favStar({
          s: simp,
          t: trad !== simp ? trad : "",
          p: e0 ? e0.p : fallbackPy,
          d: e0 ? e0.d.join("; ") : d.chars.length === 1 ? d.chars[0].udef || "" : "",
        }),
      );
    }
    const one = d.chars.length === 1 && Array.from(d.q).length === 1;
    left.appendChild(factsHold);
    left.appendChild(miniHold);
    paintMini(wantTrad);
    if (parts.length) {
      const ps = sec("Word Decomposition");
      parts.forEach((p) => {
        const block = document.createElement("div");
        block.className = "word-part";
        const heading = document.createElement("div");
        heading.className = "word-part-heading";
        const character = document.createElement("span");
        character.className = "word-part-character";
        character.appendChild(link(p.ch));
        const reading = document.createElement("span");
        reading.className = "word-part-reading";
        reading.textContent = `In this word: ${p.py}`;
        heading.append(character, reading);
        block.appendChild(heading);
        p.entries.forEach((entry) => {
          const item = document.createElement("div");
          item.className = "word-part-entry";
          const py = document.createElement("span");
          py.className = "word-part-pinyin";
          py.appendChild(pyEl(entry.p));
          const definition = senseList(entry.d.map(defText));
          definition.classList.add("word-part-definition");
          item.append(py, definition);
          block.appendChild(item);
        });
        ps.appendChild(block);
      });
      left.appendChild(ps);
    }

    function measureRow(mt: HTMLTableElement) {
      const reading = d.thesaurus_by_entry?.[ENT != null ? ENT : 0];
      const words = reading?.measure || d.thesaurus?.measure || [];
      if (!words.length) return;
      const box = document.createElement("span");
      words.forEach((e, i) => {
        if (i) box.appendChild(document.createTextNode("  "));
        box.appendChild(link(e.s));
        const p = document.createElement("span");
        p.className = "quiet";
        p.textContent = " " + e.p;
        box.appendChild(p);
      });
      row(mt, "Measure Word", box);
    }

    if (d.entries.length > 1 && ENT == null) {
      /* The results list: each row opens that entry's own page.
         And nothing else. The measure word was being put on the end of it,
         where every row above it is a reading to choose between and this one
         is not -- it is a fact about the word, it belongs to no reading in
         particular, and clicking it does nothing because there is nothing for
         it to open. Choosing a reading is the only thing this list is for.
         The measure word is on the Main table once one is chosen. */
      const ms = sec("Matching Results");
      const mrt = table(ms);
      d.entries.forEach((e, i) => {
        entryTr(mrt, e, () => {
          openEntry(i);
        });
      });
      cards.appendChild(ms);
    } else {
      const main = sec("Main");
      main.className += " wide";
      const mt = table(main);
      const senses = entryView?.senses ?? (one ? [defText(d.chars[0].udef)] : []);
      const definitions = senseList(senses);
      if (definitions.childNodes.length) row(mt, "Definitions", definitions);
      measureRow(mt);
      if (one) {
        const c0 = d.chars[0];
        row(mt, "Frequency Rank", c0.rank ? "#" + c0.rank : "");
      }
      if (mt.childNodes.length) cards.appendChild(main);
      if (d.entries.length > 1) {
        const os = sec("Other Entries");
        const ot = table(os);
        d.entries.forEach((e, i) => {
          if (i === (ENT != null ? ENT : 0)) return;
          entryTr(ot, e, () => {
            openEntry(i);
          });
        });
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 2;
        const all = document.createElement("a");
        all.href = "#";
        all.textContent = "All results";
        all.addEventListener("click", (ev) => {
          ev.preventDefault();
          openEntry(null);
        });
        td.appendChild(all);
        tr.appendChild(td);
        ot.appendChild(tr);
        cards.appendChild(os);
      }
    }
    // Related words belong to ONE reading. They appear only once an
    // entry is chosen -- a results list never mixes readings.
    let rel: Related | null = null;
    if (d.entries.length > 1) {
      if (ENT != null && d.related_by_entry) rel = d.related_by_entry[ENT];
    } else if (d.related_by_entry && d.related_by_entry[0]) {
      rel = d.related_by_entry[0];
    } else {
      rel = d.related || null;
    }
    const rl: Related = rel || {};
    const relDefs: [keyof Related, string][] = [
      ["head", "Words With Same Head Word"],
      ["tail", "Words With Same Tail Word"],
      ["derived", "Derived Words or Phrases"],
      ["similar", "Similar-sounding Words"],
    ];
    if (relDefs.some((rd) => (rl[rd[0]] || []).length)) {
      relDefs.forEach((rd) => {
        const list = rl[rd[0]] || [];
        if (!list.length) return;
        const s = sec(rd[1]);
        const t = table(s);
        t.classList.add("related-table");
        list.forEach((e) => {
          entryTr(t, e);
        });
        cards.appendChild(s);
      });
    }
  }

  /* ---------------- Thesaurus ---------------- */
  /* ONE READING, ONE SENSE, ONE LIST.
     A character is not a word. 会 is huì -- to know how to, to meet, a
     gathering -- and also kuài, to reckon accounts; 行 is háng and xíng and
     héng. Every reading's synonyms used to be poured into a single "Similar
     Meaning" table with nothing to say which of the reader's own definitions
     any row answered, so the accountancy word sat beside the meeting word.
     Senses are split for the same reason: "to meet" and "meeting" are two
     words in English too. It is the rule the Word tab already keeps for
     related words -- they belong to one reading, and a list never mixes
     readings. */
  function renderThesaurus(d: DictData): void {
    const pane = el("#pane-thesaurus");
    pane.innerHTML = "";
    const cards = document.createElement("div");
    cards.className = "relgrid";
    const byEntry = d.thesaurus_by_entry || [];

    // The reading the reader has open, when they have opened one.
    let show = byEntry;
    if (ENT != null && byEntry[ENT]) show = [byEntry[ENT]];

    // The reading is only worth naming when there is more than one to tell
    // apart; on an ordinary word it would be a label on the obvious.
    const named = show.length > 1;
    const title = (py: string, what: string) =>
      named && py ? py + "  ·  " + what : what;

    let any = false;
    show.forEach((ent) => {
      (ent.senses || []).forEach((sn) => {
        if (!sn.similar || !sn.similar.length) return;
        any = true;
        const s = sec(title(ent.py, sn.gloss));
        const t = table(s);
        sn.similar.forEach((e) => entryTr(t, e));
        cards.appendChild(s);
      });
      ([["See Also", ent.seealso], ["Measure Words", ent.measure]] as
        [string, Entry[]][]).forEach((pair) => {
        if (!pair[1] || !pair[1].length) return;
        any = true;
        const s = sec(title(ent.py, pair[0]));
        const t = table(s);
        pair[1].forEach((e) => entryTr(t, e));
        cards.appendChild(s);
      });
    });

    if (any) pane.appendChild(cards);
    else note(pane, "No thesaurus entries for this word.");
  }

  /* ---------------- Examples ---------------- */
  /** The readings this word has, once each, however many entries carry them. */
  function readings(d: DictData): string[] {
    const out: string[] = [];
    (d.entries || []).forEach((e) => {
      if (e.p && !out.some((r) => sameReading(r, e.p))) out.push(e.p);
    });
    return out;
  }
  /** The marks are the reading; the spacing and the capital are not. */
  function sameReading(a: string, b: string): boolean {
    return (
      String(a).replace(/\s+/g, "").toLowerCase() ===
      String(b).replace(/\s+/g, "").toLowerCase()
    );
  }

  function renderExamples(d: DictData): void {
    const pane = el("#pane-examples");
    pane.innerHTML = "";
    const all = d.examples || [];
    if (!all.length) {
      note(pane, "No example sentences for this word.");
      return;
    }
    const open = ENT != null ? d.entries[ENT] : null;
    const want = open && readings(d).length > 1 ? open.p : "";
    if (!want) {
      renderSet("Example Sentences", all);
      return;
    }
    renderSet("Example Sentences", all.filter((pair) => pair[2] && sameReading(pair[2], want)));
    renderSet("Examples · Reading Unconfirmed", all.filter((pair) => !pair[2]));
    renderSet("Examples · Other Readings", all.filter((pair) => pair[2] && !sameReading(pair[2], want)), true);

    function renderSet(heading: string, examples: NonNullable<DictData["examples"]>, showReading = false): void {
      if (!examples.length) return;
      const s = sec(heading);
      const t = table(s);
      examples.forEach((pair) => {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        const zh = document.createElement("span");
        zh.className = "ex-zh";
        const sentence = convertScriptText(pair[0], SCRIPT as "simp" | "trad");
        const query = convertScriptText(d.q, SCRIPT as "simp" | "trad");
        const parts = sentence.split(query);
        parts.forEach((chunk, i) => {
          if (i) {
            const b = document.createElement("b");
            b.textContent = query;
            zh.appendChild(b);
          }
          zh.appendChild(document.createTextNode(chunk));
        });
        td.appendChild(zh);
        if (showReading && pair[2]) {
          const reading = document.createElement("span");
          reading.className = "ex-en";
          reading.textContent = pair[2];
          td.appendChild(reading);
        }
        const en = document.createElement("span");
        en.className = "ex-en";
        en.textContent = pair[1];
        td.appendChild(en);
        tr.appendChild(td);
        t.appendChild(tr);
      });
      pane.appendChild(s);
    }
  }

  /* ---------------- Strokes: writer + transport ---------------- */
  interface Box {
    w: any;
    pos: number;
    total: number;
    playing: boolean;
    mid: boolean;
    pausedMid: boolean;
    run: number;
    /**
     * One stroke attempt.
     *
     * `run` is not enough on its own, and that was the bug behind every
     * "it raced to the end and skipped ten strokes". A run keeps the same id
     * for the whole character, so the stop-loss timer armed for stroke 0 was
     * still a live, matching timer when stroke 11 was drawing -- it fired,
     * declared the stroke stuck, advanced past it and started a second chain
     * over the top of the first. This changes on every stroke, so a timer
     * only ever speaks for the stroke that armed it.
     */
    tick: number;
    restart: boolean;
    midSince: number;
    /** Retired: its pane has been rebuilt out from under it. */
    dead: boolean;
    /** The markup it drew into, so a detached box can be spotted. */
    host: HTMLElement;
    /** Repeating is opt-in through the auto-repeat button. */
    repeat: boolean;
    applySpeed: () => void;
    ready: () => boolean;
    stop: () => void;
    startPlay: () => void;
    make: () => void;
    retire: () => void;
  }
  interface BoxOpts {
    size?: number;
    cap?: boolean;
    fixedMode?: string;
    /** Something more for this character's column, under its caption. */
    after?: () => HTMLElement;
    onManual?: () => void;
    onDone?: () => void;
    /** Play was pressed on this box: it, and only it, is the performance. */
    onPlay?: () => void;
    /** Pause was pressed on this box. Not fired when another box takes over. */
    onStop?: () => void;
  }
  let hwReady: Promise<void> | null = null;
  const dataCache: Record<string, Promise<any>> = {};
  const BOXREG: Box[] = []; // every live stroke box; playback is exclusive
  /** The breath between one time through and the next. */
  const REPEAT_GAP = 700;
  /**
   * Boxes whose markup has gone.
   *
   * The registry used to keep every box ever made. Both places that make them
   * rebuild freely -- the Strokes tab on every visit and every lookup, the
   * headword's mini row on every Simplified/Traditional flip -- so a session
   * filled the registry with boxes drawing into markup nobody could see, each
   * still holding a writer. That is not merely a leak: a dead box that was
   * still playing went on calling `stopOthers`, and stopped the box the user
   * was actually watching. Anything no longer in the document is retired.
   */
  function sweepBoxes(): void {
    BOXREG.slice().forEach((b) => {
      if (!document.contains(b.host)) b.retire();
    });
  }
  function loadHW(): Promise<void> {
    if (hwReady) return hwReady;
    hwReady = new Promise((ok, bad) => {
      const s = document.createElement("script");
      s.src = "/dictdata/hanzi-writer.min.js";
      s.onload = () => ok();
      s.onerror = () => bad(new Error("hanzi-writer did not load"));
      document.head.appendChild(s);
    });
    return hwReady;
  }
  function charData(c: string): Promise<any> {
    if (!dataCache[c])
      dataCache[c] = fetch("/dictdata/strokes/" + encodeURIComponent(c) + ".json")
        .then((r) => {
          if (!r.ok) throw new Error("no stroke data for " + c);
          return r.json();
        })
        .catch((e) => {
          // A failure is not cached. Otherwise one dropped request means that
          // character has no strokes for the life of the page -- a box that
          // stays blank, with nothing said and nothing to retry.
          delete dataCache[c];
          throw e;
        });
    return dataCache[c];
  }
  function icon(kind: string): SVGSVGElement {
    const P: Record<string, string> = {
      play: "M8 5v14l11-7z",
      pause: "M7 5h3.5v14H7z M13.5 5H17v14h-3.5z",
      next: "M5 6v12l8-6z M15 6h2v12h-2z",
      back: "M19 6v12l-8-6z M7 6h2v12H7z",
      // The usual "start over" ring, drawn anticlockwise so it does not read
      // as another step control beside the two that are.
      reset: "M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z",
      repeat: "M7 7h12l-3-3 1.5-1.5L23 8l-5.5 5.5L16 12l3-3H7v4H5V9a2 2 0 0 1 2-2z M17 17H5l3 3-1.5 1.5L1 16l5.5-5.5L8 12l-3 3h12v-4h2v4a2 2 0 0 1-2 2z",
    };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    P[kind].split(" M").forEach((dd, i) => {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", (i ? "M" : "") + dd);
      p.setAttribute("fill", "currentColor");
      svg.appendChild(p);
    });
    return svg;
  }
  function strokeBox(one: HTMLElement, ci: CharInfo, opts?: BoxOpts): Box {
    const o: BoxOpts = opts || {};
    const size = o.size || 220;
    function mmode(): string {
      return o.fixedMode || MODE;
    }
    const cell = document.createElement("div");
    cell.className = "sk-cell";
    cell.style.width = size + "px";
    cell.style.height = size + "px";
    one.appendChild(cell);
    const ctl = document.createElement("div");
    ctl.className = "sk-ctl";
    one.appendChild(ctl);
    if (o.cap !== false) {
      const cap = document.createElement("div");
      cap.className = "sk-cap";
      cap.appendChild(link(ci.ch));
      cap.appendChild(pyEl(ci.mandarin, "py"));
      one.appendChild(cap);
      // The meaning rides under the box; a character with several
      // readings gets a line per reading, each named by its pinyin.
      const defs =
        ci.defs && ci.defs.length
          ? ci.defs.map((de) => ({ p: de.p, d: defText(de.d.join("; ")) }))
          : ci.udef
            ? [{ p: "", d: defText(ci.udef) }]
            : [];
      if (defs.length) {
        const dv = document.createElement("div");
        dv.className = "sk-def";
        defs.forEach((x) => {
          const line = document.createElement("div");
          if (x.p && defs.length > 1) {
            line.appendChild(pyEl(x.p, "py"));
            line.appendChild(document.createTextNode(" — " + x.d));
          } else {
            line.textContent = x.d;
          }
          dv.appendChild(line);
        });
        one.appendChild(dv);
      }
    }
    // Whatever else belongs in this character's column, under what it means.
    if (o.after) one.appendChild(o.after());

    const st = {
      w: null as any, pos: 0, total: 0, playing: false, mid: false,
      pausedMid: false, run: 0, tick: 0, restart: false, midSince: 0,
      dead: false, host: one, repeat: false,
    } as Box;
    const backB = document.createElement("button");
    const playB = document.createElement("button");
    const nextB = document.createElement("button");
    // Last, after the three that move by one, because it is the odd one out:
    // back and next walk the character, this one throws the attempt away.
    const resetB = document.createElement("button");
    const repeatB = document.createElement("button");
    [backB, playB, nextB, resetB, repeatB].forEach((b) => {
      b.type = "button";
      b.className = "skbtn";
    });
    backB.title = "Back one stroke";
    playB.title = "Play / pause";
    nextB.title = "Next stroke";
    resetB.title = "Start over: clear the character";
    repeatB.title = "Auto-repeat";
    repeatB.setAttribute("aria-label", "Auto-repeat character");
    repeatB.setAttribute("aria-pressed", "false");
    backB.appendChild(icon("back"));
    playB.appendChild(icon("play"));
    nextB.appendChild(icon("next"));
    resetB.appendChild(icon("reset"));
    repeatB.appendChild(icon("repeat"));
    /* Which icon is on the play button now, so it is only ever redrawn when
       it has actually changed. See paint. */
    let shown = "play";
    const count = document.createElement("span");
    count.className = "sk-count";
    ctl.appendChild(backB);
    ctl.appendChild(playB);
    ctl.appendChild(nextB);
    ctl.appendChild(resetB);
    ctl.appendChild(repeatB);
    ctl.appendChild(count);

    function fixClips() {
      // The writer writes clip-path refs as absolute URLs frozen at
      // creation time; one pushState later they stop resolving and the
      // strokes render as unclipped fat median lines. Local fragment
      // refs survive any URL change.
      cell.querySelectorAll("[clip-path]").forEach((p) => {
        const v = p.getAttribute("clip-path") || "";
        const m2 = v.match(/#([^")]+)/);
        if (m2 && v !== "url(#" + m2[1] + ")") p.setAttribute("clip-path", "url(#" + m2[1] + ")");
      });
    }
    /**
     * THE BUTTON THAT HAD TO BE PRESSED TWICE.
     *
     * This threw the icon away and made a new one every time it ran -- and it
     * runs on every stroke, several times a second while a character draws.
     * A click is only delivered if the press and the release agree on what
     * was clicked, and the browser will not deliver one at all when the thing
     * pressed has been taken out of the document in between. So a repaint
     * landing between your finger going down and coming up ate the press,
     * every time it happened.
     *
     * Pause is the only button anyone presses WHILE the animation is running,
     * which is the only time this is firing over and over. That is why it was
     * always the pause button, and why pressing it again worked: the second
     * press had a fresh icon to land on and usually got through.
     *
     * Measured rather than reasoned about: a button whose child is replaced
     * during mousedown gets the mousedown and no click; leave the child alone
     * and the click arrives. So the icon is only redrawn when it changes,
     * which is twice a cycle instead of once a stroke -- and `.skbtn svg` is
     * pointer-events:none as well, so the button itself is always what was
     * pressed and there is nothing under the finger that can be taken away.
     */
    function paint() {
      fixClips();
      repeatB.setAttribute("aria-pressed", String(st.repeat));
      count.textContent = st.pos + " / " + st.total;
      const want = st.playing ? "pause" : "play";
      if (want === shown) return;
      shown = want;
      playB.innerHTML = "";
      playB.appendChild(icon(want));
    }
    // Instant, animation-free display of the first n strokes -- stepping
    // must not depend on animation timing.
    function setShown(n: number) {
      if (!st.w || !st.w._renderState) return;
      // Never outside the character. A completion arriving after the
      // position had already moved used to push it past the last stroke,
      // and 9 / 8 is a box that will not step and will not play.
      n = Math.max(0, Math.min(st.total, n | 0));
      const upd: any = { character: { main: { opacity: 1, strokes: {} } } };
      for (let i = 0; i < st.total; i++)
        upd.character.main.strokes[i] =
          i < n ? { opacity: 1, displayPortion: 1 } : { opacity: 0, displayPortion: 0 };
      st.w._renderState.updateState(upd);
      st.pos = n;
      paint();
    }
    const NOW = () => new Date().getTime();
    /**
     * How long one stroke is given before it is written off as stuck.
     *
     * It has to follow the speed, or the slow end of the slider trips the
     * stop-loss on strokes that are drawing perfectly well. At 1x and above
     * it is ten seconds, which no single stroke comes near.
     */
    const capMs = () => 10000 / Math.min(1, SPEED || 1);
    /**
     * Stop the writer drawing, for real.
     *
     * `cancelAnimation()` is not a method of the hanzi-writer we ship -- the
     * call it used to make threw on every use and was swallowed, so nothing
     * was ever cancelled. The animation went on writing the render state that
     * the next `setShown` had just written, which is the box half-drawn, the
     * strokes on top of each other, and the transport out of step with the
     * picture. The render state's own `cancelAll` is what does it, and it
     * settles the pending animation as cancelled -- which `landed` reads.
     */
    function cancelDraw() {
      try {
        if (st.w && typeof st.w.cancelAnimation === "function") {
          st.w.cancelAnimation();
          return;
        }
        const rs = st.w && st.w._renderState;
        if (rs && typeof rs.cancelAll === "function") rs.cancelAll();
        else if (rs && typeof rs.cancelMutations === "function") rs.cancelMutations(["character"]);
      } catch (e) { /* nothing drawing: the ticket still guards */ }
    }
    function abandon() {
      // Tell the writer to stop, rather than only stopping listening to it.
      // Left running, it goes on writing the same render state that the
      // next click's animation writes, and a few clicks in they are drawing
      // over each other and it sticks.
      st.run++;
      st.tick++;
      st.mid = false;
      st.playing = false;
      st.pausedMid = false;
      st.restart = false;
      cancelDraw();
    }
    function stopOthers() {
      sweepBoxes();
      BOXREG.forEach((b) => {
        if (b !== st && !b.dead) b.stop();
      });
    }
    /**
     * Whether a writer callback belongs to the here and now.
     *
     * `res.canceled` is the half that was missing, and it is the whole of the
     * "it played, then raced to the end and missed ten strokes" fault.
     * hanzi-writer resolves a cancelled animation the same way it resolves a
     * finished one -- `animateStroke(...).then(res => onComplete(res))` runs
     * either way, with `{canceled:true}` when the animation was cut off. A
     * cancelled stroke was therefore counted as a drawn one: the position
     * jumped, `mid` was cleared under a stroke that was still live, and the
     * next chain laid a second animation over it, which cancelled the first,
     * which counted itself again. Two chains became four, and the character
     * finished in a blur with most of it never drawn.
     */
    function landed(mine: number, res: any): boolean {
      return !st.dead && mine === st.tick && !(res && res.canceled);
    }
    /**
     * The stop-loss on a stroke that is drawing.
     *
     * If a stroke's completion never arrives the box waits for it for good,
     * which is how it ends up frozen part-drawn. Each stroke gets a long
     * ticket and the box carries on without it if it runs out.
     *
     * It is a function rather than three copies because resuming needs one
     * too, and that was the missing one: the ticket chain() takes out stands
     * down while the box is paused -- it returns on `pausedMid` -- so a
     * stroke paused for longer than its own window had nothing watching it
     * when it was let go again. If it then never finished, the box stayed
     * "playing" for good: pause drawn on the button and not a stroke moving,
     * which is the press that appears to do nothing.
     */
    function watch(mine: number) {
      setTimeout(() => {
        if (st.dead || mine !== st.tick || !st.mid || st.pausedMid) return;
        // Hidden, the writer's animation frames stop coming and a stroke
        // legitimately takes as long as it likes; that is not stuck.
        if (document.visibilityState !== "visible") return;
        st.tick++;
        st.mid = false;
        cancelDraw();
        setShown(st.pos + 1);
        if (st.playing) chain();
      }, capMs());
    }
    function chain() {
      if (st.dead || !st.playing) return;
      // Belt and braces: never lay a second animation over a live one.
      if (st.mid) return;
      // A click asked to start over while a stroke was still drawing. Here
      // is the only safe moment to do it: nothing is in flight, so writing
      // the render state cannot cancel an animation out from under us.
      if (st.restart) {
        st.restart = false;
        setShown(0);
      }
      if (st.pos >= st.total) {
        st.playing = false;
        paint();
        // Rows advance once; another pass requires an explicit repeat toggle.
        if (o.onDone) {
          o.onDone();
        } else if (st.repeat) {
          const run = st.run;
          setTimeout(() => {
            if (!st.dead && run === st.run && st.repeat && !st.playing) st.startPlay();
          }, REPEAT_GAP);
        }
        return;
      }
      st.mid = true;
      st.midSince = NOW();
      const mine = ++st.tick;
      watch(mine);
      st.w.animateStroke(st.pos, {
        onComplete: (res: any) => {
          // A completion from a stroke that has been stood down, or a
          // cancellation dressed up as one. Do not touch the display:
          // setShown writes the render state at once, and counting a
          // cancelled stroke as drawn is what set two chains racing.
          if (!landed(mine, res)) return;
          st.mid = false;
          st.pos = Math.min(st.total, st.pos + 1);
          paint();
          if (st.playing)
            setTimeout(() => {
              if (!st.dead && mine === st.tick) chain();
            }, 260);
        },
      });
    }
    function playPause() {
      if (!st.ready()) return;
      if (st.playing) {
        // pause -- and pause is the stop. Nothing goes round again after it.
        st.playing = false;
        st.repeat = false;
        if (st.mid) {
          /* The writer's own pause, and it has to be allowed to fail. If it
             throws, everything after it here was skipped -- the repaint
             included -- so the button went on showing "pause" over a box
             that had already stopped, and the press looked like it did
             nothing. Failing, the stroke is dropped instead of held. */
          try {
            st.w.pauseAnimation();
            st.pausedMid = true;
          } catch (e) {
            const at = st.pos;
            abandon();
            setShown(at);
          }
        }
        paint();
        if (o.onStop) o.onStop();
        return;
      }
      stopOthers(); // one voice at a time
      if (o.onPlay) o.onPlay();
      if (st.pausedMid) {
        // resume mid-stroke
        st.pausedMid = false;
        st.playing = true;
        try {
          st.w.resumeAnimation();
        } catch (e) {
          // Nothing to resume: carry on from where the box had got to
          // rather than waiting on a stroke that is not coming.
          st.mid = false;
        }
        watch(st.tick);
        if (!st.mid) chain();
        paint();
        return;
      }
      // A stroke still in flight with nothing playing is a stroke that was
      // written off; clear it out rather than letting chain() see `mid` and
      // decline to start, which is a play button that does nothing.
      if (st.mid) {
        const at = st.pos;
        abandon();
        setShown(at);
      }
      if (st.pos >= st.total) setShown(0); // start over
      st.playing = true;
      paint();
      chain();
    }
    function step() {
      // Nothing to step through until the writer has its data. The buttons
      // are on screen from the moment the box is, and a press before then
      // used to throw on a null writer.
      if (!st.ready()) return;
      if (st.pos >= st.total) {
        setShown(st.total);
        return;
      }
      if (st.mid || st.pausedMid) {
        // skip to the stroke's end
        const target = st.pos + 1;
        abandon();
        setShown(target);
        return;
      }
      st.playing = false;
      st.mid = true;
      st.midSince = NOW();
      const mine = ++st.tick;
      // The same stop-loss the chain gives a stroke. One press of Next that
      // never completes used to leave `mid` set for good, and a box with
      // `mid` stuck true takes no further presses at all.
      setTimeout(() => {
        if (st.dead || mine !== st.tick || !st.mid || st.pausedMid) return;
        if (document.visibilityState !== "visible") return;
        st.tick++;
        st.mid = false;
        cancelDraw();
        setShown(st.pos + 1);
      }, capMs());
      st.w.animateStroke(st.pos, {
        onComplete: (res: any) => {
          // A completion from a stroke that has been stood down, or a
          // cancellation dressed up as one -- see `landed`.
          if (!landed(mine, res)) return;
          st.mid = false;
          st.pos = Math.min(st.total, st.pos + 1);
          paint();
        },
      });
    }
    function stepBack() {
      if (!st.ready()) return;
      if (st.mid || st.pausedMid) {
        // drop the half-drawn stroke
        const target = st.pos;
        abandon();
        setShown(target);
        return;
      }
      if (st.pos <= 0) return;
      st.playing = false;
      setShown(st.pos - 1);
    }
    /**
     * Back to how the box was found: the whole character, drawn, in blue.
     *
     * THE RESTING STATE IS THE CHARACTER, NOT AN EMPTY SQUARE. A box opens
     * showing the character in full -- that is the `setShown(st.total)` at
     * the end of `make` -- and that is the state everything comes back to.
     * An empty square is somewhere the player passes through on its way to
     * drawing, not somewhere it sits: a square with nothing in it says
     * nothing about which character it is for, and a half-drawn one reads as
     * something still going on. Pressing play clears the square itself, so
     * nothing is lost by resting full.
     *
     * `abandon` is what makes this safe in the middle of a stroke, and it is
     * the whole difference between this and a bare `setShown`. It takes a new
     * ticket, so the completion of the stroke still being drawn is ignored
     * instead of counted, and it tells the writer to stop rather than leaving
     * it animating over the render state that is about to be written. Without
     * both, the square repaints and the abandoned stroke then draws itself
     * straight back into it. A box paused mid-stroke is the case that needs
     * it most: there is a stroke held in the air with the writer's own pause
     * on it, and `abandon` drops it rather than resuming it into the picture
     * that has just been written.
     */
    function rest() {
      if (!st.ready()) return;
      abandon();
      setShown(st.total);
    }
    function manual(fn: () => void) {
      return () => {
        if (o.onManual) o.onManual();
        fn();
      };
    }
    playB.addEventListener("click", manual(playPause));
    repeatB.addEventListener("click", manual(() => {
      st.repeat = !st.repeat;
      paint();
      if (st.repeat) {
        if (o.onPlay) o.onPlay();
        if (!st.playing) st.startPlay();
      }
    }));
    nextB.addEventListener(
      "click",
      manual(() => {
        // Stepping is asking for one stroke, not for a performance.
        st.repeat = false;
        stopOthers();
        step();
      }),
    );
    backB.addEventListener(
      "click",
      manual(() => {
        st.repeat = false;
        stopOthers();
        stepBack();
      }),
    );
    resetB.addEventListener(
      "click",
      manual(() => {
        // Same standing-down as the step buttons: `manual` takes the row's
        // autoplay chain off this box, and without dropping `repeat` a box
        // playing on its own would go straight back to drawing over the
        // character that has just been put back.
        st.repeat = false;
        stopOthers();
        rest();
      }),
    );

    function make() {
      abandon();
      cell.innerHTML = "";
      st.pos = 0;
      st.total = 0;
      // The build this call owns. Everything below is asynchronous, and a
      // second make -- a mode change, a rebuilt pane -- used to run straight
      // through the first one and leave two writers stacked in one cell,
      // both drawing.
      const mineRun = st.run;
      charData(ci.ch)
        .then((data: any) => {
          if (st.dead || mineRun !== st.run) return;
          st.total = (data.strokes || []).length;
          st.w = W.HanziWriter.create(cell, ci.ch, {
            width: size,
            height: size,
            padding: Math.round(size * 0.073),
            showCharacter: false,
            showOutline: mmode() !== "write",
            strokeColor: "#1d54c4",
            outlineColor: "#d7d7d7",
            drawingColor: "#1d54c4",
            highlightColor: "#c8362f",
            strokeAnimationSpeed: SPEED,
            charDataLoader: (c: string, done: (d: any) => void) => {
              charData(c).then(done, () => {});
            },
          });
          ctl.hidden = mmode() !== "animate";
          // The writer wires its render state a beat after create.
          (function ready(tries: number) {
            if (st.dead || mineRun !== st.run) return;
            if (st.w._renderState) {
              fixClips();
              // Only if nothing has started since. This poll and the
              // autoplay kick in buildStrokes are two independent timers
              // racing for the same box, and when this one lost the race it
              // painted the whole character over a run that had already
              // begun -- and put the position at the last stroke, so the
              // box called itself finished a stroke in. That is the
              // "it starts, jumps to the end and misses ten strokes" that
              // came and went with the fetch timings.
              if (mmode() === "animate" && !st.playing && !st.mid && st.pos === 0)
                setShown(st.total);
              return;
            }
            if (tries > 0)
              setTimeout(() => {
                ready(tries - 1);
              }, 60);
          })(80);
          if (mmode() !== "animate") st.w.quiz({ showHintAfterMisses: 2 });
        })
        .catch(() => {
          if (st.dead || mineRun !== st.run) return;
          // Said out loud rather than left as an empty square. The data is
          // no longer cached as a failure, so the next visit tries again.
          ctl.hidden = true;
          const oops = document.createElement("div");
          oops.className = "quiet";
          oops.textContent = "Stroke data for " + ci.ch + " could not be loaded.";
          cell.appendChild(oops);
        });
    }
    st.applySpeed = function () {
      if (st.w && st.w._options) st.w._options.strokeAnimationSpeed = SPEED;
    };
    st.ready = function () {
      return !!(st.w && st.w._renderState && st.total > 0);
    };
    /**
     * Another box has the floor: this one goes back to how it was found.
     *
     * Silencing it was not enough. A box stood down mid-run was left exactly
     * where it stopped -- three strokes of twelve, or a stroke frozen half
     * drawn under the writer's own pause -- and a row of characters in that
     * state reads as several things all going on at once, none of them
     * legible as the character it is meant to be. Pressing play on one
     * character now puts every other one back to the whole character in
     * blue, which is what they open as. See `rest`.
     *
     * No test of `playing` in front of it: a box does not have to be running
     * to be somewhere other than at rest. One stepped through by hand, or
     * paused a stroke in, is exactly the box this is for.
     */
    st.stop = function () {
      st.repeat = false;
      rest();
    };
    /**
     * Taken out of service: its pane has been rebuilt, so it owns nothing on
     * screen any more.
     *
     * A box left running past its pane is not harmless. Its chain went on
     * drawing into a detached SVG, and when it finished a character its
     * `onDone` reached into the old row and started the next box of THAT
     * row -- whose `startPlay` calls `stopOthers`, which stopped the box the
     * user was actually watching. That is the stroke order stopping dead
     * with nothing touched.
     */
    st.retire = function () {
      abandon();
      st.dead = true;
      const at = BOXREG.indexOf(st);
      if (at >= 0) BOXREG.splice(at, 1);
    };
    st.startPlay = function () {
      if (st.dead || !st.ready()) return;
      stopOthers();
      // The writer has no cancel, so a stroke already being drawn cannot be
      // stopped -- it can only be waited out. Two earlier attempts both
      // failed on that: starting a second chain gave rival runs the same id,
      // so both advanced the position (six clicks ran twenty animations);
      // and resetting the display mid-stroke cancelled the animation, whose
      // completion then never came, leaving the box stuck. So a click during
      // a stroke only asks the loop to start over at the next boundary.
      // Repeat clicks collapse into that one pending restart.
      // A stroke still drawing: ask for a restart at the next boundary
      // rather than starting a second animation on the same writer.
      // But only while that stroke is plausibly still alive. The writer
      // animates on requestAnimationFrame, which the browser stops for a
      // hidden tab, so a completion can simply never arrive -- and a box
      // that waits for one forever stops responding to clicks at all.
      // Past the stop-loss, treat it as dead and start cleanly; the stroke
      // ticket means a completion that does turn up late is ignored.
      if (st.mid && NOW() - st.midSince < capMs()) {
        st.restart = true;
        st.playing = true;
        if (st.pausedMid) {
          st.pausedMid = false;
          try {
            st.w.resumeAnimation();
          } catch (e) { /* nothing to resume: the restart still stands */ }
          // Same gap as in playPause: what was watching this stroke stood
          // down while it was paused.
          watch(st.tick);
        }
        paint();
        return;
      }
      // Nothing of the last cycle survives this: the writer is told to stop,
      // and the new ticket means the 260ms hand-off and the stop-loss still
      // pending from it will not wake up and draw.
      abandon();
      setShown(0);
      st.playing = true;
      paint();
      chain();
    };
    st.make = make;
    BOXREG.push(st);
    make();
    return st;
  }
  function buildStrokes(d: DictData): void {
    const pane = el("#pane-strokes");
    pane.innerHTML = "";
    // The boxes of the last build went with that markup.
    sweepBoxes();
    const chars = (d.chars || []).filter((c) => c.stroke);
    if (!chars.length) {
      note(pane, "No stroke-order data for this word.");
      return;
    }
    const boxes: Box[] = [];
    // Autoplay runs the row once. Repeating requires the row's button.
    let auto = true;
    let repeatAll = false;
    // Which single box is repeating on its own, once one has been played by
    // hand. -1 while the row is running, and after pause.
    let solo = -1;
    const s = sec("Character Stroke Order");
    const bar = document.createElement("div");
    bar.className = "sk-bar";
    const modeLbl = document.createElement("b");
    modeLbl.textContent = "Mode";
    bar.appendChild(modeLbl);
    ([["animate", "Animate"], ["trace", "Trace outline"],
      ["write", "Write (no outline)"]] as [string, string][]).forEach((m) => {
      const lab = document.createElement("label");
      const r = document.createElement("input");
      r.type = "radio";
      r.name = "sk-mode";
      r.value = m[0];
      r.checked = MODE === m[0];
      r.addEventListener("change", () => {
        MODE = m[0];
        auto = false;
        solo = -1;
        repeatAll = false;
        repeatAllB.setAttribute("aria-pressed", "false");
        boxes.forEach((b) => {
          b.repeat = false;
          b.make();
        });
      });
      lab.appendChild(r);
      lab.appendChild(document.createTextNode(" " + m[1]));
      bar.appendChild(lab);
    });
    const sp = document.createElement("span");
    sp.className = "sk-speed";
    sp.appendChild(document.createTextNode("Speed"));
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0.25";
    range.max = "3";
    range.step = "0.25";
    range.value = String(SPEED);
    const spv = document.createElement("span");
    spv.textContent = SPEED + "×";
    range.addEventListener("input", () => {
      SPEED = Number(range.value);
      spv.textContent = SPEED + "×";
      boxes.forEach((b) => {
        b.applySpeed();
      });
      fetch("/api/central/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strokeSpeed: SPEED }),
      }).catch(() => {});
    });
    sp.appendChild(range);
    sp.appendChild(spv);
    bar.appendChild(sp);
    const repeatAllB = document.createElement("button");
    repeatAllB.type = "button";
    repeatAllB.className = "skbtn sk-repeat-all";
    repeatAllB.textContent = "Auto-repeat all";
    repeatAllB.setAttribute("aria-pressed", "false");
    repeatAllB.addEventListener("click", () => {
      repeatAll = !repeatAll;
      repeatAllB.setAttribute("aria-pressed", String(repeatAll));
      if (repeatAll) {
        auto = true;
        solo = -1;
        if (!boxes.some((b) => b.playing)) playFrom(0);
      }
    });
    bar.appendChild(repeatAllB);
    s.appendChild(bar);
    const wrap = document.createElement("div");
    wrap.className = "sk-boxes";
    s.appendChild(wrap);
    pane.appendChild(s);
    /**
     * The next box that has something to draw, starting at `from` and
     * wrapping round only when repeat has been enabled. Boxes that never got
     * their data are stepped over rather than waited on -- one character whose
     * stroke file did not arrive used to leave the whole row stopped at it.
     * False means there is nothing in the row that can play.
     */
    function playFrom(from: number): boolean {
      const count = repeatAll ? boxes.length : Math.max(0, boxes.length - from);
      for (let n = 0; n < count; n++) {
        const b = boxes[(from + n) % boxes.length];
        if (b.ready()) {
          b.startPlay();
          return true;
        }
      }
      return false;
    }
    loadHW().then(() => {
      chars.forEach((ci, i) => {
        const one = document.createElement("div");
        one.className = "sk-one";
        wrap.appendChild(one);
        boxes.push(
          strokeBox(one, ci, {
            // Everything this used to print loose under the square -- the
            // character, its reading, its meanings -- is rows of the table
            // instead, so the column holds the box and then one table.
            cap: false,
            after: () => factsTable(ci, readingOf(d, ci)),
            onManual: () => {
              // Any button on any box takes the row's chain off the air; what
              // happens next is that box's business alone.
              auto = false;
              solo = -1;
              repeatAll = false;
              repeatAllB.setAttribute("aria-pressed", "false");
            },
            onPlay: () => {
              solo = i;
            },
            onStop: () => {
              if (solo === i) solo = -1;
            },
            onDone: () => {
              if (auto) {
                if (!playFrom(i + 1)) auto = false;
                return;
              }
              const b = boxes[i];
              const run = b.run;
              if (solo === i && b.repeat) setTimeout(() => {
                if (!b.dead && run === b.run && solo === i && b.repeat && !b.playing) b.startPlay();
              }, REPEAT_GAP);
            },
          }),
        );
      });
      (function kick(tries: number) {
        if (!auto) return;
        // The row reads left to right, so it is worth waiting for the first
        // character rather than opening on whichever loaded quickest.
        if (boxes[0] && boxes[0].ready()) {
          boxes[0].startPlay();
          return;
        }
        if (tries > 0) {
          setTimeout(() => {
            kick(tries - 1);
          }, 80);
          return;
        }
        // It never arrived. Start with whatever did.
        playFrom(0);
      })(60);
    });
  }

  /* ---------------- Character ---------------- */
  function renderCharacter(d: DictData): void {
    const pane = el("#pane-character");
    pane.innerHTML = "";
    if (!(d.chars || []).length) {
      note(pane, "No character details.");
      return;
    }
    let pager: HTMLDivElement | null = null;
    const blocks: HTMLDivElement[] = [];
    if (d.chars.length > 1) {
      pager = document.createElement("div");
      pager.className = "chpager";
      pane.appendChild(pager);
    }
    d.chars.forEach((ci, idx) => {
      const holder = document.createElement("div");
      holder.hidden = idx !== 0;
      blocks.push(holder);
      pane.appendChild(holder);
      if (pager) {
        const pb = document.createElement("button");
        pb.type = "button";
        pb.textContent = ci.ch;
        if (idx === 0) pb.className = "here";
        pb.addEventListener("click", () => {
          blocks.forEach((h, j) => {
            h.hidden = j !== idx;
          });
          Array.prototype.forEach.call(pager!.children, (x: Element, j: number) => {
            x.classList.toggle("here", j === idx);
          });
        });
        pager.appendChild(pb);
      }
      const cols = document.createElement("div");
      cols.className = "ybcols";
      const left = document.createElement("div");
      left.className = "ybleft";
      const right = document.createElement("div");
      right.className = "ybright";
      cols.appendChild(left);
      cols.appendChild(right);
      // No pinyin under the character here: with more than one reading
      // a single line would be picking one word over the others. The
      // Main table lists every reading beside its own definitions.
      const varTrad = ci.trad ? Array.from(ci.trad)[0] : "";
      const varSimp = ci.simp ? Array.from(ci.simp)[0] : "";
      if (varTrad) {
        left.appendChild(hwbox(ci.ch, varTrad, "", SCRIPT === "trad"));
      } else if (varSimp) {
        left.appendChild(hwbox(varSimp, ci.ch, "", true));
      } else {
        left.appendChild(hwbox(ci.ch, "", "", false));
      }
      left.appendChild(radicalSec(ci));
      const st = structureSec([ci]);
      if (st) left.appendChild(st);
      if (ci.rank || ci.hsk || ci.gsn || ci.grade || ci.band) {
        const rs = sec("Character Rank");
        const rt = table(rs);
        row(rt, "Frequency Rank", ci.rank ? "#" + ci.rank : "");
        row(rt, "通用规范 Number", ci.gsn);
        row(rt, "HSK Level", ci.hsk);
        row(rt, "Hong Kong Grade", ci.grade);
        row(rt, "Frequency Band", ci.band ? ci.band + " of 5" : "");
        left.appendChild(rs);
      }
      const main = sec("Main");
      const t = table(main);
      if (ci.defs && ci.defs.length) {
        ci.defs.forEach((de) => {
          const tr = row(t, "", defText(de.d.join("; ")) || "—");
          if (tr) tr.firstChild!.appendChild(pyEl(de.p));
        });
      } else {
        row(t, "English Definition", defText(ci.udef));
      }
      row(t, "Mandarin", ci.mandarin);
      row(t, "Cantonese", ci.cantonese ? jyut(ci.cantonese) : "");
      if (ci.trad) row(t, "Traditional Script", bigzh(charLinks(ci.trad)));
      if (ci.simp) row(t, "Simplified Script", bigzh(charLinks(ci.simp)));
      row(t, "Cangjie", ci.cangjie);
      row(t, "Four Corner", ci.fourcorner);
      row(t, "Unicode", ci.unicode);
      right.appendChild(main);
      holder.appendChild(cols);
    });
  }

  /* ---------------- Etymology ---------------- */
  const FORM_ZH: Record<string, string> = {
    pictographic: "(象形) Pictographic.",
    ideographic: "(会意) Ideographic.",
    pictophonetic: "(形声) Pictophonetic.",
  };
  function formationText(ci: CharInfo): HTMLOListElement | null {
    const e = ci.ety;
    const kids = (ci.tree && ci.tree.kids) || [];
    if (!e && !ci.dong_hint && !kids.length) return null;
    const ol = document.createElement("ol");
    ol.className = "form-list";
    if (ci.dong_hint) {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = "Origin.";
      li.appendChild(b);
      li.appendChild(document.createTextNode(" " + ci.dong_hint));
      ol.appendChild(li);
    }
    if (e && ci.tree_source !== "dong") {
      const li = document.createElement("li");
      const b = document.createElement("b");
      b.textContent = FORM_ZH[e.type] || e.type;
      li.appendChild(b);
      li.appendChild(document.createTextNode(" "));
      if (e.type === "pictophonetic") {
        if (e.semantic) {
          li.appendChild(charLinks(e.semantic));
          if (e.hint) li.appendChild(document.createTextNode(" (" + e.hint + ")"));
          li.appendChild(document.createTextNode(" provides the meaning"));
        }
        if (e.phonetic) {
          if (e.semantic) li.appendChild(document.createTextNode(", while "));
          else li.appendChild(document.createTextNode(" "));
          li.appendChild(charLinks(e.phonetic));
          li.appendChild(document.createTextNode(" provides the sound"));
        } else {
          if (e.semantic) li.appendChild(document.createTextNode("; "));
          else li.appendChild(document.createTextNode(" "));
          li.appendChild(document.createTextNode(
            "the source does not specify the sound component"));
        }
        li.appendChild(document.createTextNode("."));
      } else if (e.hint) {
        li.appendChild(document.createTextNode(e.hint + "."));
      }
      ol.appendChild(li);
    }
    if (kids.length) {
      const li2 = document.createElement("li");
      const b2 = document.createElement("b");
      b2.textContent = "Components.";
      li2.appendChild(b2);
      li2.appendChild(document.createTextNode(" "));
      if (ci.decomp && ci.tree_source !== "dong") {
        const first = Array.from(ci.decomp)[0];
        if (first >= "⿰" && first <= "⿿") {
          li2.appendChild(idcIcon(first));
          li2.appendChild(document.createTextNode(" "));
        }
      }
      kids.forEach((k, i) => {
        if (i) li2.appendChild(document.createTextNode(" and "));
        li2.appendChild(k.symbol ? document.createTextNode("graphic shape") : link(k.ch));
        if (k.gloss)
          li2.appendChild(document.createTextNode(" (" + defText(k.gloss.split(";")[0]) + ")"));
        else if (k.hint)
          li2.appendChild(document.createTextNode(" (" + k.hint + ")"));
      });
      li2.appendChild(document.createTextNode("."));
      ol.appendChild(li2);
    }
    return ol;
  }
  function isCharacterComponent(node: TreeNode): boolean {
    return !node.symbol && Array.from(node.ch).length === 1 && /\p{Script=Han}/u.test(node.ch);
  }
  function treeNode(node: TreeNode, depth = 0): HTMLLIElement {
    const li = document.createElement("li");
    const line = document.createElement("div");
    line.className = "trow";
    li.appendChild(line);
    const tg = document.createElement("span");
    tg.className = "tg";
    line.appendChild(tg);
    if (node.idc) line.appendChild(idcIcon(node.idc));
    line.appendChild(link(node.ch));
    if (node.py) line.appendChild(pyEl("[" + node.py + "]", "tpy"));
    else if (node.py_status) {
      const status = document.createElement("span");
      status.className = "tree-missing";
      status.textContent = "[reading unrecorded]";
      status.title = node.py_status;
      line.appendChild(status);
    }
    if (node.gloss) line.appendChild(document.createTextNode(defText(node.gloss)));
    else if (node.gloss_status) {
      const missing = document.createElement("span");
      missing.className = "tree-missing";
      missing.textContent = "definition unrecorded";
      missing.title = node.gloss_status;
      line.appendChild(missing);
    }
    (node.roles || []).forEach((r) => {
      const b = document.createElement("span");
      b.className = "role role-" + r;
      b.textContent = r;
      line.appendChild(b);
    });
    const visibleKids = (node.kids || []).filter(isCharacterComponent);
    if (visibleKids.length) {
      const ul = document.createElement("ul");
      visibleKids.forEach((k) => {
        ul.appendChild(treeNode(k, depth + 1));
      });
      const startsCollapsed = depth !== 0;
      ul.hidden = startsCollapsed;
      li.appendChild(ul);
      li.classList.toggle("closed", startsCollapsed);
      tg.textContent = startsCollapsed ? "▸" : "▾";
      tg.setAttribute("aria-expanded", String(!startsCollapsed));
      tg.classList.add("has");
      tg.addEventListener("click", () => {
        const closed = li.classList.toggle("closed");
        ul.hidden = closed;
        tg.textContent = closed ? "▸" : "▾";
        tg.setAttribute("aria-expanded", String(!closed));
      });
    }
    return li;
  }
  function renderEtymology(d: DictData): void {
    const pane = el("#pane-etymology");
    pane.innerHTML = "";
    const chars = d.chars || [];
    if (!chars.length) {
      note(pane, "No etymology notes for these characters.");
      return;
    }
    let pager: HTMLDivElement | null = null;
    const blocks: HTMLDivElement[] = [];
    if (chars.length > 1) {
      pager = document.createElement("div");
      pager.className = "chpager";
      pane.appendChild(pager);
    }
    chars.forEach((ci, i) => {
      const holder = document.createElement("div");
      holder.hidden = i !== 0;
      blocks.push(holder);
      pane.appendChild(holder);
      if (pager) {
        const pb = document.createElement("button");
        pb.type = "button";
        pb.textContent = ci.ch;
        if (i === 0) pb.className = "here";
        pb.addEventListener("click", () => {
          blocks.forEach((h, j) => {
            h.hidden = j !== i;
          });
          Array.prototype.forEach.call(pager!.children, (x: Element, j: number) => {
            x.classList.toggle("here", j === i);
          });
        });
        pager.appendChild(pb);
      }

      // Keep the full character header, with every dictionary reading's
      // tone-marked pinyin immediately beneath it.
      const etVarTrad = ci.trad ? Array.from(ci.trad)[0] : "";
      const etVarSimp = ci.simp ? Array.from(ci.simp)[0] : "";
      const etymPinyin = ci.defs?.length
        ? ci.defs.map((de) => de.p).filter(Boolean).join(" · ")
        : ci.mandarin || "";
      let hb: HTMLDivElement;
      if (etVarTrad) {
        hb = hwbox(ci.ch, etVarTrad, etymPinyin, SCRIPT === "trad");
      } else if (etVarSimp) {
        hb = hwbox(etVarSimp, ci.ch, etymPinyin, true);
      } else {
        hb = hwbox(ci.ch, "", etymPinyin, false);
      }
      hb.style.width = "300px";
      holder.appendChild(hb);

      const form = sec("Character Formation");
      const t = table(form);
      row(t, "Traditional", bigzh(charLinks(etVarTrad || ci.ch)));
      const ft = formationText(ci);
      if (ft) {
        ft.style.marginLeft = "24px";
        row(t, "Formation Method", ft);
      }
      if (ci.defs && ci.defs.length) {
        // One row per reading, its pinyin on the label side.
        ci.defs.forEach((de) => {
          const tr = row(t, "", defText(de.d.join("; ")) || "—");
          if (tr) tr.firstChild!.appendChild(pyEl(de.p));
        });
      } else {
        row(t, "Definition", defText(ci.udef));
      }
      holder.appendChild(form);
      if (ci.tree && ci.tree.kids?.some(isCharacterComponent)) {
        const ds = sec("Character Decomposition");
        const bar = document.createElement("div");
        bar.style.cssText = "text-align:right;padding:7px 12px 0;font-size:13px";
        ([["Expand all", false], ["Collapse all", true]] as [string, boolean][]).forEach(
          (m, k) => {
            if (k) bar.appendChild(document.createTextNode(" · "));
            const a2 = document.createElement("a");
            a2.href = "#";
            a2.textContent = m[0];
            a2.addEventListener("click", (ev) => {
              ev.preventDefault();
              ds.querySelectorAll("li").forEach((li) => {
                const tg = li.querySelector(":scope > .trow > .tg.has");
                if (!tg) return;
                li.classList.toggle("closed", m[1]);
        const branch = li.querySelector<HTMLUListElement>(":scope > ul");
                if (branch) branch.hidden = m[1];
                tg.textContent = m[1] ? "▸" : "▾";
              });
            });
            bar.appendChild(a2);
          },
        );
        ds.appendChild(bar);
        const ul = document.createElement("ul");
        ul.className = "ety-tree";
        ul.appendChild(treeNode(ci.tree));
        // The explorer stripes like the tables do.
        ul.querySelectorAll(".trow").forEach((r2, k2) => {
          if (k2 % 2) r2.classList.add("alt");
        });
        ds.appendChild(ul);
        const lg = document.createElement("div");
        lg.className = "yb-legend";
        const scope = document.createElement("div");
        scope.className = "yb-legend-scope";
        scope.textContent = "Each tag describes the component's role in the character directly above it. RADICAL means that component is the parent's indexing radical.";
        lg.appendChild(scope);
        const lt = document.createElement("b");
        lt.textContent = "Legend:";
        lg.appendChild(lt);
        const usedIdc: string[] = [];
        const usedRoles = new Set<string>();
        (function walk(n: TreeNode) {
          if (n.idc && usedIdc.indexOf(n.idc) < 0) usedIdc.push(n.idc);
          (n.roles || []).forEach((role) => usedRoles.add(role));
          (n.kids || []).filter(isCharacterComponent).forEach(walk);
        })(ci.tree);
        usedIdc.forEach((g) => {
          const item = document.createElement("span");
          item.className = "lg-item";
          item.appendChild(idcIcon(g));
          item.appendChild(document.createTextNode(IDC_NAMES[g] || ""));
          lg.appendChild(item);
        });
        const roleDescriptions: Record<string, string> = {
          radical: "the indexing radical of the character directly above",
          meaning: "hints at the meaning",
          sound: "hints at the pronunciation",
          iconic: "visually depicts an object or idea",
          remnant: "retained from part of an earlier character",
          simplified: "changed during character simplification",
          deleted: "removed during character simplification",
          distinguishing: "added to distinguish a similar character",
          unknown: "historical role is unclear",
        };
        const roleOrder = Object.keys(roleDescriptions);
        [...usedRoles].filter((role) => !roleDescriptions[role]).forEach((role) => roleOrder.push(role));
        roleOrder.filter((role) => usedRoles.has(role)).forEach((role) => {
          const item = document.createElement("span");
          item.className = "lg-item";
          const b2 = document.createElement("span");
          b2.className = "role role-" + role;
          b2.style.marginLeft = "0";
          b2.textContent = role;
          item.appendChild(b2);
          item.appendChild(document.createTextNode(" " + (roleDescriptions[role] || "component role")));
          lg.appendChild(item);
        });
        ds.appendChild(lg);
        holder.appendChild(ds);
      }
    });
  }

  /* ---------------- recent searches ---------------- */
  type RecentSearch = string | { q: string; mode: string; match?: string; strokes?: string };

  function renderRecent(): void {
    const request = lookupRequest;
    fetch("/api/central/recent", { cache: "no-store" })
      .then((r) => r.json())
      .then((rr: { list?: RecentSearch[] }) => {
        const list = rr.list || [];
        if (request !== lookupRequest || !list.length) return;
        const pane = el("#pane-word");
        pane.innerHTML = "";
        TABS.forEach((t) => {
          el("#pane-" + t).hidden = t !== "word";
        });
        const PER = 20;
        let shown = 0;
        const s = sec("Recent Searches");
        const t = table(s);
        const nav = document.createElement("div");
        nav.className = "recentnav";
        const more = document.createElement("button");
        more.type = "button";
        more.textContent = "Show more";
        const info = document.createElement("span");
        info.className = "quiet";
        function addRows() {
          list.slice(shown, shown + PER).forEach((item) => {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            const zw = document.createElement("span");
            zw.className = "zhword";
            td.appendChild(zw);
            if (typeof item === "string") {
              zw.appendChild(link(item, true));
            } else {
              const params = searchParams(item.q, item.mode, item.match, item.strokes);
              const a = document.createElement("a");
              a.href = "/dictionary?" + params;
              a.textContent = queryLabel(params);
              a.addEventListener("click", (event) => {
                if (event.ctrlKey || event.metaKey || event.shiftKey) return;
                event.preventDefault();
                loadAddress(params, true);
              });
              zw.appendChild(a);
              const mode = searchMode(item.mode);
              const label = document.createElement("small");
              label.className = "quiet d-recent-mode";
              label.textContent = searchModes[mode].label;
              td.appendChild(label);
            }
            tr.appendChild(td);
            t.appendChild(tr);
          });
          shown = Math.min(list.length, shown + PER);
          info.textContent = shown + " of " + list.length;
          nav.hidden = shown >= list.length;
        }
        more.addEventListener("click", addRows);
        nav.appendChild(more);
        nav.appendChild(info);
        s.appendChild(nav);
        pane.appendChild(s);
        addRows();
      })
      .catch(() => {});
  }

  /* ---------------- tabs and search ---------------- */
  const modeInput = el<HTMLSelectElement>("#d-mode");
  const matchInput = el<HTMLSelectElement>("#d-match");
  const strokesInput = el<HTMLInputElement>("#d-stroke-count");
  const searchBox = el<HTMLInputElement>("#d-q");

  function updateSearchControls(params: URLSearchParams): void {
    const mode = searchMode(params.get("mode"));
    const { placeholder, matches } = searchModes[mode];
    modeInput.value = mode;
    searchBox.placeholder = placeholder;
    matchInput.replaceChildren(...matches.map(([value, label]) => new Option(label, value)));
    matchInput.hidden = matches.length === 0;
    matchInput.value = params.get("match") ?? "";
    if (matchInput.selectedIndex < 0 && matches.length) matchInput.selectedIndex = 0;
    strokesInput.hidden = mode !== "radical";
    strokesInput.disabled = strokesInput.hidden;
    strokesInput.value = params.get("strokes") ?? "";
  }

  function renderSearchResults(d: DictData, params: URLSearchParams): void {
    TABS.forEach((tab) => {
      el("#pane-" + tab).hidden = tab !== "word";
    });
    const pane = el("#pane-word");
    pane.innerHTML = "";
    const query = "“" + queryLabel(params) + "”";
    if (!d.entries.length) {
      note(pane, "Nothing found for " + query + ".");
      return;
    }
    const results = sec("Matches for " + query);
    const t = table(results);
    d.entries.forEach((entry) => entryTr(t, entry));
    const info = d.search;
    if (info && info.pages > 1) {
      const nav = document.createElement("nav");
      nav.className = "d-search-pages";
      nav.setAttribute("aria-label", "Search results pages");
      const count = document.createElement("span");
      count.textContent = `${info.total.toLocaleString()} · ${info.page} / ${info.pages}`;
      count.setAttribute("aria-label", `${info.total} results, page ${info.page} of ${info.pages}`);
      nav.appendChild(count);
      for (const direction of [-1, 1]) {
        const page = info.page + direction;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = direction < 0 ? "‹" : "›";
        button.title = direction < 0 ? "Previous page" : "Next page";
        button.setAttribute("aria-label", button.title);
        button.disabled = page < 1 || page > info.pages;
        button.onclick = () => {
          const next = new URLSearchParams(params);
          next.set("page", String(page));
          loadAddress(next, true, "visit", false);
        };
        nav.appendChild(button);
      }
      t.before(nav);
    }
    pane.appendChild(results);
  }

  function showTab(tab: string, push?: boolean): void {
    if (TABS.indexOf(tab) < 0) tab = "word";
    const switchingTabs = push && tab !== TAB;
    if (switchingTabs) rememberPage();
    TAB = tab;
    TABS.forEach((t) => {
      el("#pane-" + t).hidden = t !== tab;
    });
    document.querySelectorAll<HTMLElement>("#d-tabs button").forEach((b) => {
      b.classList.toggle("here", b.dataset.tab === tab);
    });
    if (tab === "strokes" && DATA) {
      // Rebuilt on every visit, so the tab always opens playing from
      // the first character.
      buildStrokes(DATA);
    }
    if (switchingTabs) results.scrollTop = 0;
    if (push) putUrl();
  }
  function wordPageUrl({ q, ent, tab }: Step): string {
    return "/dictionary?q=" + encodeURIComponent(q) +
      (ent != null ? "&e=" + ent : "") + (tab !== "word" ? "&tab=" + tab : "");
  }
  function putUrl(): void {
    if (!DATA?.q) return;
    const step = stepHere();
    if (DATA.entries.length <= 1) step.ent = null;
    history.pushState(null, "", wordPageUrl(step));
  }
  let lookupRequest = 0;
  function look(
    q: string,
    push?: boolean,
    tab?: string,
    ent?: number | null,
    rec?: boolean,
    py?: string,
    selected?: Entry,
    trailUpdate: TrailUpdate = "visit",
    filters?: URLSearchParams,
  ): void {
    const request = ++lookupRequest;
    if (rec) LANDAT = null;
    const params = filters ?? searchParams(q, "auto");
    if (push) updateSearchControls(params);
    const apiParams = new URLSearchParams(params);
    if (rec) apiParams.set("rec", "1");
    fetch("/api/central/dict?" + apiParams, {
      cache: "no-store",
    })
      .then((r) => r.json())
      .then((d: DictData) => {
        if (request !== lookupRequest) return;
        if (push && !d.error) {
          rememberPage();
          LANDAT ??= 0;
        }
        DATA = d;
        activeSearch = d.search ? params : undefined;
        // The box says what is on screen. Following a character used to open
        // a tab of its own, so the box was always the thing you had typed;
        // now the pane moves under it and a stale query there is a lie about
        // where you are -- and the next Enter would search for it.
        const box = el<HTMLInputElement>("#d-q");
        if (document.activeElement !== box) box.value = d.q || q;
        ENT = null;
        if (d.entries && d.entries.length === 1) ENT = 0;
        if (ent != null && d.entries && ent >= 0 && ent < d.entries.length) ENT = ent;
        if (selected && d.entries) {
          const at = d.entries.findIndex((entry) =>
            sameReading(entry.p, selected.p) &&
            entry.s === selected.s && entry.t === selected.t &&
            JSON.stringify(entry.d) === JSON.stringify(selected.d));
          if (at >= 0) ENT = at;
        }
        // A reading asked for by name. The favourites link to a word at the
        // reading it was starred at, and an entry's number would not survive
        // a new edition of the dictionary to mean the same one.
        if (py && ENT == null && d.entries) {
          const at = d.entries.findIndex((x) => sameReading(x.p, py));
          if (at >= 0) ENT = at;
        }
        if (d.error) {
          el("#d-note").textContent = d.error;
          el("#d-tabs").hidden = true;
          renderCrumbs();
          land();
          return;
        }
        el("#d-note").textContent = d.q
          ? ""
          : d.total
            ? d.total.toLocaleString() +
              " entries · " +
              (d.sents || 0).toLocaleString() +
              " example sentences ready"
            : "";
        const cjk = (d.chars || []).length > 0;
        el("#d-tabs").hidden = !cjk || !!d.segments;
        if (!d.q && !d.search) {
          TABS.forEach((t) => {
            el("#pane-" + t).innerHTML = "";
          });
          renderCrumbs();
          renderRecent();
          if (push) history.pushState(null, "", params.get("mode") ? "/dictionary?" + params : "/dictionary");
          land();
          return;
        }
        if (d.segments) {
          // A search page: one result per word the text contains.
          TABS.forEach((t) => {
            el("#pane-" + t).hidden = t !== "word";
          });
          const sp = el("#pane-word");
          sp.innerHTML = "";
          const ss = sec("Matching Results");
          const stt = table(ss);
          d.segments.forEach((g) => {
            if (g.entries.length > 1) {
              segmentTr(stt, g.entries);
            } else if (g.entries.length) {
              entryTr(stt, g.entries[0]);
            } else {
              entryTr(stt, { s: g.w, t: g.w, p: g.py || "", d: g.gloss ? [g.gloss] : [] });
            }
          });
          sp.appendChild(ss);
          renderCrumbs();
          if (push) history.pushState(null, "", "/dictionary?q=" + encodeURIComponent(d.q));
          land();
          return;
        }
        if (!cjk || d.search) {
          renderSearchResults(d, params);
          renderCrumbs();
          if (push) history.pushState(null, "", "/dictionary?" + params);
          land();
          return;
        }
        renderWord(d);
        renderThesaurus(d);
        renderExamples(d);
        renderCharacter(d);
        renderEtymology(d);
        showTab(tab || TAB || "word", false);
        if (trailUpdate !== "refresh") saveWord({ ...stepHere(), y: LANDAT ?? 0 }, trailUpdate);
        renderCrumbs();
        if (push) putUrl();
        land();
      })
      .catch(() => {
        // A lookup that never arrived cannot be landed, and a place kept for
        // it would be spent on whatever was looked up next.
        if (request === lookupRequest) LANDAT = null;
      });
  }
  document.querySelectorAll<HTMLElement>("#d-tabs button").forEach((b) => {
    b.addEventListener("click", () => {
      showTab(b.dataset.tab!, true);
    });
  });
  modeInput.addEventListener("change", () => {
    updateSearchControls(searchParams(searchBox.value, modeInput.value));
  });
  el("#d-search").addEventListener("submit", (event) => {
    event.preventDefault();
    loadAddress(searchParams(searchBox.value, modeInput.value, matchInput.value, strokesInput.value), true);
  });
  window.__ccDictionaryLookup = (url) => loadAddress(url.searchParams, true);
  window.addEventListener("popstate", () => loadAddress(new URLSearchParams(location.search), false, "return"));
  function loadAddress(sp: URLSearchParams, push: boolean, trailUpdate: TrailUpdate = "visit", record = push): void {
    // Where this entry was left, if it was ever left rather than opened. A
    // first load and a typed-in address have none, and the top is right for
    // both.
    LANDAT = !push && typeof history.state?.y === "number" ? history.state.y : null;
    const q = sp.get("q") || "";
    const params = searchParams(q, sp.get("mode") ?? "", sp.get("match") ?? "", sp.get("strokes") ?? "");
    if (params.has("mode") && sp.has("page")) params.set("page", sp.get("page")!);
    searchBox.value = q;
    if (!push) updateSearchControls(params);
    const e = parseInt(sp.get("e") || "", 10);
    look(q, push, sp.get("tab") || "word", isNaN(e) ? null : e, record, sp.get("p") || "", undefined, trailUpdate, params);
  }
  loadAddress(new URLSearchParams(location.search), false);
}
