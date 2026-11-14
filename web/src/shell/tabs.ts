// What a tab is, what it is called, and what mark it wears.
//
// A tab is a page the app is holding open. Its frame is kept alive while the
// tab exists -- switching away hides it rather than throwing it away -- so a
// video keeps its place and a half-typed note is still there when you come
// back.

export interface Tab {
  id: number;
  /**
   * Where this tab is now: what it is named from, what its mark is chosen
   * from, and what is written down for next time. A page that navigates
   * itself moves this.
   */
  url: string;
  /**
   * Where the frame was pointed when the tab was made, and never again.
   *
   * The two are separate because the frame's `src` is an instruction, not a
   * description: writing to it loads that address afresh. While they were one
   * field, a page that moved -- the dictionary following a word --
   * had its own new address written back into its frame a moment later and
   * reloaded itself on the spot. That is the flash.
   */
  src: string;
  label: string;
  /** A request to navigate the existing frame, including repeated lookups. */
  nav?: { url: string };
  /** The group this tab belongs to, if any. */
  group?: number;
}

/**
 * A named, coloured run of tabs, the way Chrome does them.
 *
 * A group's tabs are always next to each other in the strip -- that is what
 * makes it a group and not a label -- so putting a tab in one moves it to sit
 * with the rest. Home is never in a group: it is the pinned tab and it holds
 * the first slot.
 */
export interface Group {
  id: number;
  name: string;
  colour: string;
  collapsed: boolean;
}

/** The colours a group can wear, in the order new ones take them. */
export const GROUP_COLOURS = [
  "#4a8cf7", // blue
  "#e0664c", // red
  "#e0a33a", // yellow
  "#4aab6e", // green
  "#a97ae0", // purple
  "#3fb0b8", // cyan
  "#e07ab0", // pink
  "#8a949f", // grey
];

/** The colour a new group takes: the first one nothing else is wearing. */
export function nextColour(taken: readonly Group[]): string {
  const worn = new Set(taken.map((g) => g.colour));
  return GROUP_COLOURS.find((c) => !worn.has(c)) ?? GROUP_COLOURS[taken.length % GROUP_COLOURS.length];
}

/** The pages the strip's menu can open, and what they are called. */
export const PAGES: { path: string; name: string; fresh?: boolean }[] = [
  // Looking two words up side by side is the point of the dictionary, so it
  // opens a fresh tab rather than stealing the one already open.
  { path: "/dictionary", name: "Dictionary", fresh: true },
  { path: "/pinyin", name: "Pinyin chart" },
  { path: "/games", name: "Study Tools" },
  { path: "/hsk", name: "HSK Prep" },
  { path: "/browser", name: "Browser", fresh: true },
  { path: "/notes", name: "Notebook" },
  { path: "/books", name: "Books" },
  { path: "/control", name: "Control" },
];

const NAMES: Record<string, string> = {
  "/": "Home",
  "/home": "Home",
  "/dictionary": "Dictionary",
  "/pinyin": "Pinyin chart",
  "/games": "Study Tools",
  "/hsk": "HSK Prep",
  "/browser": "Browser",
  "/notes": "Notebook",
  "/books": "Books",
  "/control": "Control",
  "/source": "Sources",
  "/dictionary/ranks": "Frequency Ranks",
  "/dictionary/favorites": "Favorites",
  "/dictionary/grammar-words": "Grammar Words",
};

// The same marks the game cards wear, so a game's tab looks like the card it
// came from. The colour is taken off them in the strip -- see .ic in
// shell.css -- so the row reads as one set and not as a row of stickers.
const GAME_ICON: Record<string, string> = {
  date: "\u{1F4C5}", time: "\u{1F552}",
};

const PAGE_ICON: Record<string, string> = {
  "/home": "\u{1F3E0}", "/dictionary": "\u{1F4D6}", "/pinyin": "\u{1F50A}",
  "/games": "\u270F\uFE0F", "/notes": "\u{1F4DD}",
  "/hsk": "\u{1F393}",
  "/browser": "\u{1F310}",
  "/books": "\u{1F4DA}", "/control": "\u2699\uFE0F",
  "/source": "\u{1F4C3}",
  // The dictionary's two lists: the characters by how common they are, and
  // the words that have been starred.
  "/dictionary/ranks": "\u{1F4CA}", "/dictionary/favorites": "\u2B50",
};

