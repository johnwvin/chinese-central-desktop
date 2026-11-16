import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  labelFor,
  nextColour,
  realUrl,
  shortName,
  type Group,
  type Tab,
} from "./tabs";

/**
 * The app's state: which pages are open, how they are grouped, which of them
 * are on screen, and which one has focus.
 *
 * `panes` is what is shown side by side. Usually it is one tab; a lookup
 * opened beside what you were reading makes it two or more. Panes always run
 * in tab order, so dragging a tab along the strip moves its pane with it.
 *
 * `groups` are Chrome's tab groups: a named, coloured run of tabs that sit
 * together in the strip and can be folded away into their chip. A group's tabs
 * are always contiguous, which `tidy` below is what keeps true.
 *
 * The first tab is Home. It is pinned: it cannot be closed, it is never in a
 * group, and it keeps the first slot however the others are shuffled.
 *
 * They all move together, so they are one reducer rather than four pieces of
 * state: opening a tab beside another one changes the list, the panes and the
 * focus in the same breath, and doing that with four setters leaves moments
 * where they disagree.
 */

const CACHE_KEY = "cc-tabs-v1";
// What the head script reads to paint the right colours before anything is on
// screen. The settings file is still where the theme lives; this is a copy of
// it that can be had without waiting.
const THEME_KEY = "cc-theme";

function keepTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage turned off: the page paints a moment late, as it used to.
  }
}

export type Theme = "auto" | "light" | "dark";

/** A group as it is written to the settings file: its tabs by position. */
interface SavedGroup {
  name: string;
  colour: string;
  collapsed: boolean;
  at: number[];
}

interface SplitSession {
  panes: number[];
  activeId: number;
  widths: number[];
}

interface SavedSplitSession {
  panes: number[];
  active: number;
  widths: number[];
}

interface State {
  tabs: Tab[];
  groups: Group[];
  panes: number[];
  splitSessions: Record<number, SplitSession>;
  splitWidths: number[];
  activeId: number | null;
  seq: number;
  gseq: number;
  ready: boolean;
}

type Action =
  | { do: "boot"; urls: string[]; at: number; panes: number[]; groups: SavedGroup[]; splitSessions: SavedSplitSession[] }
  | { do: "open"; url: string; fresh?: boolean }
  | { do: "add"; url: string; focus: boolean; from?: number }
  | { do: "openBeside"; url: string; from?: number }
  | { do: "lookupBeside"; url: string; from?: number }
  | { do: "close"; id: number }
  | { do: "closeAll" }
  | { do: "closeOthers"; id: number }
  | { do: "show"; id: number }
  | { do: "focusPane"; id: number }
  | { do: "addPane"; id: number }
  | { do: "dropPane"; id: number }
  | { do: "clearSplit" }
  | { do: "move"; id: number; to: number; group?: number | null }
  | { do: "moveGroup"; groupId: number; atId: number; after: boolean }
  | { do: "relabel"; id: number; url: string; label: string }
  | { do: "group"; ids: number[]; groupId?: number }
  | { do: "ungroupTab"; id: number }
  | { do: "ungroup"; groupId: number }
  | { do: "closeGroup"; groupId: number }
  | { do: "nameGroup"; groupId: number; name: string }
  | { do: "colourGroup"; groupId: number; colour: string }
  | { do: "collapseGroup"; groupId: number; collapsed: boolean }
  | { do: "showGroup"; groupId: number }
  | { do: "setSplitWidths"; widths: number[] };

const EMPTY: State = {
  tabs: [],
  groups: [],
  panes: [],
  splitSessions: {},
  splitWidths: [1],
  activeId: null,
  seq: 0,
  gseq: 0,
  ready: false,
};

function pathOf(url: string): string {
  try {
    return new URL(url, window.location.origin).pathname;
  } catch {
    return url;
  }
}

/**
 * A group's tabs run together, and Home is in no group.
 *
 * Run after anything that touches grouping or order: a group is a run of tabs
 * in the strip, so putting a tab in one moves it to sit with the rest, and a
 * group nothing is left in is not a group any more.
 */
function tidy(tabs: Tab[], groups: Group[]): { tabs: Tab[]; groups: Group[] } {
  if (!tabs.length) return { tabs, groups };
  const home: Tab = { ...tabs[0] };
  delete home.group;
  const rest = tabs.slice(1);
  const out: Tab[] = [];
  const seen = new Set<number>();
  for (const tab of rest) {
    if (tab.group == null) {
      out.push(tab);
      continue;
    }
    if (seen.has(tab.group)) continue;
    seen.add(tab.group);
    for (const other of rest) if (other.group === tab.group) out.push(other);
  }
  return { tabs: [home, ...out], groups: groups.filter((g) => seen.has(g.id)) };
}

