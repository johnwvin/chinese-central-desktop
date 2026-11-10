const TOGGLE = "cc-toggle-tab-bar";
const wired = new WeakSet<Document>();

export function installTabBarShortcut(doc: Document) {
  if (wired.has(doc)) return;
  wired.add(doc);
  doc.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || !event.shiftKey || event.altKey || event.metaKey || event.repeat) return;
    if (event.code !== "KeyB" && event.key.toLowerCase() !== "b") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.dispatchEvent(new Event(TOGGLE));
  }, true);
}

export function onTabBarToggle(toggle: () => void) {
  window.addEventListener(TOGGLE, toggle);
  return () => window.removeEventListener(TOGGLE, toggle);
}
