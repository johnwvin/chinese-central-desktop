/**
 * The right-click menu: Copy, Search Dictionary, Search Google.
 *
 * A port of CCMENU_JS in server.py, which the Python app puts on every page it
 * serves -- its own (`HUB_HEAD += CCMENU_JS`), the Control page, and every
 * library page through `inject()`. Search Dictionary reuses the adjacent
 * dictionary through `window.__ccSplitReplace` when the tab shell provides it.
 *
 * It is built against the DOM rather than rendered, because it is: the menu is
 * appended to `document.body` from a contextmenu handler, outside whatever
 * page happens to be mounted, and the markup below is the old one line for
 * line so the menu looks and behaves the same wherever it appears.
 */

declare global {
  interface Window {
    __ccmenu?: boolean;
    __ccSplitOpen?: (url: string) => void;
    /** Send the dictionary already open beside this page to a new word. */
    __ccSplitReplace?: (url: string) => void;
    /** Run the same selected-text dictionary action as the context menu. */
    __ccDefineSelection?: (text?: string) => boolean;
    /** The shell's own `open`, for the one entry that leaves the app. */
    __ccOpenExternal?: (url: string) => void;
    /** True while a looked-up phrase is still lit on the page. */
    __ccLit?: boolean;
  }
}

/**
 * The phrase you looked up stays lit.
 *
 * A browser paints a selection only while its document has focus, and looking
 * a word up hands focus to the pane the dictionary opened in -- so the words
 * you were asking about went dark at the moment you needed to see which ones
 * they were. This paints them itself, through the highlight registry, which
 * owes nothing to focus and survives the frame being resized by the split.
 */
const LIT = "cc-look";

/**
 * Han, including the two extension blocks and the compatibility one.
 *
 * The stroke entry is offered only for something that actually has strokes:
 * the dictionary's Strokes tab has nothing to draw for a Latin word, and a
 * menu item that opens an empty pane is worse than no menu item.
 */
const HAN = /[㐀-䶿一-鿿豈-﫿]/;

function highlights(): { set: (k: string, h: unknown) => void; delete: (k: string) => void } | null {
  const reg = (CSS as unknown as { highlights?: { set: (k: string, h: unknown) => void; delete: (k: string) => void } }).highlights;
  const Ctor = (window as unknown as { Highlight?: unknown }).Highlight;
  return reg && typeof Ctor === "function" ? reg : null;
}