/** What is left showing when tabs go away. */
function settle(state: State, tabs: Tab[], groups: Group[], gone: Set<number>): State {
  const tidied = tidy(tabs, groups);
  const panes = state.panes.filter((p) => !gone.has(p));
  const activeGone = state.activeId != null && gone.has(state.activeId);
  if (!activeGone) {
    return {
      ...state,
      ...tidied,
      panes: panes.length ? panes : state.activeId ? [state.activeId] : [],
    };
  }
  // What it was sharing the screen with stays where it is: closing one half of
  // a split should not put away the other half as well.
  if (panes.length) return { ...state, ...tidied, panes, activeId: panes[0] };
  const home = tidied.tabs[0];
  return { ...state, ...tidied, panes: home ? [home.id] : [], activeId: home ? home.id : null };
}

function rememberSplit(
  sessions: Record<number, SplitSession>,
  panes: number[],
  activeId: number | null,
  widths: number[],
): Record<number, SplitSession> {
  if (panes.length < 2 || activeId == null || !panes.includes(activeId)) return sessions;
  const total = widths.length === panes.length ? widths.reduce((sum, width) => sum + width, 0) : 0;
  const normalized = total > 0
    ? widths.map((width) => width / total)
    : Array(panes.length).fill(1 / panes.length);
  const next = { ...sessions };
  const snapshot = { panes: [...panes], activeId, widths: normalized };
  for (const id of panes) next[id] = snapshot;
  return next;
}

function forgetSplit(sessions: Record<number, SplitSession>, panes: number[]): Record<number, SplitSession> {
  const next = { ...sessions };
  for (const id of panes) delete next[id];
  return next;
}

