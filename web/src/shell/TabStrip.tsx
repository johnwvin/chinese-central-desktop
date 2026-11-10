import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { frames } from "./Frames";
import { browserCommand, browserLocations } from "./BrowserPane";
import { hoverEnabled, setHoverEnabled } from "./hover";
import { MAX_VOLUME } from "../pages/volume";
import { DesktopFullscreen } from "./DesktopFullscreen";
import { WindowsInput } from "./WindowsInput";
import { desktopInvoke } from "./desktop";
import {
  GROUP_COLOURS,
  iconFor,
  isCJK,
  PAGES,
  parse,
  type Group,
  type Tab,
} from "./tabs";
import type { Shell } from "./useShell";

/**
 * The strip across the top: the mark, the menu of everywhere you can go, the
 * tabs themselves, and the search, noise, volume and theme at the end.
 *
 * This is Central's whole navigation. The pages under it carry none of their
 * own.
 */
export function TabStrip({ shell }: { shell: Shell }) {
  const strip = useRef<HTMLDivElement>(null);
  const [hoverOn, setHoverOn] = useState(hoverEnabled);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState<{ tab?: number; group?: number } | null>(null);
  const dragSource = useRef<{ tab?: number; group?: number } | null>(null);
  const [dropAt, setDropAt] = useState<{ id: number; kind: "tab" | "group" | "start"; before: boolean } | null>(null);
  const dropTarget = useRef<typeof dropAt>(null);
  const markDrop = (target: NonNullable<typeof dropAt>) => {
    if (dropTarget.current?.id === target.id && dropTarget.current.kind === target.kind && dropTarget.current.before === target.before) return;
    dropTarget.current = target;
    setDropAt(target);
  };
  const beginDrag = (ev: React.DragEvent, source: { tab?: number; group?: number }) => {
    // WebView2 needs actual drag data before it will dispatch a usable drop.
    ev.dataTransfer.setData("text/plain", source.tab != null ? `tab:${source.tab}` : `group:${source.group}`);
    ev.dataTransfer.effectAllowed = "move";
    dragSource.current = source;
    setDragging(source);
  };
  const endDrag = () => {
    dragSource.current = null;
    dropTarget.current = null;
    setDragging(null);
    setDropAt(null);
  };
  const land = (target: NonNullable<typeof dropAt>) => {
    const source = dragSource.current;
    if (!source) return;
    if (target.kind === "start") {
      // Home stays pinned; the dropped tab becomes the first ordinary tab.
      if (source.tab != null) shell.move(source.tab, 1, null);
    } else if (target.kind === "group") {
      const first = shell.tabs.find((tab) => tab.group === target.id);
      if (!first) return;
      if (source.group != null && source.group !== target.id) shell.moveGroup(source.group, first.id, false);
      else if (source.tab != null) shell.move(source.tab, shell.tabs.findIndex((tab) => tab.id === first.id), target.id);
    } else {
      const at = shell.tabs.findIndex((tab) => tab.id === target.id);
      if (at < 0) return;
      if (source.group != null) shell.moveGroup(source.group, target.id, !target.before);
      else if (source.tab != null) shell.move(source.tab, target.before ? at : at + 1, shell.tabs[at].group ?? null);
    }
    endDrag();
  };
  // One menu for the whole row. It used to be a piece of state per tab, so
  // right-clicking a second tab opened a second menu beside the first: a
  // contextmenu is not a click, and the click listener that shut them never
  // fired. Five tabs, five menus.
  const [menu, setMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const [gmenu, setGmenu] = useState<{ x: number; y: number; id: number } | null>(null);
  // The same, for an entry of the ☰ list: where it would go, and which page.
  const [pmenu, setPmenu] = useState<{ x: number; y: number; path: string } | null>(null);

  const lookupBeside = shell.lookupBeside;
  const activeId = shell.activeId;
  useEffect(() => {
    window.__ccSplitReplace = (url: string) => lookupBeside(url, activeId ?? undefined);
  }, [lookupBeside, activeId]);



  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? el.clientWidth : 1;
      el.scrollLeft += (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const readers = shell.tabs.filter((tab) => shell.panes.includes(tab.id) && parse(tab.src).pathname === "/books/read");
  const readerVisible = readers.length > 0;
  useEffect(() => {
    void desktopInvoke("set_reader_find_active", { active: readerVisible }).catch(() => {});
  }, [readerVisible]);

  // Keyboard shortcuts belong to the desktop tab strip, whether focus is on
  // the strip itself or in one of the embedded pages.
  useEffect(() => {
    const findReader = () => {
      const visible = readers.map((tab) => frames.get(tab.id));
      const activeFrame = shell.activeId == null ? undefined : frames.get(shell.activeId);
      const reader = visible.find((frame) => frame === document.activeElement)
        ?? visible.find((frame) => frame === activeFrame)
        ?? visible.find(Boolean);
      if (!reader?.contentWindow) return false;
      reader.contentWindow.dispatchEvent(new Event("cc-reader-find"));
      return true;
    };
    const onKey = (ev: KeyboardEvent) => {
      const key = (ev.key || "").toLowerCase();
      if ((key === "f" || ev.code === "KeyF") && ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey) {
        if (findReader()) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
        }
      } else if (key === "d" && ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey) {
        const frame = shell.activeId == null ? undefined : frames.get(shell.activeId);
        const page = frame?.contentWindow as (Window & {
          __ccDefineSelection?: (text?: string) => boolean;
          __ccSplitReplace?: (url: string) => void;
        }) | null | undefined;
        const selected = String(page?.getSelection ? page.getSelection() : "").trim();
        if (!selected) return;
        ev.preventDefault();
        ev.stopImmediatePropagation();
        if (page?.__ccDefineSelection) page.__ccDefineSelection();
        else page?.__ccSplitReplace?.("/dictionary?q=" + encodeURIComponent(selected));
      } else if (key === "w" && ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey) {
        if (shell.activeId != null) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          shell.close(shell.activeId);
        }
      } else if (ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && key === "t") {
        ev.preventDefault();
        shell.open("/dictionary", { fresh: true });
      } else if (ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && key === "w") {
        if (shell.activeId != null) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
          shell.close(shell.activeId);
        }
      } else if (ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && (key === "arrowright" || key === "arrowleft")) {
        if (shell.tabs.length < 2) return;
        ev.preventDefault();
        const at = shell.tabs.findIndex((t) => t.id === shell.activeId);
        const step = key === "arrowright" ? 1 : -1;
        const next = (at + step + shell.tabs.length) % shell.tabs.length;
        shell.show(shell.tabs[next].id);
      }
    };
    const nativeFind = () => { findReader(); };
    window.addEventListener("cc-desktop-reader-find", nativeFind);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("cc-desktop-reader-find", nativeFind);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [shell]);

  const nudge = (by: number) => strip.current?.scrollBy({ left: by, behavior: "smooth" });

  const groupOf = (tab: Tab) =>
    tab.group != null ? shell.groups.find((g) => g.id === tab.group) : undefined;

  // The row as it is drawn: a group's chip, then the group's tabs, unless it
  // is folded away and the chip is all there is.
  const row: ({ chip: Group } | { tab: Tab; at: number; first: boolean; last: boolean })[] = [];
  shell.tabs.forEach((tab, at) => {
    if (at === 0 && new URL(tab.url, location.origin).pathname === "/home") return;
    const group = groupOf(tab);
    const before = at > 0 ? shell.tabs[at - 1] : undefined;
    const after = shell.tabs[at + 1];
    if (group && before?.group !== tab.group) row.push({ chip: group });
    if (group?.collapsed) return;
    row.push({
      tab,
      at,
      first: !!group && before?.group !== tab.group,
      last: !!group && after?.group !== tab.group,
    });
  });

  return (
    <div id="strip">
      <button
        type="button"
        id="badge"
        title="Home"
        onClick={() => shell.tabs[0] && shell.show(shell.tabs[0].id)}
      >
        <span className="mk">中</span>
      </button>

      <div id="menu" className={menuOpen ? "open" : ""}>
        <button
          type="button"
          className="summary"
          title="Where to"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((was) => !was)}
        >
          ☰
        </button>
        {menuOpen && (
          <>
            <div className="scrim" onClick={() => setMenuOpen(false)} />
            <nav id="go">
              {PAGES.map((page) => {
                const icon = iconFor(page.path);
                return (
                  <button
                    key={page.path}
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      shell.open(page.path, { fresh: page.fresh });
                    }}
                    onContextMenu={(ev) => {
                      ev.preventDefault();
                      setMenu(null);
                      setGmenu(null);
                      setPmenu({ x: ev.clientX, y: ev.clientY, path: page.path });
                    }}
                  >
                    {"img" in icon ? (
                      <img className="gic" src={icon.img} alt="" />
                    ) : (
                      <span className="gic">{icon.text}</span>
                    )}
                    {page.name}
                  </button>
                );
              })}
            </nav>
          </>
        )}
      </div>

      <div
        id="tabs"
        ref={strip}
        tabIndex={0}
        onDragOverCapture={(ev) => {
          if (dragSource.current?.tab == null || ev.clientX > ev.currentTarget.getBoundingClientRect().left + 44) return;
          ev.preventDefault();
          ev.stopPropagation();
          ev.dataTransfer.dropEffect = "move";
          markDrop({ id: 0, kind: "start", before: true });
        }}
        onDropCapture={(ev) => {
          if (dragSource.current?.tab == null || ev.clientX > ev.currentTarget.getBoundingClientRect().left + 44) return;
          ev.preventDefault();
          ev.stopPropagation();
          land({ id: 0, kind: "start", before: true });
        }}
        onDragOver={(ev) => {
          if (!dragSource.current) return;
          ev.preventDefault();
          ev.dataTransfer.dropEffect = "move";
          // The in-row ghost has no pointer events. When it sits under the
          // cursor, find the closest real tab so the drop still has a target.
          const target = (ev.target as Element).closest<HTMLElement>("[data-strip-kind]");
          const items = target ? [target] : [...(strip.current?.querySelectorAll<HTMLElement>("[data-strip-kind]") ?? [])];
          const nearest = items.reduce<HTMLElement | null>((best, item) => {
            const box = item.getBoundingClientRect();
            const distance = Math.max(box.left - ev.clientX, 0, ev.clientX - box.right);
            if (!best) return item;
            const old = best.getBoundingClientRect();
            return distance < Math.max(old.left - ev.clientX, 0, ev.clientX - old.right) ? item : best;
          }, null);
          if (nearest) {
            const kind = nearest.dataset.stripKind as "tab" | "group";
            const id = Number(nearest.dataset.stripId);
            const box = nearest.getBoundingClientRect();
            markDrop({ kind, id, before: kind === "group" || (nearest.dataset.pinned !== "true" && ev.clientX < box.left + box.width / 2) });
          }
        }}
        onDrop={(ev) => {
          ev.preventDefault();
          if (dropTarget.current) land(dropTarget.current);
        }}
        onKeyDown={(ev) => {
          // Arrows scroll the row when it has focus, so a bar too full to show
          // everything can still be got at from the keyboard.
          if (ev.key === "ArrowLeft") {
            ev.preventDefault();
            nudge(-160);
          } else if (ev.key === "ArrowRight") {
            ev.preventDefault();
            nudge(160);
          }
        }}
      >
        {dragging?.tab != null && <div className={"tab-start-drop" + (dropAt?.kind === "start" ? " active" : "")}
          title="Move to the start, outside all groups" aria-label="Move to the start, outside all groups">Start</div>}
        {row.map((entry) => {
          const id = "chip" in entry ? entry.chip.id : entry.tab.id;
          const kind = "chip" in entry ? "group" : "tab";
          const preview = (before: boolean) => dropAt?.id === id && dropAt.kind === kind && dropAt.before === before && dragging
            ? <DropPreview source={dragging} destination={entry} shell={shell} /> : null;
          return <Fragment key={kind + id}>
            {preview(true)}
            {"chip" in entry ? (
            <GroupChip
              group={entry.chip}
              count={shell.tabs.filter((t) => t.group === entry.chip.id).length}
              dragging={dragging?.group === entry.chip.id}
              onToggle={() => shell.collapseGroup(entry.chip.id, !entry.chip.collapsed)}
              onDragStart={(ev) => beginDrag(ev, { group: entry.chip.id })}
              onDragEnd={endDrag}
              onDragOver={(ev) => {
                ev.dataTransfer.dropEffect = "move";
                markDrop({ id, kind, before: true });
              }}
              onDrop={() => land({ id, kind, before: true })}
              onMenu={(x, y) => {
                setMenu(null);
                setGmenu({ x, y, id: entry.chip.id });
              }}
            />
          ) : (
            <TabButton
              tab={entry.tab}
              pinned={entry.at === 0}
              shell={shell}
              group={groupOf(entry.tab)}
              first={entry.first}
              last={entry.last}
              dragging={dragging?.tab === entry.tab.id}
              onDragStart={(ev) => beginDrag(ev, { tab: entry.tab.id })}
              onDragEnd={endDrag}
              onDragOver={(ev, before) => {
                ev.dataTransfer.dropEffect = "move";
                markDrop({ id, kind, before });
              }}
              onDropAt={(before) => land({ id, kind, before })}
              onMenu={(x, y) => {
                setGmenu(null);
                setMenu({ x, y, id: entry.tab.id });
              }}
            />
          )}
          {preview(false)}
          </Fragment>;
        })}
      </div>

      {menu && shell.tabs.some((t) => t.id === menu.id) && (
        <TabMenu at={menu} shell={shell} onClose={() => setMenu(null)} />
      )}
      {gmenu && shell.groups.some((g) => g.id === gmenu.id) && (
        <GroupMenu at={gmenu} shell={shell} onClose={() => setGmenu(null)} />
      )}
      {pmenu && menuOpen && (
        <PageMenu
          at={pmenu}
          shell={shell}
          onClose={() => setPmenu(null)}
          onPick={() => setMenuOpen(false)}
        />
      )}

      <div id="fill" />

      <Search onSearch={(q) => shell.openBeside("/dictionary?q=" + encodeURIComponent(q))} />

      <button type="button" id="hover-toggle" aria-pressed={hoverOn}
        title={hoverOn ? "Hover dictionary on · click to turn off" : "Hover dictionary off · click to turn on"}
        onClick={() => { setHoverEnabled(!hoverOn); setHoverOn(!hoverOn); }}>
        词
      </button>

      <DesktopFullscreen />

      {shell.panes.some((id) => shell.tabs.some((tab) => tab.id === id && ["/dictionary", "/dictionary/favorites", "/pinyin"].includes(parse(tab.url).pathname))) && <Volume shell={shell} />}
      <WindowsInput />

      <button
        type="button"
        id="theme"
        title={`Theme: ${shell.theme} (click to change)`}
        onClick={() =>
          shell.setTheme(shell.theme === "auto" ? "light" : shell.theme === "light" ? "dark" : "auto")
        }
      >
        {shell.theme === "light" ? "☀️ Light" : shell.theme === "dark" ? "🌙 Dark" : "🌗 Auto"}
      </button>
    </div>
  );
}