function light(sel: Selection | null) {
  const reg = highlights();
  if (!reg || !sel || !sel.rangeCount) return;
  try {
    const Ctor = (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
    const ranges: Range[] = [];
    for (let i = 0; i < sel.rangeCount; i++) ranges.push(sel.getRangeAt(i).cloneRange());
    reg.set(LIT, new Ctor(...ranges));
    window.__ccLit = true;
  } catch {
    // An older engine without the highlight registry keeps the plain
    // selection, which is what it had before.
  }
}

function unlight() {
  const reg = highlights();
  if (!reg) return;
  try {
    reg.delete(LIT);
  } catch {
    // Nothing lit.
  }
  window.__ccLit = false;
}

/** The colour it is lit in, put on the page once. */
function lightStyle() {
  if (document.getElementById("cc-lit-style")) return;
  const style = document.createElement("style");
  style.id = "cc-lit-style";
  style.textContent =
    "::highlight(" + LIT + "){background:rgba(253,188,30,.42);color:inherit}";
  document.head.appendChild(style);
}

/** The vowels that carry a tone, and what each one is without it. */
const TONED = "āáǎàēéěèīíǐì"
  + "ōóǒòūúǔùǖǘǚǜ";
const BASES = "aaaaeeeeiiiioooouuuuüüüü";
/** Whether a selection is written as pinyin with its tones on it. */
const TONE_RE = new RegExp("[" + TONED + "]");

/**
 * The recordings a piece of pinyin is made of, named as the dictionary
 * names them. The same rule dict/page.ts uses: a tone mark says which tone,
 * and a syllable with no mark is the neutral one.
 */
function pinyinFiles(text: string): string[] {
  const out: string[] = [];
  String(text)
    .split(/[\s·,;/、，。！？]+/)
    .forEach((tok) => {
      let syl = "";
      let tone = 5;
      let ok = false;
      Array.from(tok.toLowerCase()).forEach((ch) => {
        const at = TONED.indexOf(ch);
        if (at >= 0) {
          syl += BASES.charAt(at);
          tone = (at % 4) + 1;
          ok = true;
        } else if ((ch >= "a" && ch <= "z") || ch === "ü") {
          syl += ch;
          ok = true;
        }
      });
      if (ok && syl) out.push("cmn-" + syl.split("ü").join("v") + tone + ".mp3");
    });
  return out;
}

/** Only the Han of a selection, so punctuation is not asked about. */
function hanOf(text: string): string {
  return Array.from(String(text))
    .filter((c) => HAN.test(c))
    .join("");
}

/**
 * The first reading of a field that may hold several.
 *
 * A character's `mandarin` is Unihan's, and Unihan lists every reading a
 * character has, space-separated. Played whole, one character said four
 * different ways -- so only the first is taken. A word's `p` is different:
 * there the spaces are the syllables of one word, and all of it is played.
 */
function firstReading(py: string): string[] {
  return pinyinFiles(String(py || "").split(/\s+/)[0] || "");
}

let playRun = 0;

/**
 * One clip after another, the way the chart plays a syllable's tones.
 *
 * The elements are made up front and held: an <audio> nobody keeps a
 * reference to is the browser's to collect, and there is no reason to make
 * the next one only once the last has ended. A second request stands the
 * first down, so two menu presses do not talk over each other.
 */
function playFiles(files: string[]) {
  if (!files.length) return;
  const mine = ++playRun;
  const els = files.map((f) => {
    const a = new Audio("/dictdata/audio/" + f);
    a.preload = "auto";
    return a;
  });
  (function go(i: number) {
    if (mine !== playRun || i >= els.length) return;
    const a = els[i];
    // `ended` and a rejected play() can both arrive for the same clip; only
    // the first moves on, or a syllable is skipped.
    let moved = false;
    const next = () => {
      if (moved) return;
      moved = true;
      go(i + 1);
    };
    a.onended = next;
    a.onerror = next;
    const p = a.play();
    if (p && p.catch) p.catch(next);
  })(0);
}

/**
 * The readings the dictionary's answer holds, in the order they are read.
 *
 * Three shapes, because `/api/central/dict` answers in three:
 *
 *   * a word it knows -- `entries`, whose `p` is the whole word's pinyin;
 *   * text it does not know as one word -- `segments`, one per word found,
 *     which is what a phrase or a sentence comes back as;
 *   * a character with no headword of its own -- `chars`, with Unihan's
 *     reading on it.
 *
 * Only the first was ever read. That is why "Play pinyin" did nothing on
 * anything longer than a dictionary word: a sentence, a name, a phrase, or
 * a selection with a full stop on the end all come back with `entries`
 * empty, and an empty list plays in silence.
 */
interface DictAnswer {
  entries?: { p?: string }[];
  segments?: { w?: string; py?: string; entries?: { p?: string }[] }[];
  chars?: { ch?: string; mandarin?: string }[];
}
function readingsOf(d: DictAnswer, want: string): string[] {
  const chars = d.chars || [];
  // ONE CHARACTER: Unihan's reading, not the dictionary's first entry.
  //
  // CC-CEDICT is not ordered by frequency. Its first entry for 说 is shuì,
  // "to persuade" -- so reading a character off entries[0] says the wrong
  // word for the reading anyone selecting it meant.
  if (Array.from(want).length === 1 && chars[0] && chars[0].mandarin) {
    return firstReading(chars[0].mandarin);
  }

  const first = (d.entries || [])[0];
  if (first && first.p) return pinyinFiles(first.p);

  const segs = d.segments || [];
  if (segs.length) {
    const out: string[] = [];
    segs.forEach((sg) => {
      const oneChar = Array.from(sg.w || "").length === 1;
      const e = (sg.entries || [])[0];
      // A one-character segment takes Unihan's reading for the same reason;
      // a segment that is a word takes its entry, syllables and all.
      if (oneChar && sg.py) out.push(...firstReading(sg.py));
      else if (e && e.p) out.push(...pinyinFiles(e.p));
      else if (sg.py) out.push(...firstReading(sg.py));
    });
    if (out.length) return out;
  }

  // Character by character, in the order they were selected -- `chars` is
  // de-duplicated by the server, so it is indexed rather than walked.
  const by: Record<string, string> = {};
  (d.chars || []).forEach((c) => {
    if (c.ch && c.mandarin) by[c.ch] = c.mandarin;
  });
  const out: string[] = [];
  Array.from(want).forEach((ch) => {
    if (by[ch]) out.push(...firstReading(by[ch]));
  });
  return out;
}

/**
 * The selection, in the voice the recordings were made in.
 *
 * Pinyin is read straight off the page. Characters have no tone marks to
 * read, so the dictionary is asked what they sound like first -- which is
 * the same answer its own entry would have played.
 */
function playPinyin(sel: string) {
  // Han decides. Reading the selection as pinyin first meant a line with any
  // Latin in it -- a gloss beside the characters, a speaker's name, the
  // English half of a subtitle -- was heard as pinyin, and played a run of
  // syllables that have no recordings while the Chinese went unread.
  const han = hanOf(sel);
  if (!han) {
    playFiles(pinyinFiles(sel));
    return;
  }
  fetch("/api/central/dict?q=" + encodeURIComponent(han), { cache: "no-store" })
    .then((r) => r.json())
    .then((d: DictAnswer) => {
      playFiles(readingsOf(d, han));
    })
    .catch(() => {
      // No dictionary, no recording -- the speech entry above still works.
    });
}

/**
 * The best Chinese voice this machine has, or null if it has none.
 *
 * Ranked, because "the first voice in the list" is not a choice: that bug
 * handed Chinese text to Microsoft David and made the voice change from one
 * press to the next. Natural and Online voices are the modern neural ones
 * and sound it; the older local ones (Huihui, Yaoyao, Kangkang) are the
 * fallback; anything merely tagged zh comes last.
 */
function bestChineseVoice(): SpeechSynthesisVoice | null {
  const all = window.speechSynthesis.getVoices() || [];
  const zh = all.filter((v) => /^zh/i.test(v.lang));
  if (!zh.length) return null;
  const score = (v: SpeechSynthesisVoice) => {
    let n = 0;
    if (/natural/i.test(v.name)) n += 8;
    if (/online/i.test(v.name)) n += 4;
    if (/^google/i.test(v.name)) n += 3;
    if (/^zh[-_]?cn/i.test(v.lang)) n += 2;
    return n;
  };
  return zh.slice().sort((a, b) => score(b) - score(a))[0];
}

/**
 * Says a selection out loud.
 *
 * The voice list is filled in asynchronously, so the first press used to
 * find nothing and fall back to whatever the machine speaks by default --
 * which is why Chinese came out in an English voice. This waits for the
 * list once, then speaks.
 */
function speak(text: string) {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const han = HAN.test(text);
  let said = false;
  const go = () => {
    if (said) return;
    said = true;
    try {
      const say = new SpeechSynthesisUtterance(text);
      // A shade under speed: this is being listened to in order to be learned.
      say.rate = 0.95;
      const voiceLevel = (
        window as unknown as { __ccVoiceVolume?: () => number }
      ).__ccVoiceVolume;
      if (voiceLevel) say.volume = voiceLevel();
      if (han) {
        say.lang = "zh-CN";
        const voice = bestChineseVoice();
        // Only ever a voice that actually speaks the language. With none
        // installed the browser is left to its own default rather than
        // being handed an English voice to read Chinese with.
        if (voice) say.voice = voice;
      }
      synth.cancel();
      synth.speak(say);
    } catch {
      // A machine with no voice installed simply says nothing.
    }
  };
  if (han && !(synth.getVoices() || []).length) {
    synth.addEventListener("voiceschanged", go, { once: true });
    window.setTimeout(go, 500);
    return;
  }
  go();
}

/** Installs the menu once per document. Safe to call from every page. */
export function installContextMenu() {
  if (window.__ccmenu) return;
  window.__ccmenu = true;
  lightStyle();

  let menu: HTMLDivElement | null = null;

  const close = () => {
    if (menu) {
      menu.remove();
      menu = null;
    }
  };

  /**
   * The marks beside the entries. Drawn, not written: an emoji renders at a
   * different size and colour on every machine, and these have to line up in
   * a column and take the menu's own ink.
   */
  const draw = (paths: string) =>
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"' +
    ' stroke-linecap="round" stroke-linejoin="round"' +
    ' style="width:16px;height:16px;flex:none;opacity:.7">' +
    paths +
    "</svg>";
  const ICON = {
    copy: draw('<rect x="9" y="9" width="11" height="11" rx="2"/>' +
               '<path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
    book: draw('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v14H6.5A2.5 2.5 0 0 0 4 19.5z"/>' +
               '<path d="M4 5.5v14"/>'),
    split: draw('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>'),
    strokes: draw('<path d="M15 4l5 5-9 9H6v-5z"/><path d="M4 21h16"/>'),
    sound: draw('<path d="M11 5 6.5 9H3v6h3.5L11 19z"/>' +
                '<path d="M15.5 8.8a4.5 4.5 0 0 1 0 6.4"/>' +
                '<path d="M18.4 6a9 9 0 0 1 0 12"/>'),
    speech: draw('<path d="M21 14a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/>'),
    search: draw('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  };

  const item = (label: string, icon: string, fn: () => void) => {
    const d = document.createElement("div");
    d.style.cssText =
      "padding:8px 12px;border-radius:7px;white-space:nowrap;" +
      "display:flex;align-items:center;gap:10px";
    d.innerHTML = icon + "<span></span>";
    (d.lastElementChild as HTMLElement).textContent = label;
    d.addEventListener("click", (ev) => {
      ev.stopPropagation();
      fn();
      close();
    });
    return d;
  };

  /** A rule between two kinds of thing. Asked for, so none can land first. */
  const sep = () => {
    const d = document.createElement("div");
    d.style.cssText =
      "height:1px;margin:5px 8px;background:var(--line,#c8c8c8);opacity:.7";
    return d;
  };

  const defineSelection = (text: string) => {
    const query = text.trim();
    if (!query) return false;
    light(window.getSelection());
    const url = "/dictionary?q=" + encodeURIComponent(query);
    if (window.__ccSplitReplace) window.__ccSplitReplace(url);
    else window.open(url, "_blank");
    return true;
  };
  window.__ccDefineSelection = (text) =>
    defineSelection(text ?? String(window.getSelection ? window.getSelection() : ""));

  document.addEventListener("contextmenu", (ev) => {
    const sel = String(window.getSelection ? window.getSelection() : "").trim();
    if (!sel) {
      close();
      return;
    }
    ev.preventDefault();
    close();
    menu = document.createElement("div");
    menu.addEventListener("mousedown", (e) => e.preventDefault());
    menu.style.cssText =
      "position:fixed;z-index:99999;min-width:11em;" +
      "background:var(--card,#fff);color:var(--ink,#111);" +
      "border:1px solid var(--line,#c8c8c8);border-radius:10px;" +
      "box-shadow:0 10px 26px rgba(0,0,0,.28);padding:5px;" +
      "font-size:14.5px";

    menu.appendChild(
      item("Copy", ICON.copy, () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          void navigator.clipboard.writeText(sel);
        } else {
          document.execCommand("copy");
        }
      }),
    );
    menu.appendChild(sep());
    menu.appendChild(
      item("Search Dictionary", ICON.split, () => {
        defineSelection(sel);
      }),
    );
    // Stroke Order uses the same dictionary pane reuse as Search Dictionary.
    if (window.__ccSplitReplace) {
      // Straight to the stroke order. Looking a character up to see how it is
      // written is its own errand, and going through the Word tab to get
      // there is two clicks of nothing.
      //
      // Below a divider because stroke order is a separate task from looking
      // up a word's meaning.
      if (HAN.test(sel)) {
        menu.appendChild(sep());
        menu.appendChild(
          item("Stroke Order (Split View)", ICON.strokes, () => {
            light(window.getSelection());
            window.__ccSplitReplace?.(
              "/dictionary?q=" + encodeURIComponent(sel) + "&tab=strokes",
            );
          }),
        );
      }
    }
    // Said out loud, on demand. The dictionary's recordings are one syllable
    // each and only exist for pinyin; this is for whatever is on the page --
    // a sentence, a name, a line of a dialogue -- so it goes through the
    // browser's own voice. Chinese is asked for by name when the selection
    // has Han in it, or an English voice reads the pinyin as English.
    menu.appendChild(sep());
    // Han, or pinyin with a tone mark on it. NOT merely "has letters in it":
    // that offered to play the recordings for "hello there", which are not
    // syllables and have no recordings.
    if (HAN.test(sel) || TONE_RE.test(sel)) {
      menu.appendChild(
        item("Play pinyin", ICON.sound, () => {
          playPinyin(sel);
        }),
      );
    }
    if (window.speechSynthesis) {
      menu.appendChild(
        item("Text to speech", ICON.speech, () => {
          speak(sel);
        }),
      );
    }
    menu.appendChild(sep());
    menu.appendChild(
      item("Search Google", ICON.search, () => {
        // A desktop webview is not the user's browser. The local app passes
        // this search to the OS default browser; window.open is a fallback.
        const url = "https://www.google.com/search?q=" + encodeURIComponent(sel);
        fetch("/api/central/open-external", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-CC-Desktop": "1" },
          body: JSON.stringify({ url }),
        }).then((response) => {
          if (!response.ok) throw new Error("Could not open your browser");
        }).catch(() => {
          if (window.__ccOpenExternal) window.__ccOpenExternal(url);
          else window.open(url, "_blank", "noopener");
        });
      }),
    );

    document.body.appendChild(menu);
    let x = ev.clientX;
    let y = ev.clientY;
    const r = menu.getBoundingClientRect();
    if (x + r.width > innerWidth - 8) x = innerWidth - r.width - 8;
    if (y + r.height > innerHeight - 8) y = innerHeight - r.height - 8;
    menu.style.left = x + "px";
    menu.style.top = y + "px";
  });

  // Taking hold of the page again puts the light out: it marks the phrase you
  // last asked about, not a permanent stain on the book.
  document.addEventListener(
    "pointerdown",
    (ev) => {
      if (menu && ev.target instanceof Node && menu.contains(ev.target)) return;
      unlight();
    },
    true,
  );

  window.addEventListener("click", close, true);
  window.addEventListener("scroll", close, true);
  window.addEventListener("resize", close, true);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") close();
  });
}