function change(state: State, action: Action): State {
  switch (action.do) {
    case "boot": {
      // Anything an older build saved as about:blank does not come back, and
      // the shell inside itself is a hall of mirrors: "/" and "/app" were
      // always meant to be Home.
      const wanted = action.urls
        .filter((u) => realUrl(u))
        .map((u) => {
          return ["/", "/app", "/progress", "/records", "/vocabulary"].includes(pathOf(u)) ? "/home" : u;
        });

      let seq = state.seq;
      const tabs: Tab[] = (wanted.length ? wanted : ["/home"]).map((url) => ({
        id: ++seq,
        url,
        src: url,
        label: labelFor(url, null),
      }));
      // There is always a Home tab, and it is always first.
      let shift = 0;
      if (pathOf(tabs[0].url) !== "/home") {
        tabs.unshift({ id: ++seq, url: "/home", src: "/home", label: "Home" });
        shift = 1;
      }
      let gseq = state.gseq;
      const groups: Group[] = [];
      for (const saved of action.groups ?? []) {
        const members = (saved.at ?? [])
          .map((i) => tabs[i + shift])
          .filter((t): t is Tab => !!t && t !== tabs[0]);
        if (!members.length) continue;
        const id = ++gseq;
        groups.push({
          id,
          name: saved.name || members[0].label,
          colour: saved.colour || nextColour(groups),
          collapsed: !!saved.collapsed,
        });
        for (const t of members) t.group = id;
      }
      const at = action.at >= 0 && action.at < tabs.length ? action.at : 0;
      const panes = action.panes.filter((i) => i >= 0 && i < tabs.length).map((i) => tabs[i].id);
      const splitSessions: Record<number, SplitSession> = {};
      for (const saved of action.splitSessions ?? []) {
        const members = saved.panes
          .filter((i) => i >= 0 && i < tabs.length)
          .map((i) => tabs[i + shift]?.id)
          .filter((id): id is number => id != null);
        const activeId = tabs[saved.active + shift]?.id;
        if (members.length < 2 || !activeId || !members.includes(activeId)) continue;
        const widths = saved.widths.length === members.length && saved.widths.every((w) => Number.isFinite(w) && w > 0)
          ? saved.widths
          : Array(members.length).fill(1 / members.length);
        const total = widths.reduce((sum, width) => sum + width, 0);
        const snapshot = { panes: members, activeId, widths: widths.map((width) => width / total) };
        for (const id of members) splitSessions[id] = snapshot;
      }
      const tidied = tidy(tabs, groups);
      const activeId = tabs[at].id;
      const restored = splitSessions[activeId];
      return {
        ...tidied,
        panes: restored?.panes ?? (panes.length ? panes : [activeId]),
        activeId: restored?.activeId ?? activeId,
        splitSessions,
        splitWidths: restored?.widths ?? Array(panes.length || 1).fill(1 / (panes.length || 1)),
        seq,
        gseq,
        ready: true,
      };
    }

    case "open": {
      // Home is a page reached through the logo, never an added tab.
      if (pathOf(action.url) === "/home" && state.tabs[0])
        return { ...state, activeId: state.tabs[0].id, panes: [state.tabs[0].id] };
      if (!action.fresh) {
        // Somewhere already open is brought forward rather than opened twice.
        const found = state.tabs.find((t) => pathOf(t.url) === pathOf(action.url));
        if (found) return { ...state, activeId: found.id, panes: [found.id] };
      }
      const seq = state.seq + 1;
      const tab: Tab = { id: seq, url: action.url, src: action.url, label: labelFor(action.url, null) };
      return { ...state, tabs: [...state.tabs, tab], activeId: tab.id, panes: [tab.id], seq };
    }

    // A tab asked for by a page inside one: a link with target="_blank", a
    // middle-click, a `window.open`. Always a new tab, never one already open
    // brought forward -- two of the same page side by side is a thing you can
    // want. A ctrl-click asks for it without leaving the page you are on, so
    // that one arrives unfocused.
    case "add": {
      const seq = state.seq + 1;
      const from = action.from != null ? state.tabs.find((t) => t.id === action.from) : undefined;
      const fromAt = from ? state.tabs.indexOf(from) : -1;
      let groups = state.groups;
      let gseq = state.gseq;
      let tabs = state.tabs;
      let group: number | undefined;

      // One word looked up from another is the same train of thought, so the
      // two sit together: the tab you followed it from starts a group if it is
      // not in one, and the new tab joins it.
      if (
        from &&
        fromAt > 0 &&
        pathOf(from.url) === "/dictionary" &&
        pathOf(action.url) === "/dictionary"
      ) {
        if (from.group != null) {
          group = from.group;
        } else {
          group = ++gseq;
          const named = from.label && from.label !== "Dictionary" ? shortName(from.label) : "Dictionary";
          groups = [...groups, { id: group, name: named, colour: nextColour(groups), collapsed: false }];
          tabs = tabs.map((t) => (t.id === from.id ? { ...t, group } : t));
        }
      }

      const tab: Tab = { id: seq, url: action.url, src: action.url, label: labelFor(action.url, null) };
      if (group != null) tab.group = group;
      const tidied = tidy([...tabs, tab], groups);
      if (!action.focus && state.activeId) return { ...state, ...tidied, seq, gseq };
      return { ...state, ...tidied, activeId: tab.id, panes: [tab.id], seq, gseq };
    }

    /* THE DICTIONARY THAT IS ALREADY OPEN, RATHER THAN ANOTHER ONE.
     *
     * `openBeside` puts every lookup in a tab of its own, which is right the
     * first time and wrong the fifth: read a page, look up five words, and the
     * strip is five dictionaries deep with four of them holding words you have
     * finished with. This looks to the right of the page you asked from, and
     * if a dictionary is already open there it sends that one to the new word
     * instead. Nothing to the right, or nothing there that is a dictionary,
     * and it falls straight through to `openBeside` -- so the first lookup
     * still opens one, and only the ones after it reuse it.
     *
     * To the RIGHT specifically, and only among the panes on screen. A
     * dictionary sitting in the strip but not in the split is not "the one
     * beside this page", and taking it over would change a tab you cannot see.
     *
     * `nav` asks the existing frame to navigate. The
     * decision is made here rather than in the frame that asked, because only
     * the reducer is looking at the state as it is now -- a closure handed to
     * a page when it loaded is reading the panes as they were then.
     */
    case "lookupBeside": {
      const anchor = action.from ?? state.activeId;
      const here = anchor == null ? -1 : state.panes.indexOf(anchor);
      let reuse = state.tabs.find((tab) => tab.id === anchor && pathOf(tab.url) === "/dictionary");
      if (here >= 0) {
        for (let i = here + 1; i < state.panes.length && !reuse; i++) {
          const pane = state.tabs.find((t) => t.id === state.panes[i]);
          if (pane && pathOf(pane.url).startsWith("/dictionary")) reuse = pane;
        }
      }
      if (!reuse) {
        return reduce(state, { do: "openBeside", url: action.url, from: action.from });
      }
      const id = reuse.id;
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === id
            ? {
                ...t,
                url: action.url,
                label: labelFor(action.url, null),
                nav: { url: action.url },
              }
            : t,
        ),
        activeId: id,
      };
    }

    // Open beside what is already on screen rather than over it: looking a
    // word up should not take away the thing you were reading.
    case "openBeside": {
      const seq = state.seq + 1;
      const tab: Tab = { id: seq, url: action.url, src: action.url, label: labelFor(action.url, null) };
      let tabs = [...state.tabs];
      const anchor = action.from ?? state.activeId;
      const at = tabs.findIndex((t) => t.id === anchor);
      const beside = at >= 0 ? tabs[at] : undefined;

      let groups = state.groups;
      let gseq = state.gseq;
      // A lookup opened out of a page belongs with the page it came from: the
      // two go on screen together, so they go in the strip together. The page
      // starts a group if it is not already in one, and the lookup joins it.
      if (beside && at > 0 && action.from != null) {
        if (beside.group != null) {
          tab.group = beside.group;
        } else {
          const id = ++gseq;
          groups = [
            ...groups,
            { id, name: shortName(beside.label) || "Group", colour: nextColour(groups), collapsed: false },
          ];
          tabs = tabs.map((t) => (t.id === beside.id ? { ...t, group: id } : t));
          tab.group = id;
        }
      } else if (beside?.group != null) {
        tab.group = beside.group;
      }

      tabs.splice(at >= 0 ? at + 1 : tabs.length, 0, tab);
      const base = state.panes.length ? state.panes : state.activeId ? [state.activeId] : [];
      return {
        ...state,
        ...tidy(tabs, groups),
        panes: [...base, tab.id],
        activeId: tab.id,
        seq,
        gseq,
      };
    }

    case "close": {
      const at = state.tabs.findIndex((t) => t.id === action.id);
      if (at <= 0) return state; // Home stays.
      return settle(
        state,
        state.tabs.filter((t) => t.id !== action.id),
        state.groups,
        new Set([action.id]),
      );
    }

    // Home is pinned, so it is what is left.
    case "closeAll": {
      const home = state.tabs[0];
      if (!home || state.tabs.length < 2) return state;
      return { ...state, tabs: [home], groups: [], panes: [home.id], activeId: home.id };
    }

    // Home and the one tab named survive; everything else goes.
    case "closeOthers": {
      const at = state.tabs.findIndex((t) => t.id === action.id);
      if (at <= 0) return state; // Home itself, or a tab already gone.
      const keep = new Set([state.tabs[0].id, action.id]);
      const gone = new Set(state.tabs.filter((t) => !keep.has(t.id)).map((t) => t.id));
      if (!gone.size) return state;
      return settle(state, state.tabs.filter((t) => keep.has(t.id)), state.groups, gone);
    }

    // A tab that belongs to a saved split restores that whole session.
    case "show": {
      const sessions = rememberSplit(state.splitSessions, state.panes, state.activeId, state.splitWidths);
      const saved = sessions[action.id];
      if (saved && saved.panes.every((id) => state.tabs.some((tab) => tab.id === id)))
        return { ...state, splitSessions: sessions, activeId: saved.activeId, panes: saved.panes, splitWidths: saved.widths };
      return { ...state, splitSessions: sessions, activeId: action.id, panes: [action.id], splitWidths: [1] };
    }

    case "focusPane":
      return { ...state, activeId: action.id };

    case "addPane": {
      if (state.panes.includes(action.id)) return { ...state, activeId: action.id };
      const base = state.panes.length ? state.panes : state.activeId ? [state.activeId] : [];
      return { ...state, panes: [...base, action.id], activeId: action.id };
    }

    case "dropPane": {
      if (state.panes.length < 2 || !state.panes.includes(action.id)) return state;
      const panes = state.panes.filter((p) => p !== action.id);
      const splitSessions = forgetSplit(state.splitSessions, state.panes);
      return {
        ...state,
        panes,
        splitSessions: panes.length > 1
          ? rememberSplit(splitSessions, panes, state.activeId === action.id ? panes[0] : state.activeId, state.splitWidths.filter((_, i) => state.panes[i] !== action.id))
          : splitSessions,
        splitWidths: panes.length > 1
          ? state.splitWidths.filter((_, i) => state.panes[i] !== action.id)
          : [1],
        activeId: state.activeId === action.id ? panes[0] : state.activeId,
      };
    }

    case "clearSplit":
      return {
        ...state,
        splitSessions: forgetSplit(state.splitSessions, state.panes),
        panes: state.activeId ? [state.activeId] : state.panes.slice(0, 1),
        splitWidths: [1],
      };

    case "setSplitWidths":
      return { ...state, splitWidths: action.widths };

    case "move": {
      const from = state.tabs.findIndex((t) => t.id === action.id);
      // Home holds the first slot come what may: the pinned tab is defined by
      // being first, and shuffling it along made a different tab unclosable.
      if (from <= 0) return state;
      // The drop names a gap before removing the source tab.
      const gap = Math.max(1, Math.min(state.tabs.length, action.to));
      const to = gap > from ? gap - 1 : gap;
      const tabs = [...state.tabs];
      const [tab] = tabs.splice(from, 1);

      /* WHICH GROUP IT LANDS IN IS THE DROP'S TO SAY, NOT OURS TO GUESS.
       *
       * This used to work it out from the neighbours: joined only if the tab
       * either side belonged to the same group. Which cannot express the two
       * places you most want to drop -- the front and the back of a group.
       * Landing first means the tab before is outside the group and the tab
       * after is inside, so they differ, so it refused; the tab settled just
       * outside the group instead and there was no way in from that end. The
       * chip had the same problem: dropping on it put the tab at the head of
       * the run, where the same test then decided it was not a member.
       *
       * The same guess broke the group from the inside. Dragging a group's
       * first tab to the end of its own run left it with a member before it
       * and a non-member after, so it was ejected -- and a group of two came
       * apart entirely from a drag that only meant to reorder it.
       *
       * The drop knows the answer: you dropped onto a tab, or onto a chip,
       * and that is the group you meant. `group` says which, `null` says
       * none, and only a caller with nothing to say leaves it out.
       */
      const joined =
        action.group !== undefined
          ? action.group ?? undefined
          : (() => {
              const before = tabs[to - 1];
              const after = tabs[to];
              return before && after && before.group != null && before.group === after.group
                ? before.group
                : undefined;
            })();

      if (from === to && tab.group === joined) return state;
      tabs.splice(to, 0, joined != null ? { ...tab, group: joined } : { ...tab, group: undefined });
      return { ...state, ...tidy(tabs, state.groups) };
    }

    /**
     * A whole group, carried along the row by its chip.
     *
     * Dropped next to a tab rather than at an index: taking the group out of
     * the row to move it changes every index after it, and an index worked out
     * before the lift is not the place it names afterwards.
     */
    case "moveGroup": {
      const members = state.tabs.filter((t) => t.group === action.groupId);
      if (!members.length) return state;
      const rest = state.tabs.filter((t) => t.group !== action.groupId);
      let to = rest.findIndex((t) => t.id === action.atId);
      if (to < 0) to = rest.length;
      else if (action.after) to += 1;
      // Home holds the first slot come what may.
      to = Math.max(1, Math.min(rest.length, to));
      const tabs = [...rest.slice(0, to), ...members, ...rest.slice(to)];
      return { ...state, ...tidy(tabs, state.groups) };
    }

    /**
     * What a tab is called, and where it now is.
     *
     * A page that navigates itself -- Home's search box, the dictionary
     * following a cross-reference -- leaves the tab pointing at the address it
     * was opened with, so it kept the name it was opened with too. The frame's
     * own location is the truth, and it is what gets saved.
     */
    case "relabel": {
      const tab = state.tabs.find((t) => t.id === action.id);
      if (!tab || (tab.url === action.url && tab.label === action.label)) return state;
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.id === action.id ? { ...t, url: action.url, label: action.label } : t,
        ),
      };
    }

    // ---- groups ----

    case "group": {
      let groups = state.groups;
      let gseq = state.gseq;
      let id = action.groupId;
      const ids = action.ids.filter((n) => state.tabs.findIndex((t) => t.id === n) > 0);
      if (!ids.length) return state;
      if (id == null) {
        id = ++gseq;
        const first = state.tabs.find((t) => t.id === ids[0]);
        groups = [
          ...groups,
          { id, name: first ? shortName(first.label) : "Group", colour: nextColour(groups), collapsed: false },
        ];
      }
      const tabs = state.tabs.map((t, i) => (i > 0 && ids.includes(t.id) ? { ...t, group: id } : t));
      return { ...state, ...tidy(tabs, groups), gseq };
    }

    case "ungroupTab": {
      const tabs = state.tabs.map((t) => (t.id === action.id ? { ...t, group: undefined } : t));
      return { ...state, ...tidy(tabs, state.groups) };
    }

    case "ungroup": {
      const tabs = state.tabs.map((t) =>
        t.group === action.groupId ? { ...t, group: undefined } : t,
      );
      return { ...state, ...tidy(tabs, state.groups) };
    }

    case "closeGroup": {
      const gone = new Set(
        state.tabs.filter((t, i) => i > 0 && t.group === action.groupId).map((t) => t.id),
      );
      if (!gone.size) return state;
      return settle(
        state,
        state.tabs.filter((t) => !gone.has(t.id)),
        state.groups,
        gone,
      );
    }

    case "nameGroup":
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === action.groupId ? { ...g, name: action.name } : g,
        ),
      };

    case "colourGroup":
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === action.groupId ? { ...g, colour: action.colour } : g,
        ),
      };

    case "collapseGroup": {
      const groups = state.groups.map((g) =>
        g.id === action.groupId ? { ...g, collapsed: action.collapsed } : g,
      );
      return { ...state, groups };
    }

    // The whole group on screen at once, one pane each.
    case "showGroup": {
      const ids = state.tabs.filter((t) => t.group === action.groupId).map((t) => t.id);
      if (!ids.length) return state;
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === action.groupId ? { ...g, collapsed: false } : g,
        ),
        panes: ids,
        activeId: state.activeId != null && ids.includes(state.activeId) ? state.activeId : ids[0],
      };
    }
  }
}

