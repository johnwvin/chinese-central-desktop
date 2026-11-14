import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ActionIcon } from "../ui/ActionIcon";
import { BookmarkRename } from "../ui/BookmarkRename";
import { confirmDialog } from "../ui/ask";

const KEY = "cc-browser-bookmarks.v1";
export const BOOKMARKS_CHANGED = "cc-browser-bookmarks-changed";
const DRAG_TYPE = "application/x-chinese-central-bookmark";

interface Folder { id: string; name: string }
interface Bookmark { url: string; title: string; folder: string }
interface Bookmarks { folders: Folder[]; items: Bookmark[]; rootOrder?: string[] }
type Target = { kind: "folder" | "bookmark"; id: string };
type Placement = "before" | "after" | "inside";
interface DropHint { target: Target | null; position: Placement }
interface ContextMenu { target: Target; x: number; y: number }

export function canBookmark(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try { return ["https:", "http:"].includes(new URL(value).protocol); }
  catch { return false; }
}

function read(): Bookmarks {
  const raw = localStorage.getItem(KEY);
  if (!raw) return { folders: [], items: [] };
  const value = JSON.parse(raw) as Bookmarks;
  if (!value || !Array.isArray(value.folders) || !Array.isArray(value.items)) throw new Error("Saved bookmarks could not be read.");
  return {
    folders: value.folders.filter((folder) => folder && typeof folder.id === "string" && typeof folder.name === "string"),
    items: value.items.filter((item) => item && canBookmark(item.url) && typeof item.title === "string" && typeof item.folder === "string"),
    rootOrder: Array.isArray(value.rootOrder) ? value.rootOrder.filter((key) => typeof key === "string") : undefined,
  };
}

const targetKey = (target: Target) => `${target.kind}:${target.id}`;

function rootEntries(data: Bookmarks): Target[] {
  const folderIds = new Set(data.folders.map((folder) => folder.id));
  const entries: Target[] = [
    ...data.folders.map((folder) => ({ kind: "folder" as const, id: folder.id })),
    ...data.items.filter((item) => !folderIds.has(item.folder)).map((item) => ({ kind: "bookmark" as const, id: item.url })),
  ];
  const remaining = new Map(entries.map((entry) => [targetKey(entry), entry]));
  const ordered: Target[] = [];
  for (const key of data.rootOrder ?? []) {
    const entry = remaining.get(key);
    if (entry) ordered.push(entry);
    remaining.delete(key);
  }
  return [...ordered, ...remaining.values()];
}

function write(data: Bookmarks) {
  const next = { ...data, rootOrder: rootEntries(data).map(targetKey) };
  localStorage.setItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(BOOKMARKS_CHANGED));
  return next;
}

export function hasBookmark(url: string) {
  try { return read().items.some((item) => item.url === url); }
  catch { return false; }
}

export function bookmarkDetails(url: string) {
  const data = read();
  return { saved: data.items.find((item) => item.url === url), folders: data.folders };
}

export function bookmarkPage(url: string, title: string, folder: string) {
  if (!canBookmark(url)) return;
  const data = read();
  const saved = data.items.find((item) => item.url === url);
  if (folder && !data.folders.some((entry) => entry.id === folder)) throw new Error("That folder no longer exists.");
  const bookmark = { url, title: title.trim() || url, folder };
  const items = saved
    ? data.items.map((item) => item === saved ? bookmark : item)
    : [...data.items, bookmark];
  write({ ...data, items });
}

function relocate(data: Bookmarks, source: Target, { target, position }: DropHint): Bookmarks {
  const sourceKey = targetKey(source);
  const targetId = target && targetKey(target);
  if (targetId === sourceKey) return data;
  const rootOrder = rootEntries(data).map(targetKey).filter((key) => key !== sourceKey);
  const rootIndex = targetId === null ? rootOrder.length : rootOrder.indexOf(targetId);
  const bookmark = source.kind === "bookmark" ? data.items.find((item) => item.url === source.id) : undefined;
  if (source.kind === "bookmark" && !bookmark) return data;

  if (bookmark && position === "inside" && target?.kind === "folder") {
    if (!data.folders.some((folder) => folder.id === target.id)) return data;
    const items = data.items.filter((item) => item !== bookmark);
    return { ...data, rootOrder, items: [...items, { ...bookmark, folder: target.id }] };
  }
  if (rootIndex >= 0) {
    rootOrder.splice(rootIndex + Number(target !== null && position === "after"), 0, sourceKey);
    const items = bookmark ? data.items.map((item) => item === bookmark ? { ...item, folder: "" } : item) : data.items;
    return { ...data, rootOrder, items };
  }
  if (!bookmark || target?.kind !== "bookmark") return data;
  const items = data.items.filter((item) => item !== bookmark);
  const index = items.findIndex((item) => item.url === target.id);
  if (index < 0) return data;
  items.splice(index + Number(position === "after"), 0, { ...bookmark, folder: items[index].folder });
  return { ...data, rootOrder, items };
}