function DropPreview({ source, destination, shell }: {
  source: { tab?: number; group?: number };
  destination: { chip: Group } | { tab: Tab };
  shell: Shell;
}) {
  const tab = source.tab != null ? shell.tabs.find((item) => item.id === source.tab) : undefined;
  const group = source.group != null ? shell.groups.find((item) => item.id === source.group) : undefined;
  const destinationGroup = "chip" in destination
    ? destination.chip
    : shell.groups.find((item) => item.id === destination.tab.group);
  if (tab) {
    const icon = iconFor(tab.url);
    return <span className={"tab drop-preview" + (destinationGroup ? " ing" : "")}
      style={destinationGroup ? ({ ["--g" as string]: destinationGroup.colour } as React.CSSProperties) : undefined}
      aria-hidden="true">
      {"img" in icon ? <img className="ic" src={icon.img} alt="" /> : <span className="ic">{icon.text}</span>}
      <span className={isCJK(tab.label) ? "t cjk" : "t"}>{tab.label}</span>
      <span className="sh" /><span className="x">×</span>
    </span>;
  }
  if (!group) return null;
  const members = shell.tabs.filter((item) => item.group === group.id);
  return <span className="drop-preview-group" aria-hidden="true">
    <span className={"gchip" + (group.collapsed ? " shut" : "")}
      style={{ ["--g" as string]: group.colour }}>
      <span className={isCJK(group.name) ? "gname cjk" : "gname"}>{group.name}</span>
      {group.collapsed && <span className="gcount">{members.length}</span>}
    </span>
    {!group.collapsed && members.map((member) => {
      const icon = iconFor(member.url);
      return <span key={member.id} className="tab ing" style={{ ["--g" as string]: group.colour }}>
        {"img" in icon ? <img className="ic" src={icon.img} alt="" /> : <span className="ic">{icon.text}</span>}
        <span className={isCJK(member.label) ? "t cjk" : "t"}>{member.label}</span>
        <span className="sh" /><span className="x">×</span>
      </span>;
    })}
  </span>;
}