/** A folded group's tabs stay open, but none of its panes may stay on screen. */
function keepFoldedTabsOffScreen(state: State): State {
  const home = state.tabs[0];
  if (!home) return state;
  const folded = new Set(state.groups.filter((group) => group.collapsed).map((group) => group.id));
  const visible = new Set(state.tabs.filter((tab) => tab.group == null || !folded.has(tab.group)).map((tab) => tab.id));
  const panes = state.panes.filter((id) => visible.has(id));
  if (state.activeId == null || !visible.has(state.activeId) || !panes.includes(state.activeId))
    return { ...state, panes: [home.id], activeId: home.id };
  return panes.length === state.panes.length ? state : { ...state, panes };
}

function reduce(state: State, action: Action): State {
  let next = change(state, action);
  // Keep saved layouts attached only to tabs that still exist. Closing one
  // member shrinks a remembered layout; a one-pane remainder is no longer a
  // split session.
  if (action.do === "close" || action.do === "closeAll" || action.do === "closeOthers" || action.do === "closeGroup") {
    const valid = new Set(next.tabs.map((tab) => tab.id));
    const sessions: Record<number, SplitSession> = {};
    const seen = new Set<string>();
    for (const saved of Object.values(next.splitSessions)) {
      const panes = saved.panes.filter((id) => valid.has(id));
      const key = panes.join(",");
      if (panes.length < 2 || seen.has(key)) continue;
      seen.add(key);
      const activeId = panes.includes(saved.activeId) ? saved.activeId : panes[0];
      const widths = panes.length === saved.panes.length
        ? saved.widths
        : Array(panes.length).fill(1 / panes.length);
      const snapshot = { panes, activeId, widths };
      for (const id of panes) sessions[id] = snapshot;
    }
    next = { ...next, splitSessions: sessions };
  }
  if (action.do !== "show" && next.panes.length > 1)
    next = { ...next, splitSessions: rememberSplit(next.splitSessions, next.panes, next.activeId, next.splitWidths) };
  // Choosing a tab inside a folded group opens the group along with the tab.
  const opensTab = action.do === "open" || action.do === "openBeside" ||
    action.do === "lookupBeside" || action.do === "show" ||
    action.do === "focusPane" || action.do === "addPane" ||
    (action.do === "add" && action.focus);
  if (opensTab) {
    const tab = next.tabs.find((item) => item.id === next.activeId);
    if (tab?.group != null && next.groups.some((group) => group.id === tab.group && group.collapsed))
      next = { ...next, groups: next.groups.map((group) =>
        group.id === tab.group ? { ...group, collapsed: false } : group) };
  }
  return keepFoldedTabsOffScreen(next);
}