export function BrowserBookmarks({ onOpen, onClose }: {
  onOpen: (url: string) => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<Bookmarks>({ folders: [], items: [] });
  const [error, setError] = useState("");
  const [newFolder, setNewFolder] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [menu, setMenu] = useState<ContextMenu | null>(null);
  const [renaming, setRenaming] = useState<Bookmark | null>(null);
  const [dropHint, setDropHint] = useState<DropHint | null>(null);
  const dragged = useRef<Target | null>(null);
  const panel = useRef<HTMLElement>(null);
  const menuBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = () => {
      try { setData(read()); setError(""); }
      catch (cause) { setError(String(cause)); }
    };
    const storage = (event: StorageEvent) => { if (event.key === KEY) load(); };
    load();
    window.addEventListener(BOOKMARKS_CHANGED, load);
    window.addEventListener("storage", storage);
    return () => { window.removeEventListener(BOOKMARKS_CHANGED, load); window.removeEventListener("storage", storage); };
  }, []);

  useEffect(() => {
    if (!menu) return;
    menuBox.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuBox.current?.contains(event.target)) setMenu(null);
    };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") setMenu(null); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [menu]);

  const save = (change: (current: Bookmarks) => Bookmarks) => {
    try {
      const next = write(change(read()));
      setData(next);
      setError("");
      return true;
    } catch (cause) { setError(`Bookmarks could not be saved. ${String(cause)}`); return false; }
  };

  const showMenu = (target: Target, x: number, y: number) => {
    const bounds = panel.current?.getBoundingClientRect();
    if (!bounds) return;
    const width = target.kind === "bookmark" ? 152 : 124;
    setMenu({ target, x: Math.max(bounds.left + 6, Math.min(x, bounds.right - width)), y: Math.min(y, window.innerHeight - 50) });
  };

  const dropPosition = (event: DragEvent<HTMLElement>, target: Target | null, nested: boolean): Placement | null => {
    const source = dragged.current;
    if (!source || (target && targetKey(source) === targetKey(target))) return null;
    if (!target) return "after";
    if (nested && source.kind === "folder") return null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / bounds.height;
    if (target.kind === "folder" && source.kind === "bookmark" && ratio >= 0.25 && ratio <= 0.75) return "inside";
    return ratio < 0.5 ? "before" : "after";
  };

  const dropEvents = (target: Target | null, nested = false) => ({
    "data-drop": (dropHint?.target ? target && targetKey(dropHint.target) === targetKey(target) : target === null)
      ? dropHint?.position : undefined,
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.stopPropagation();
      const position = dropPosition(event, target, nested);
      if (position) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }
      setDropHint(position ? { target, position } : null);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropHint(null);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.stopPropagation();
      const source = dragged.current;
      const position = dropPosition(event, target, nested);
      dragged.current = null;
      setDropHint(null);
      if (source && position) save((current) => relocate(current, source, { target, position }));
    },
  });

  const rowEvents = (target: Target, nested = false) => ({
    ...dropEvents(target, nested),
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      dragged.current = target;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(DRAG_TYPE, targetKey(target));
      setMenu(null);
    },
    onContextMenu: (event: MouseEvent<HTMLElement>) => { event.preventDefault(); event.stopPropagation(); showMenu(target, event.clientX, event.clientY); },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); showMenu(target, bounds.left + 16, bounds.bottom);
      }
    },
  });

  const move = (target: Target, direction: number) => {
    save((current) => {
      let siblings = rootEntries(current);
      let index = siblings.findIndex((entry) => targetKey(entry) === targetKey(target));
      if (index < 0 && target.kind === "bookmark") {
        const selected = current.items.find((entry) => entry.url === target.id);
        if (!selected) return current;
        siblings = current.items.filter((entry) => entry.folder === selected.folder)
          .map((entry) => ({ kind: "bookmark", id: entry.url }));
        index = siblings.findIndex((entry) => entry.id === target.id);
      }
      const sibling = siblings[index + direction];
      return index >= 0 && sibling
        ? relocate(current, target, { target: sibling, position: direction < 0 ? "before" : "after" })
        : current;
    });
    setMenu(null);
  };

  const remove = async (target: Target) => {
    const name = target.kind === "folder" ? data.folders.find((entry) => entry.id === target.id)?.name : data.items.find((entry) => entry.url === target.id)?.title;
    const message = target.kind === "folder" ? `Delete folder “${name ?? ""}”? Its bookmarks will stay in the main list.` : `Delete bookmark “${name || target.id}”?`;
    setMenu(null);
    if (!await confirmDialog({ title: target.kind === "folder" ? "Delete folder?" : "Delete bookmark?", body: message, yes: "Delete", danger: true })) return;
    save((current) => {
      if (target.kind === "bookmark") return { ...current, items: current.items.filter((item) => item.url !== target.id) };
      const children = current.items.filter((item) => item.folder === target.id)
        .map((item) => targetKey({ kind: "bookmark", id: item.url }));
      return {
        folders: current.folders.filter((entry) => entry.id !== target.id),
        items: current.items.map((item) => item.folder === target.id ? { ...item, folder: "" } : item),
        rootOrder: rootEntries(current).flatMap((entry) => entry.kind === "folder" && entry.id === target.id ? children : [targetKey(entry)]),
      };
    });
  };

  const bookmarkRow = (item: Bookmark, nested = false) => <li className="browser-bookmark-row" key={targetKey({ kind: "bookmark", id: item.url })} {...rowEvents({ kind: "bookmark", id: item.url }, nested)}>
    <ActionIcon name="bookmark" />
    <button className="browser-bookmark-link" type="button" title={item.url} onClick={() => onOpen(item.url)}>{item.title || item.url}</button>
    <span className="browser-bookmark-grip"><ActionIcon name="grip" /></span>
  </li>;

  return <aside ref={panel} className="browser-bookmarks" aria-label="Bookmarks" onDragEnd={() => { dragged.current = null; setDropHint(null); }}>
    <header><strong>Bookmarks</strong><div className="browser-bookmark-actions">
      <button type="button" title="New folder" aria-label="New folder" aria-expanded={newFolder} onClick={() => setNewFolder((open) => !open)}><ActionIcon name="folderAdd" /></button>
      <button type="button" title="Close bookmarks" aria-label="Close bookmarks" onClick={onClose}><ActionIcon name="close" /></button>
    </div></header>
    {error && <p role="alert">{error}</p>}
    {newFolder && <form className="browser-bookmark-new-folder" onSubmit={(event) => {
      event.preventDefault();
      const name = folderName.trim();
      if (!name) return;
      const saved = save((current) => current.folders.some((entry) => entry.name.toLowerCase() === name.toLowerCase())
        ? current : { ...current, folders: [...current.folders, { id: crypto.randomUUID(), name }] });
      if (saved) { setFolderName(""); setNewFolder(false); }
    }}><input aria-label="Folder name" placeholder="Folder name" value={folderName} onChange={(event) => setFolderName(event.target.value)} /><button type="submit" title="Create folder" aria-label="Create folder"><ActionIcon name="check" /></button></form>}
    <ul className="browser-bookmark-list browser-bookmark-root" {...dropEvents(null)}>
      {rootEntries(data).map((target) => {
        if (target.kind === "bookmark") {
          const item = data.items.find((entry) => entry.url === target.id);
          return item && bookmarkRow(item);
        }
        const folder = data.folders.find((entry) => entry.id === target.id);
        if (!folder) return null;
        return <li key={targetKey(target)}><details className="browser-bookmark-folder" open>
          <summary {...rowEvents(target)}><ActionIcon name="folder" /><span>{folder.name}</span><span className="browser-bookmark-grip"><ActionIcon name="grip" /></span></summary>
          <ul className="browser-bookmark-list">{data.items.filter((item) => item.folder === folder.id).map((item) => bookmarkRow(item, true))}</ul>
        </details></li>;
      })}
    </ul>
    {menu && <div ref={menuBox} className="browser-bookmark-context" role="menu" aria-label="Bookmark actions" style={{ left: menu.x, top: menu.y }}>
      <button type="button" role="menuitem" title="Move up" aria-label="Move up" onClick={() => move(menu.target, -1)}><ActionIcon name="up" /></button>
      <button type="button" role="menuitem" title="Move down" aria-label="Move down" onClick={() => move(menu.target, 1)}><ActionIcon name="down" /></button>
      {menu.target.kind === "bookmark" && <button type="button" role="menuitem" title="Rename" aria-label="Rename" onClick={() => {
        setRenaming(data.items.find((item) => item.url === menu.target.id) ?? null);
        setMenu(null);
      }}><ActionIcon name="edit" /></button>}
      <button type="button" role="menuitem" title="Delete" aria-label="Delete" onClick={() => remove(menu.target)}><ActionIcon name="trash" /></button>
    </div>}
    {renaming && <BookmarkRename name={renaming.title || renaming.url} onClose={() => setRenaming(null)} onSave={(title) => {
      if (save((current) => ({
        ...current, items: current.items.map((item) => item.url === renaming.url ? { ...item, title } : item),
      }))) setRenaming(null);
    }} />}
  </aside>;
}