/**
 * A group's handle: its colour, its name, and the count when it is folded.
 *
 * Clicking it folds the group away and unfolds it again, which is the whole
 * point of a group -- a dozen words looked up in one sitting become one chip
 * you can put down.
 */
function GroupChip(props: {
  group: Group;
  count: number;
  dragging: boolean;
  onToggle: () => void;
  onDragStart: (ev: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (ev: React.DragEvent) => void;
  onDrop: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const { group } = props;
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      draggable
      data-strip-kind="group"
      data-strip-id={group.id}
      className={
        "gchip" +
        (group.collapsed ? " shut" : "") +
        (props.dragging ? " drag" : "") +
        (over ? " drop" : "")
      }
      style={{ ["--g" as string]: group.colour }}
      title={group.collapsed ? `${group.name} (${props.count} tabs)` : group.name}
      onClick={props.onToggle}
      onDragStart={props.onDragStart}
      onDragEnd={() => {
        setOver(false);
        props.onDragEnd();
      }}
      onDragOver={(ev) => {
        ev.preventDefault();
        props.onDragOver(ev);
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(ev) => {
        ev.preventDefault();
        setOver(false);
        props.onDrop();
      }}
      onContextMenu={(ev) => {
        ev.preventDefault();
        props.onMenu(ev.clientX, ev.clientY);
      }}
    >
      <span className={isCJK(group.name) ? "gname cjk" : "gname"}>{group.name}</span>
      {group.collapsed && <span className="gcount">{props.count}</span>}
    </button>
  );
}

function TabButton(props: {
  tab: Tab;
  pinned: boolean;
  shell: Shell;
  group?: Group;
  first: boolean;
  last: boolean;
  dragging: boolean;
  onDragStart: (ev: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (ev: React.DragEvent, before: boolean) => void;
  onDropAt: (before: boolean) => void;
  onMenu: (x: number, y: number) => void;
}) {
  const { tab, shell } = props;
  const [edge, setEdge] = useState<"left" | "right" | null>(null);

  const inSplit = shell.panes.length > 1 && shell.panes.includes(tab.id);
  const icon = iconFor(tab.url);

  return (
    <button
      type="button"
      draggable={!props.pinned}
      data-strip-kind="tab"
      data-strip-id={tab.id}
      data-pinned={props.pinned}
      className={
        "tab" +
        (tab.id === shell.activeId ? " on" : "") +
        (inSplit && tab.id !== shell.activeId ? " sp" : "") +
        (inSplit ? " grp" : "") +
        (props.group ? " ing" : "") +
        (props.group && props.first ? " ing1" : "") +
        (props.group && props.last ? " ingn" : "") +
        (props.pinned ? " pinned" : "") +
        (props.dragging ? " drag" : "") +
        (edge ? " drop-" + edge : "")
      }
      style={props.group ? ({ ["--g" as string]: props.group.colour } as React.CSSProperties) : undefined}
      // A pinned tab shows no label, so its name has nowhere else to go.
      title={props.pinned ? tab.label : tab.url}
      onClick={() => (inSplit ? shell.focusPane(tab.id) : shell.show(tab.id))}
      onAuxClick={(ev) => {
        // Middle-click closes, as it does in a browser.
        if (ev.button === 1 && !props.pinned) {
          ev.preventDefault();
          shell.close(tab.id);
        }
      }}
      onContextMenu={(ev) => {
        ev.preventDefault();
        props.onMenu(ev.clientX, ev.clientY);
      }}
      onDragStart={props.onDragStart}
      onDragEnd={() => {
        setEdge(null);
        props.onDragEnd();
      }}
      onDragOver={(ev) => {
        ev.preventDefault();
        const box = ev.currentTarget.getBoundingClientRect();
        const before = !props.pinned && ev.clientX < box.left + box.width / 2;
        setEdge(before ? "left" : "right");
        props.onDragOver(ev, before);
      }}
      onDragLeave={() => setEdge(null)}
      onDrop={(ev) => {
        ev.preventDefault();
        const box = ev.currentTarget.getBoundingClientRect();
        const before = !props.pinned && ev.clientX < box.left + box.width / 2;
        setEdge(null);
        props.onDropAt(before);
      }}
    >
      {"img" in icon ? <img className="ic" src={icon.img} alt="" /> : <span className="ic">{icon.text}</span>}
      {/* Pinned is the icon alone, the way a browser does it: Home is always
          the first tab and always the same picture, so its name is six
          characters that never change and never need reading. */}
      {!props.pinned && (
        <span className={isCJK(tab.label) ? "t cjk" : "t"}>{tab.label}</span>
      )}
      <span className="sh" />
      {!props.pinned && (
        <span
          className="x"
          role="button"
          aria-label="Close"
          title="Close"
          onClick={(ev) => {
            ev.stopPropagation();
            shell.close(tab.id);
          }}
        >
          {/* Drawn, not typed, and drawn at the size of the button rather
              than inside it.

              It began as the character × (U+00D7), which fonts set on the
              math axis rather than the middle of the em box, so a perfectly
              centred line box held a cross that sat visibly high. Replacing
              it with an 11px drawing inside a 22px circle fixed the font and
              introduced a worse problem: two boxes that have to agree. The
              gaps came to 5.5px a side -- half pixels -- so the drawing's
              raster grid sat half a pixel out of phase with the circle's,
              and the antialiasing of two diagonals landed unevenly. It
              measured as centred in CSS pixels and did not look centred,
              which is the kind of correctness nobody asked for.

              So there is one box now. The svg IS the button, the viewBox is
              the button's own 22 units, and the cross is placed by
              arithmetic about the middle of it: 8 and 14 either side of 11.
              Nothing has to line up with anything, because there is only one
              grid. */}
          <svg viewBox="0 0 22 22" aria-hidden="true" focusable="false">
            <path
              d="M8 8 L14 14 M14 8 L8 14"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
      )}
    </button>
  );
}

/** A tab's own history, which lives on its frame and nowhere else. */
function step(id: number, delta: number) {
  if (browserLocations.has(id)) {
    void browserCommand(id, delta < 0 ? "back" : "forward").catch(() => {});
    return;
  }
  const frame = frames.get(id);
  if (!frame) return;
  try {
    frame.contentWindow?.history.go(delta);
  } catch {
    // Another origin: its history is not ours to drive.
  }
}

function canGoBack(id: number): boolean {
  const frame = frames.get(id);
  if (!frame) return false;
  try {
    return (frame.contentWindow?.history.length ?? 0) > 1;
  } catch {
    return false;
  }
}

type Item = { label: string; run?: () => void } | { sep: true };

/** Somewhere to put a menu that is not off the edge of the window. */
function place(box: HTMLDivElement | null, x: number, y: number) {
  if (!box) return;
  const r = box.getBoundingClientRect();
  box.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 6)) + "px";
  box.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 6)) + "px";
}