export interface Shell {
  tabs: Tab[];
  groups: Group[];
  panes: number[];
  splitWidths: number[];
  activeId: number | null;
  theme: Theme;
  volume: number;
  /**
   * What each platform's sound is multiplied by, under the master: the key a
   * platform is saved under against its own level, 1 being untouched.
   *
   * A second level of the same control rather than a replacement for it. The
   * master is still `volume` and still the only thing written to `volume` in
   * the settings, so nothing here can change what the master does on its own.
   */
  ready: boolean;

  open: (url: string, options?: { fresh?: boolean }) => void;
  add: (url: string, focus?: boolean, from?: number) => void;
  openBeside: (url: string, from?: number) => void;
  /** Send the dictionary already open to the right to a new word, or open one. */
  lookupBeside: (url: string, from?: number) => void;
  close: (id: number) => void;
  closeAll: () => void;
  closeOthers: (id: number) => void;
  show: (id: number) => void;
  focusPane: (id: number) => void;
  addPane: (id: number) => void;
  dropPane: (id: number) => void;
  clearSplit: () => void;
  setSplitWidths: (widths: number[]) => void;
  move: (id: number, toIndex: number, group?: number | null) => void;
  moveGroup: (groupId: number, atId: number, after: boolean) => void;
  relabel: (id: number, url: string, label: string) => void;
  group: (ids: number[], groupId?: number) => void;
  ungroupTab: (id: number) => void;
  ungroup: (groupId: number) => void;
  closeGroup: (groupId: number) => void;
  nameGroup: (groupId: number, name: string) => void;
  colourGroup: (groupId: number, colour: string) => void;
  collapseGroup: (groupId: number, collapsed: boolean) => void;
  showGroup: (groupId: number) => void;
  setTheme: (theme: Theme) => void;
  setVolume: (volume: number, save: boolean) => void;
}