export type Icon = { text: string } | { img: string };

/** Split a tab's URL without minding that it may be relative. */
export function parse(url: string): URL {
  try {
    return new URL(url, window.location.origin);
  } catch {
    return new URL("/", window.location.origin);
  }
}

/** A real page, as opposed to the empty document a frame stands on. */
export function realUrl(url: string): string {
  try {
    const u = new URL(String(url || ""), window.location.origin);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : "";
  } catch {
    return "";
  }
}

export function iconFor(url: string): Icon {
  const u = parse(url);
  const path = u.pathname;

  if (path === "/games") {
    const game = u.searchParams.get("game");
    if (game && GAME_ICON[game]) return { text: GAME_ICON[game] };
  }
  if (path === "/books/read" || path.startsWith("/bookfile/")) {
    return { text: /\.pdf$/i.test(path + u.search) ? "\u{1F4C4}" : "\u{1F4D7}" };
  }
  // A word looked up is not the same kind of page as the dictionary sitting
  // waiting for one, so it does not wear the same mark. There is no emoji of a
  // book with a glass over it, so the glass alone stands for the search.
  if (path === "/dictionary" && u.searchParams.get("q")) return { text: "\u{1F50D}" };
  if (PAGE_ICON[path]) return { text: PAGE_ICON[path] };

  return { text: "\u25CB" };
}

/**
 * What a tab is called.
 *
 * `doc` is the frame's document when it has one: several pages can only be
 * named by what is actually on screen, which is not always what was asked for
 * -- the dictionary's headword changes as you follow cross-references without
 * the address changing with it.
 */
export function labelFor(url: string, doc: Document | null): string {
  const u = parse(url);
  const path = u.pathname;
  const q = u.searchParams.get("q");

  if (path === "/dictionary") {
    const head = doc?.querySelector(".hwbox .ch")?.textContent?.trim();
    if (head) return head;
    // No headword: this is a list of what matched, so the tab wears the words
    // that were searched for rather than passing them off as an entry.
    return q ? `“${q}”` : "Dictionary";
  }
  if (path === "/notes" && u.searchParams.has("note")) {
    // One note in its own tab: the tab wears the note's title, which changes
    // as it is typed.
    const box = doc?.getElementById("nb-title") as HTMLInputElement | null;
    return box?.value.trim() || "Note";
  }
  if (path === "/games") {
    const game = u.searchParams.get("game");
    if (game) {
      const heading = doc?.querySelector(`.gamecard[data-game="${game}"] h3`);
      return heading?.textContent?.trim() || "Game";
    }
  }
  if (path.startsWith("/bookfile/")) {
    return decodeURIComponent(stem(path.split("/").pop() || ""));
  }
  if (path === "/books/read") {
    const file = u.searchParams.get("f");
    return file ? stem(file.split("/").pop() || "") : "Book";
  }
  if (NAMES[path]) return NAMES[path];

  const bits = path.split("/").filter(Boolean);
  return decodeURIComponent(bits[bits.length - 1] || "Page");
}

/**
 * A name short enough to be a chip.
 *
 * A group made from a book takes the book's name, and a book's name is the
 * whole file it came from -- author, publisher, and whichever mirror it was
 * downloaded from. The chip is a handle, not a citation.
 */
export function shortName(label: string): string {
  const clean = label.replace(/\s*\([^)]*\)\s*$/, "").trim() || label.trim();
  if (clean.length <= 24) return clean;
  const cut = clean.slice(0, 24);
  const space = cut.lastIndexOf(" ");
  return (space > 12 ? cut.slice(0, space) : cut).trimEnd() + "…";
}

function stem(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "");
}

// A label that is Chinese is set bigger; one with a character or two in an
// English title is not, or the line would jump about.
const ALL_CJK = /^[\s　-鿿豈-﫿＀-￯]+$/;

export function isCJK(label: string): boolean {
  return ALL_CJK.test(label);
}