/** Shut on anything that is not a press inside the menu itself. */
function useShut(box: React.RefObject<HTMLDivElement | null>, close: () => void) {
  useEffect(() => {
    // This listener is on the window in the capture phase, so without the
    // check it ran first, shut the menu, and took the item's own handler down
    // with it -- every entry looked dead because the thing you pressed was
    // gone before the press reached it.
    const shut = (ev?: Event) => {
      const target = ev?.target;
      if (target instanceof Node && box.current?.contains(target)) return;
      close();
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") close();
    };
    window.addEventListener("click", shut, true);
    window.addEventListener("blur", shut);
    window.addEventListener("resize", shut);
    window.addEventListener("scroll", shut, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", shut, true);
      window.removeEventListener("blur", shut);
      window.removeEventListener("resize", shut);
      window.removeEventListener("scroll", shut, true);
      document.removeEventListener("keydown", onKey);
    };
  });
}

/** The entries of a menu, with rules between its groups and nothing stray. */
function useItems() {
  const items: Item[] = [];
  let pending = false;
  return {
    items,
    // Separators are asked for, not drawn: a group that turns out to be empty
    // leaves no stray rule behind, and none can land first or last.
    sep: () => {
      if (items.length) pending = true;
    },
    item: (label: string, run?: () => void) => {
      if (pending) {
        items.push({ sep: true });
        pending = false;
      }
      items.push({ label, run });
    },
  };
}

