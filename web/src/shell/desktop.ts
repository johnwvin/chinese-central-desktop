export function desktopInvoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const bridge = window as Window & {
    __TAURI__?: { core?: { invoke: <R>(command: string, args: Record<string, unknown>) => Promise<R> } };
    __TAURI_INTERNALS__?: { invoke: <R>(command: string, args: Record<string, unknown>) => Promise<R> };
  };
  const invoke = bridge.__TAURI__?.core?.invoke ?? bridge.__TAURI_INTERNALS__?.invoke;
  return invoke ? invoke<T>(command, args) : Promise.reject(new Error("Open Chinese Central's desktop app to use this feature."));
}


const shortcutDocs = new WeakSet<Document>();
export function installFullscreenKeys(doc: Document) {
  if (shortcutDocs.has(doc)) return;
  shortcutDocs.add(doc);
  doc.addEventListener("keydown", (event) => {
    if (event.key !== "F11" || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    const root = doc.defaultView?.top;
    root?.dispatchEvent(new CustomEvent("cc-app-fullscreen", { detail: "toggle" }));
  }, true);
}
