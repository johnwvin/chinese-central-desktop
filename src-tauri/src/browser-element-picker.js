(() => new Promise((finish) => {
  document.querySelector("cc-element-picker")?.remove();
  const host = document.createElement("cc-element-picker");
  const shadow = host.attachShadow({ mode: "closed" });
  const skin = new CSSStyleSheet();
  skin.replaceSync(
    ":host{position:fixed!important;inset:0!important;display:block!important;z-index:2147483647!important;pointer-events:auto!important}" +
    ".surface{position:absolute;inset:0;cursor:crosshair}.surface.editing{cursor:default}" +
    ".outline{position:absolute;pointer-events:none;border:2px solid #ffbc23;background:#ffbc2333;box-sizing:border-box}" +
    ".panel{position:absolute;right:12px;top:12px;width:min(320px,calc(100% - 24px));box-sizing:border-box;padding:12px;border:1px solid #465263;border-radius:9px;background:#17202b;color:#f1f4fa;font:13px Segoe UI,sans-serif;box-shadow:0 6px 24px #0007}" +
    ".head,.row{display:flex;gap:6px;align-items:center}.head{justify-content:space-between}.row{margin-top:8px;flex-wrap:wrap}" +
    "textarea{display:block;width:100%;box-sizing:border-box;margin-top:8px;padding:6px;border:1px solid #465263;border-radius:4px;color:#f1f4fa;background:#10161e;resize:vertical}" +
    "button{padding:5px 8px;border:1px solid #465263;border-radius:5px;background:#252f3b;color:#fff;font:inherit;cursor:pointer}" +
    "button:disabled{opacity:.4;cursor:default}.save{color:#171717;background:#ffbc23;border-color:#ffbc23}[hidden]{display:none!important}"
  );
  shadow.adoptedStyleSheets = [skin];
  const surface = document.createElement("div");
  surface.className = "surface";
  const marks = document.createElement("div");
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Element picker");
  panel.innerHTML = '<div class="head"><strong>Block element</strong><button type="button" data-action="cancel" aria-label="Cancel">×</button></div>' +
    '<div class="editor" hidden><textarea rows="2" aria-label="Element selector" spellcheck="false"></textarea>' +
    '<div class="row"><button type="button" data-action="parent">Parent</button><button type="button" data-action="child">Child</button>' +
    '<button type="button" data-action="pick">Pick again</button><span aria-live="polite"></span></div>' +
    '<div class="row"><button type="button" data-action="preview">Preview</button><button type="button" class="save" data-action="save">Save</button></div></div>';
  surface.append(marks, panel);
  shadow.append(surface);
  document.documentElement.append(host);

  const editor = panel.querySelector(".editor");
  const input = panel.querySelector("textarea");
  const count = panel.querySelector("span");
  const save = panel.querySelector('[data-action="save"]');
  const preview = panel.querySelector('[data-action="preview"]');
  const previewStyle = new CSSStyleSheet();
  const hierarchy = [];
  let level = 0;
  let picking = true;
  let previewing = false;
  let hover = null;
  let completed = false;

  const usable = (element) => element && !element.matches("html,body,cc-element-picker");
  const selectorFor = (element) => {
    const steps = [];
    for (let node = element; usable(node); node = node.parentElement) {
      const tag = CSS.escape(node.localName);
      const id = node.id ? "#" + CSS.escape(node.id) : "";
      const classes = [...node.classList].slice(0, 4).map((name) => "." + CSS.escape(name)).join("");
      const stable = [id, tag + classes, tag].filter(Boolean);
      for (const step of stable) {
        const selector = [step, ...steps].join(" > ");
        if (document.querySelectorAll(selector).length === 1 && document.querySelector(selector) === element) return selector;
      }
      const siblings = [...(node.parentElement?.children ?? [])].filter((sibling) => sibling.localName === node.localName);
      steps.unshift(tag + ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")");
    }
    return ["body", ...steps].join(" > ");
  };
  const targets = () => {
    try { return [...document.querySelectorAll(input.value.trim())].filter(usable); }
    catch { return []; }
  };
  const unpreview = () => {
    previewing = false;
    preview.textContent = "Preview";
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => sheet !== previewStyle);
  };
  const draw = () => {
    const selected = picking ? (hover ? [hover] : []) : targets();
    marks.replaceChildren();
    if (!picking) {
      count.textContent = String(selected.length);
      save.disabled = preview.disabled = !selected.length || input.value.length > 2048;
      panel.querySelector('[data-action="parent"]').disabled = !hierarchy[level + 1];
      panel.querySelector('[data-action="child"]').disabled = level === 0;
    }
    if (previewing) return;
    for (const element of selected.slice(0, 50)) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const outline = document.createElement("div");
      outline.className = "outline";
      Object.assign(outline.style, { left: rect.left + "px", top: rect.top + "px", width: rect.width + "px", height: rect.height + "px" });
      marks.append(outline);
    }
  };
  const end = (selector = null) => {
    if (completed) return;
    completed = true;
    unpreview();
    host.remove();
    window.removeEventListener("keydown", escape, true);
    window.removeEventListener("scroll", draw, true);
    window.removeEventListener("resize", draw);
    observer.disconnect();
    finish(selector);
  };
  const escape = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    end();
  };
  const observer = new MutationObserver(() => { if (!host.isConnected) end(); });
  observer.observe(document.documentElement, { childList: true });
  window.addEventListener("keydown", escape, true);
  window.addEventListener("scroll", draw, true);
  window.addEventListener("resize", draw);
  const under = (event) => document.elementsFromPoint(event.clientX, event.clientY).find(usable);
  surface.addEventListener("pointermove", (event) => {
    if (!picking || panel.contains(event.target)) return;
    hover = under(event) ?? null;
    draw();
  });
  surface.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); });
  surface.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!picking || panel.contains(event.target)) return;
    const element = under(event);
    if (!element) return;
    picking = false;
    editor.hidden = false;
    surface.classList.add("editing");
    hierarchy.length = 0;
    for (let node = element; usable(node); node = node.parentElement) hierarchy.push(node);
    level = 0;
    input.value = selectorFor(element);
    draw();
  });
  input.addEventListener("input", () => { unpreview(); draw(); });
  panel.addEventListener("click", (event) => {
    const action = event.target.dataset.action;
    if (action === "cancel") return end();
    if (action === "save" && !save.disabled) return end(input.value.trim());
    if (action === "parent" || action === "child") {
      const next = level + (action === "parent" ? 1 : -1);
      if (hierarchy[next]) { level = next; input.value = selectorFor(hierarchy[level]); }
      unpreview();
    } else if (action === "pick") {
      unpreview();
      picking = true;
      hover = null;
      editor.hidden = true;
      surface.classList.remove("editing");
    } else if (action === "preview") {
      if (previewing) unpreview();
      else if (!preview.disabled) {
        try {
          previewStyle.replaceSync("");
          previewStyle.insertRule(":is(" + input.value.trim() + "):not(html,body,cc-element-picker) { display:none!important; }");
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, previewStyle];
          previewing = true;
          preview.textContent = "Undo preview";
        } catch {}
      }
    }
    draw();
  });
}))()