function Entries({ items, onClose }: { items: Item[]; onClose: () => void }) {
  return (
    <>
      {items.map((entry, i) =>
        "sep" in entry ? (
          <div key={"sep" + i} className="tabmenu-sep" />
        ) : (
          <div
            key={entry.label + i}
            className={"tabmenu-item" + (entry.run ? "" : " off")}
            onClick={() => {
              if (!entry.run) return;
              onClose();
              entry.run();
            }}
          >
            {entry.label}
          </div>
        ),
      )}
    </>
  );
}

/**
 * The menu a tab wears when you right-click it, item for item as the Python
 * app built it, with the group entries added to the end of the first block.
 */
function TabMenu(props: {
  at: { x: number; y: number; id: number };
  shell: Shell;
  onClose: () => void;
}) {
  const { shell } = props;
  const id = props.at.id;
  const box = useRef<HTMLDivElement>(null);

  useShut(box, props.onClose);
  useLayoutEffect(() => place(box.current, props.at.x, props.at.y), [props.at]);

  const at = shell.tabs.findIndex((t) => t.id === id);
  const tab = shell.tabs[at];
  const { items, sep, item } = useItems();
  if (!tab) return null;
  const inPanes = shell.panes.includes(id);

  if (shell.panes.length > 1 && inPanes) {
    item("Take out of split", () => shell.dropPane(id));
    item("Close split view", () => shell.clearSplit());
  } else {
    item(
      "Add to split view",
      shell.tabs.length < 2
        ? undefined
        : () => {
            // Right-clicked the tab already on screen: pair it with its
            // neighbour, since splitting a tab with itself means nothing.
            if (id !== shell.activeId) {
              shell.addPane(id);
              return;
            }
            const mate = shell.tabs[at + 1] ?? shell.tabs[at - 1];
            if (mate) shell.addPane(mate.id);
          },
    );
    if (shell.panes.length > 1) item("Close split view", () => shell.clearSplit());
  }

  // ---- the group this tab is in, or could be ----
  sep();
  if (tab.group != null) {
    item("Open all in split view", () => shell.showGroup(tab.group!));
    item("Remove from group", () => shell.ungroupTab(id));
  } else if (at > 0) {
    item("Add to new group", () => shell.group([id]));
    for (const g of shell.groups) {
      item(`Add to “${g.name}”`, () => shell.group([id], g.id));
    }
  }

  sep();
  // Greyed when that tab has been nowhere yet, rather than looking broken
  // when it quietly does nothing.
  const browser = browserLocations.get(id);
  const canBack = browser?.back ?? canGoBack(id);
  const canForward = browser?.forward ?? canBack;
  item("Back", canBack ? () => step(id, -1) : undefined);
  item("Forward", canForward ? () => step(id, 1) : undefined);
  item("Duplicate", () => shell.add(tab.url, true));
  sep();
  if (at !== 0) item("Close", () => shell.close(id));
  if (at !== 0 && shell.tabs.length > 2) item("Close other tabs", () => shell.closeOthers(id));
  if (shell.tabs.length > 1) item("Close all tabs", () => shell.closeAll());

  return (
    <div className="tabmenu" ref={box}>
      <Entries items={items} onClose={props.onClose} />
    </div>
  );
}

