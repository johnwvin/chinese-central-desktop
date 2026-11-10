/** Offline dictionary popup for Chinese text in every accessible app page. */
type HoverEntry = { s: string; t: string; p: string; d: string[] };
type HoverResult = { matches: { word: string; entries: HoverEntry[] }[] };

const HAN = /\p{Script=Han}/u;
const installed = new WeakSet<Document>();

export function hoverEnabled(): boolean {
  return localStorage.getItem("cc.hover.enabled") !== "off";
}

export function setHoverEnabled(enabled: boolean): void {
  localStorage.setItem("cc.hover.enabled", enabled ? "on" : "off");
  window.dispatchEvent(new Event("cc-hover-change"));
  for (const frame of document.querySelectorAll("iframe")) {
    try { frame.contentWindow?.dispatchEvent(new Event("cc-hover-change")); } catch { /* other origin */ }
  }
}

export function installHover(doc: Document, win: Window): void {
  const path = win.location.pathname;
  const bookPage = path === "/books/read" || path.startsWith("/bookfile/");
  if (!bookPage) return;
  if (installed.has(doc)) return;
  installed.add(doc);
  const host = doc.createElement("div");
  host.setAttribute("data-cc-hover", "");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    .mark{position:fixed;background:rgba(82,128,255,.42);border-bottom:2px solid #4b7bff}
    .popup{position:fixed;display:none;pointer-events:auto;overscroll-behavior:none;max-width:min(430px,calc(100vw - 20px));max-height:min(370px,55vh);
      overflow:auto;padding:8px 10px;border:1px solid #e4dd83;border-radius:4px;background:#ffffbb;
      color:#171717;box-shadow:0 5px 15px #0006;font:15px/1.3 Arial,sans-serif}
    .entry{margin:0 0 5px}.entry:last-child{margin-bottom:0}
    .word{font-size:22px;color:#5b67e8}.reading{margin-left:10px;font-size:17px;color:#4a7ce0}
    .reading .tone1{color:#ed5055}.reading .tone2{color:#df9a31}.reading .tone3{color:#36a266}.reading .tone4{color:#5883eb}
    .definition{margin-top:1px;color:#171717;font-size:14px}
  </style><div class="marks"></div><div class="popup" role="status"></div>`;
  doc.documentElement.appendChild(host);
  const marks = shadow.querySelector<HTMLElement>(".marks")!;
  const popup = shadow.querySelector<HTMLElement>(".popup")!;
  // Capture at the document as well as checking the composed path: WebView2
  // can target wheel input at the hovered word behind this shadow-root popup.
  // While a popup is open, route all wheel input to it so the page stays still
  // even though the pointer remains on the word that opened the popup.
  doc.addEventListener("wheel", (event) => {
    if (popup.style.display === "none") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? popup.clientHeight : 1;
    popup.scrollTop += event.deltaY * scale;
    popup.scrollLeft += event.deltaX * scale;
  }, { passive: false });
  const cache = new Map<string, HoverResult>();
  let timer = 0;
  let serial = 0;
  let lastKey = "";
  let lastNode: Text | null = null;
  let selected: { word: string; rects: DOMRect[] } | null = null;
  let pointerDown: { id: number; x: number; y: number } | null = null;
  let suppressClick = false;

  const clear = () => {
    ++serial;
    win.clearTimeout(timer);
    marks.replaceChildren();
    popup.style.display = "none";
    lastKey = "";
    lastNode = null;
    selected = null;
  };

  const locate = (x: number, y: number): { node: Text; at: number; run: string; start: number } | null => {
    const point = doc.caretPositionFromPoint?.(x, y);
    const old = !point ? doc.caretRangeFromPoint?.(x, y) : null;
    const node = point?.offsetNode ?? old?.startContainer;
    const offset = point?.offset ?? old?.startOffset ?? 0;
    if (!node || node.nodeType !== Node.TEXT_NODE || !node.parentElement) return null;
    // EPUB glossary anchors have their href removed by the reader. They are
    // ordinary book text; only anchors that still have a link are controls.
    if (node.parentElement.closest("[data-cc-hover],script,style,textarea,input,button,a[href],[role=button],[role=link],[role=tab],[role=tablist],select,option,header,nav,.topbar")) return null;
    if (!node.parentElement.closest("#rd-page, .textLayer")) return null;
    const content = node.textContent || "";
    let hovered = -1;
    for (const index of [offset, offset - 1]) {
      if (index < 0 || index >= content.length || !HAN.test(content[index])) continue;
      const probe = doc.createRange();
      probe.setStart(node, index);
      probe.setEnd(node, index + 1);
      if ([...probe.getClientRects()].some((box) => x >= box.left - 2 && x <= box.right + 2 && y >= box.top - 2 && y <= box.bottom + 2)) {
        hovered = index;
        break;
      }
    }
    if (hovered < 0) return null;
    let from = hovered;
    let to = hovered + 1;
    while (to < content.length && HAN.test(content[to]) && to - hovered < 8) ++to;
    return { node: node as Text, at: hovered - from, run: content.slice(from, to), start: from };
  };

  const show = (result: HoverResult, hit: NonNullable<ReturnType<typeof locate>>, x: number, y: number) => {
    if (!result.matches?.length) { clear(); return; }
    const range = doc.createRange();
    const start = hit.start;
    range.setStart(hit.node, start);
    range.setEnd(hit.node, Math.min(hit.node.length, start + result.matches[0].word.length));
    selected = { word: result.matches[0].word, rects: [...range.getClientRects()] };
    marks.replaceChildren();
    for (const box of range.getClientRects()) {
      const mark = doc.createElement("div");
      mark.className = "mark";
      mark.style.cssText = `left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px`;
      marks.appendChild(mark);
    }
    popup.replaceChildren();
    for (const match of result.matches) {
      for (const entry of match.entries) {
        const row = doc.createElement("div"); row.className = "entry";
        const word = doc.createElement("span"); word.className = "word";
        word.textContent = entry.t && entry.t !== entry.s ? `${entry.s}　${entry.t}` : entry.s || match.word;
        const reading = doc.createElement("span");
        const py = entry.p || "";
        reading.className = "reading";
        for (const [i, syllable] of py.split(/\s+/).entries()) {
          if (i) reading.append(" ");
          const part = doc.createElement("span");
          part.className = /[āēīōūǖ]/i.test(syllable) ? "tone1" :
            /[áéíóúǘ]/i.test(syllable) ? "tone2" : /[ǎěǐǒǔǚ]/i.test(syllable) ? "tone3" :
            /[àèìòùǜ]/i.test(syllable) ? "tone4" : "";
          part.textContent = syllable;
          reading.appendChild(part);
        }
        const definition = doc.createElement("div"); definition.className = "definition";
        definition.textContent = (entry.d || []).join(" ◆ ");
        row.append(word, reading, definition);
        popup.appendChild(row);
      }
    }
    popup.style.display = "block";
    const width = popup.getBoundingClientRect().width;
    const height = popup.getBoundingClientRect().height;
    popup.style.left = `${Math.max(8, Math.min(x + 14, win.innerWidth - width - 8))}px`;
    popup.style.top = `${y + height + 18 < win.innerHeight ? y + 18 : Math.max(8, y - height - 12)}px`;
  };

  // A click on the highlighted word asks the existing split-view dictionary
  // to look it up. A click elsewhere keeps the page's normal behaviour.
  doc.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    pointerDown = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
    suppressClick = false;
  }, true);
  doc.addEventListener("pointerup", (ev) => {
    if (pointerDown?.id !== ev.pointerId) return;
    if (Math.hypot(ev.clientX - pointerDown.x, ev.clientY - pointerDown.y) > 4)
      suppressClick = true;
    pointerDown = null;
  }, true);
  doc.addEventListener("pointercancel", () => { pointerDown = null; suppressClick = false; }, true);
  doc.addEventListener("click", (ev) => {
    const dragged = suppressClick;
    suppressClick = false;
    if (dragged || !!win.getSelection()?.toString().trim()) return;
    // Dictionary pages already own clicks on their entries and cross-references.
    // Keep hover definitions there, but never intercept their navigation.
    if (win.location.pathname === "/dictionary" || win.location.pathname.startsWith("/dictionary/")) return;
    if (!hoverEnabled() || ev.button !== 0 || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const choice = selected;
    if (!choice || !choice.rects.some((rect) =>
      ev.clientX >= rect.left && ev.clientX <= rect.right &&
      ev.clientY >= rect.top && ev.clientY <= rect.bottom)) return;
    const split = win.__ccSplitReplace;
    if (!split) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    split("/dictionary?q=" + encodeURIComponent(choice.word));
    clear();
  }, true);

  doc.addEventListener("pointermove", (ev) => {
    if (pointerDown?.id === ev.pointerId &&
        Math.hypot(ev.clientX - pointerDown.x, ev.clientY - pointerDown.y) > 4) {
      suppressClick = true;
      clear();
      return;
    }
    if (ev.composedPath().includes(popup)) return;
    if (!hoverEnabled()) { clear(); return; }
    const hit = locate(ev.clientX, ev.clientY);
    if (!hit) { clear(); return; }
    const key = `${hit.run}|${hit.at}`;
    if (key === lastKey && hit.node === lastNode) return;
    lastKey = key;
    lastNode = hit.node;
    const id = ++serial;
    win.clearTimeout(timer);
    timer = win.setTimeout(async () => {
      let result = cache.get(key);
      if (!result) {
        try {
          const response = await win.fetch(`/api/central/hover?text=${encodeURIComponent(hit.run)}&at=${hit.at}`);
          if (!response.ok) return;
          result = await response.json() as HoverResult;
          cache.set(key, result);
        } catch { return; }
      }
      if (id === serial && hoverEnabled()) show(result, hit, ev.clientX, ev.clientY);
    }, 55);
  }, { passive: true });
  doc.addEventListener("pointerleave", clear);
  win.addEventListener("scroll", (event) => {
    if (event.composedPath().includes(popup)) return;
    clear();
  }, true);
  win.addEventListener("cc-hover-change", () => { if (!hoverEnabled()) clear(); });
}