export function useShell(): Shell {
  const [state, send] = useReducer(reduce, EMPTY);
  const [theme, setThemeState] = useState<Theme>("auto");
  const [volume, setVolumeState] = useState(1);
  // ---- what was open last time ----

  useEffect(() => {
    let dropped = false;
    fetch("/api/central/prefs", { cache: "no-store" })
      .then((r) => r.json())
      .then((prefs) => {
        if (dropped) return;
        if (prefs.theme === "light" || prefs.theme === "dark") {
          setThemeState(prefs.theme);
          keepTheme(prefs.theme);
        } else {
          keepTheme("auto");
        }
        const vol = Number(prefs.volume);
        if (isFinite(vol) && vol >= 0 && vol <= 2) setVolumeState(vol);

        const cached = readCache();
        send({
          do: "boot",
          urls: prefs.tabs?.length ? prefs.tabs : cached.urls,
          at: typeof prefs.tabsAt === "number" ? prefs.tabsAt : cached.at,
          panes: prefs.tabsPanes ?? [],
          groups: Array.isArray(prefs.tabsGroups) ? prefs.tabsGroups : [],
          splitSessions: Array.isArray(prefs.tabsSplitSessions) ? prefs.tabsSplitSessions : [],
        });
      })
      .catch(() => {
        if (dropped) return;
        const cached = readCache();
        send({ do: "boot", urls: cached.urls, at: cached.at, panes: [], groups: [], splitSessions: [] });
      });
    return () => {
      dropped = true;
    };
  }, []);

  // ---- keeping it ----

  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!state.ready) return;
    const urls = state.tabs.map((t) => t.url);
    const at = state.tabs.findIndex((t) => t.id === state.activeId);
    const paneIndexes = state.panes
      .map((id) => state.tabs.findIndex((t) => t.id === id))
      .filter((i) => i >= 0);
    const groups: SavedGroup[] = state.groups.map((g) => ({
      name: g.name,
      colour: g.colour,
      collapsed: g.collapsed,
      at: state.tabs.map((t, i) => (t.group === g.id ? i : -1)).filter((i) => i >= 0),
    }));
    const splitSessions: SavedSplitSession[] = [];
    const seenSessions = new Set<string>();
    for (const saved of Object.values(state.splitSessions)) {
      const panes = saved.panes.map((id) => state.tabs.findIndex((t) => t.id === id)).filter((i) => i >= 0);
      const active = state.tabs.findIndex((t) => t.id === saved.activeId);
      if (panes.length < 2 || active < 0) continue;
      const key = panes.join(",");
      if (seenSessions.has(key)) continue;
      seenSessions.add(key);
      splitSessions.push({ panes, active, widths: saved.widths });
    }

    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ tabs: urls.map((url) => ({ url })), active: at }),
      );
    } catch {
      // A browser with storage turned off still gets its tabs from prefs.
    }

    // Debounced: switching tabs should not post on every click.
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void post({ tabs: urls, tabsAt: at, tabsPanes: paneIndexes, tabsGroups: groups, tabsSplitSessions: splitSessions });
    }, 500);
  }, [state.tabs, state.groups, state.panes, state.activeId, state.splitSessions, state.splitWidths, state.ready]);

  // ---- theme and volume ----

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
  }, [theme]);

  // The head script stamps whatever was saved; on "auto" there is nothing to
  // stamp, and a stale stamp would outlive the choice that made it.
  useEffect(() => {
    if (theme === "auto") {
      try {
        localStorage.setItem(THEME_KEY, "auto");
      } catch {
        // Nothing to keep it in.
      }
    }
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    keepTheme(next);
    void post({ theme: next });
  }, []);

  const setVolume = useCallback((next: number, keep: boolean) => {
    setVolumeState(next);
    if (keep) void post({ volume: next });
  }, []);

  const ordered = state.panes
    .filter((id) => state.tabs.some((t) => t.id === id))
    .sort(
      (a, b) => state.tabs.findIndex((t) => t.id === a) - state.tabs.findIndex((t) => t.id === b),
    );

  return {
    tabs: state.tabs,
    groups: state.groups,
    panes: ordered.length ? ordered : state.activeId ? [state.activeId] : [],
    splitWidths: state.splitWidths,
    activeId: state.activeId,
    theme,
    volume,
    ready: state.ready,

    open: useCallback((url, options) => send({ do: "open", url, fresh: options?.fresh }), []),
    add: useCallback(
      (url: string, focus = true, from?: number) => send({ do: "add", url, focus, from }),
      [],
    ),
    openBeside: useCallback((url: string, from?: number) => send({ do: "openBeside", url, from }), []),
    lookupBeside: useCallback(
      (url: string, from?: number) => send({ do: "lookupBeside", url, from }), []),
    close: useCallback((id: number) => send({ do: "close", id }), []),
    closeAll: useCallback(() => send({ do: "closeAll" }), []),
    closeOthers: useCallback((id: number) => send({ do: "closeOthers", id }), []),
    show: useCallback((id: number) => send({ do: "show", id }), []),
    focusPane: useCallback((id: number) => send({ do: "focusPane", id }), []),
    addPane: useCallback((id: number) => send({ do: "addPane", id }), []),
    dropPane: useCallback((id: number) => send({ do: "dropPane", id }), []),
    clearSplit: useCallback(() => send({ do: "clearSplit" }), []),
    setSplitWidths: useCallback((widths: number[]) => send({ do: "setSplitWidths", widths }), []),
    move: useCallback(
      (id: number, to: number, group?: number | null) => send({ do: "move", id, to, group }),
      [],
    ),
    moveGroup: useCallback(
      (groupId: number, atId: number, after: boolean) =>
        send({ do: "moveGroup", groupId, atId, after }),
      [],
    ),
    relabel: useCallback(
      (id: number, url: string, label: string) => send({ do: "relabel", id, url, label }),
      [],
    ),
    group: useCallback((ids: number[], groupId?: number) => send({ do: "group", ids, groupId }), []),
    ungroupTab: useCallback((id: number) => send({ do: "ungroupTab", id }), []),
    ungroup: useCallback((groupId: number) => send({ do: "ungroup", groupId }), []),
    closeGroup: useCallback((groupId: number) => send({ do: "closeGroup", groupId }), []),
    nameGroup: useCallback(
      (groupId: number, name: string) => send({ do: "nameGroup", groupId, name }),
      [],
    ),
    colourGroup: useCallback(
      (groupId: number, colour: string) => send({ do: "colourGroup", groupId, colour }),
      [],
    ),
    collapseGroup: useCallback(
      (groupId: number, collapsed: boolean) => send({ do: "collapseGroup", groupId, collapsed }),
      [],
    ),
    showGroup: useCallback((groupId: number) => send({ do: "showGroup", groupId }), []),
    setTheme,
    setVolume,
  };
}

function readCache(): { urls: string[]; at: number } {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { urls: [], at: 0 };
    const saved = JSON.parse(raw);
    const urls = (saved?.tabs ?? []).map((o: { url: string }) => o.url).filter(Boolean);
    return { urls, at: typeof saved?.active === "number" ? saved.active : 0 };
  } catch {
    return { urls: [], at: 0 };
  }
}

function post(body: Record<string, unknown>): Promise<unknown> {
  return fetch("/api/central/prefs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}