/**
 * The menu an entry of the ☰ list wears when you right-click it.
 *
 * That list is how everywhere in the app is reached, so it is the one place
 * worth asking "not here". A left-click goes there in the tab you are already
 * in; these two take the same page to a tab of its own, or to the other half
 * of a split beside what you are looking at.
 */
function PageMenu(props: {
  at: { x: number; y: number; path: string };
  shell: Shell;
  onClose: () => void;
  onPick: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  useShut(box, props.onClose);
  useLayoutEffect(() => place(box.current, props.at.x, props.at.y), [props.at]);

  const { items, item } = useItems();
  const { path } = props.at;
  // Picking one puts the list away too, the way a left-click on it does --
  // the page you asked for is the thing you wanted to be looking at.
  item("Open in New Tab", () => {
    props.onPick();
    props.shell.add(path, true);
  });
  item("Open in Split View", () => {
    props.onPick();
    props.shell.openBeside(path);
  });

  return (
    <div className="tabmenu" ref={box}>
      <Entries items={items} onClose={props.onClose} />
    </div>
  );
}

/** The menu a group's chip wears: its name, its colour, and what to do with it. */
function GroupMenu(props: {
  at: { x: number; y: number; id: number };
  shell: Shell;
  onClose: () => void;
}) {
  const { shell } = props;
  const group = shell.groups.find((g) => g.id === props.at.id);
  const box = useRef<HTMLDivElement>(null);

  useShut(box, props.onClose);
  useLayoutEffect(() => place(box.current, props.at.x, props.at.y), [props.at]);

  const { items, sep, item } = useItems();
  if (!group) return null;

  item("Open all in split view", () => shell.showGroup(group.id));
  item(group.collapsed ? "Unfold" : "Fold away", () =>
    shell.collapseGroup(group.id, !group.collapsed),
  );
  item("New tab in group", () => {
    const last = [...shell.tabs].reverse().find((t) => t.group === group.id);
    shell.add("/dictionary", true, last?.id);
  });
  sep();
  item("Ungroup", () => shell.ungroup(group.id));
  item("Close group", () => shell.closeGroup(group.id));

  return (
    <div className="tabmenu" ref={box}>
      <input
        className="gname-edit"
        value={group.name}
        placeholder="Name this group"
        autoFocus
        onChange={(e) => shell.nameGroup(group.id, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") props.onClose();
        }}
      />
      <div className="gswatches">
        {GROUP_COLOURS.map((c) => (
          <button
            key={c}
            type="button"
            className={"gswatch" + (c === group.colour ? " on" : "")}
            style={{ background: c }}
            title="Colour"
            onClick={() => shell.colourGroup(group.id, c)}
          />
        ))}
      </div>
      <div className="tabmenu-sep" />
      <Entries items={items} onClose={props.onClose} />
    </div>
  );
}

function Search({ onSearch }: { onSearch: (q: string) => void }) {
  const [text, setText] = useState("");
  return (
    <form
      id="find"
      onSubmit={(ev) => {
        ev.preventDefault();
        const q = text.trim();
        if (!q) return;
        onSearch(q);
        setText("");
      }}
    >
      <svg className="mag" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      <input
        type="search"
        placeholder="Search the dictionary"
        autoComplete="off"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
    </form>
  );
}

function Volume({ shell }: { shell: Shell }) {
  return <details className="pronunciation-volume">
    <summary title="Pronunciation volume" aria-label="Pronunciation volume">🔊</summary>
    <label>Pronunciation volume
      <input type="range" min={0} max={MAX_VOLUME} step={0.05} value={shell.volume}
        onChange={(event) => shell.setVolume(Number(event.target.value), true)} />
    </label>
  </details>;
}
