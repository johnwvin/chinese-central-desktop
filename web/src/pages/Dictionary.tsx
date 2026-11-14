import { useEffect, useState } from "react";
import { HubPage } from "./HubPage";
import { startDictionary } from "./dict/page";
import { searchModes } from "./dict/search";
import "./dictionary.css";

/** The six tabs, in the order the old page listed them. */
const TABS: [string, string, string, string][] = [
  ["word", "词", "詞", "Word"],
  ["thesaurus", "类属", "類屬", "Thesaurus"],
  ["examples", "例句", "例句", "Examples"],
  ["strokes", "笔顺", "筆順", "Strokes"],
  ["character", "字", "字", "Character"],
  ["etymology", "字源", "字源", "Etymology"],
];

/**
 * The dictionary.
 *
 * A port of DICT_BODY in dictpage.py: the search bar, the six tabs and the
 * six panes. What fills the panes is dict/page.ts, ported from DICT_JS --
 * this is only the frame it writes into, which is why the ids here matter
 * more than they usually would.
 *
 * The panes stay empty in the markup and are never re-rendered: nothing on
 * this component holds state, so React draws it once and then leaves the page
 * to the code that draws characters into it.
 */
export function Dictionary() {
  useEffect(startDictionary, []);
  // "Search Dictionary" on the right-click menu opens this page in a window
  // of its own (window.open, not the app's in-page split view), and a window
  // opened by script is the one kind a script is also allowed to close --
  // window.opener is only ever set on that kind, never on this page's usual
  // tab in the app's own strip.
  const [popped] = useState(() => {
    try {
      return !!window.opener;
    } catch {
      return false;
    }
  });
  return (
    <HubPage name="dictionary">
      {popped && (
        <button
          type="button"
          className="d-close"
          title="Close this window"
          aria-label="Close this window"
          onClick={() => window.close()}
        >
          ×
        </button>
      )}
      <h1>Dictionary</h1>
      <form id="d-search" className="searchbar d-searchbar" role="search" aria-label="Dictionary search">
        <select id="d-mode" aria-label="Search by" title="Search by">
          {Object.entries(searchModes).map(([mode, settings]) => (
            <option key={mode} value={mode}>{settings.label}</option>
          ))}
        </select>
        {/* The field and its clear cross travel together, so the cross can be
            put inside the field's right-hand end. The sizing that used to be
            on the input is here now: the wrapper is what the row lays out. */}
        <span className="d-qwrap">
          <input
            type="search"
            id="d-q"
            placeholder="Search"
            aria-label="Dictionary query"
            autoComplete="off"
            spellCheck={false}
          />
          {/* A button of our own rather than the browser's cross. The native
              one is about fourteen pixels square with an arrow cursor, and
              that is the whole of what can be clicked; this is the height of
              the field and hides the native one. It stays in the markup and
              is hidden by CSS while the field is empty -- `:placeholder-shown`
              rather than React state, because the value is also set from the
              address bar by the page's own script, which no state here would
              hear about. */}
          <button
            type="button"
            className="d-clearq"
            title="Clear the search box"
            aria-label="Clear the search box"
            onClick={() => {
              const box = document.getElementById("d-q") as HTMLInputElement | null;
              if (!box) return;
              box.value = "";
              box.focus();
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </span>
        <select id="d-match" aria-label="Match" title="Match" hidden></select>
        <input id="d-stroke-count" type="number" min="1" max="100" placeholder="Strokes"
          aria-label="Total stroke count" title="Total stroke count" hidden />
        <button
          type="submit"
          className="btn"
          id="d-go"
          title="Search"
          aria-label="Search"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "10px 15px",
            background: "#fdbc1e",
            border: "1px solid #d9a512",
            color: "#000",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            style={{ width: "19px", height: "19px" }}
          >
            <circle cx="11" cy="11" r="7"></circle>
            <path d="m21 21-4.3-4.3"></path>
          </svg>
        </button>
      </form>
      <div className="d-dictionary-tools">
        <div className="script-toggle" id="script-toggle">
          <button type="button" data-s="simp" className="here">
            简 Simplified
          </button>
          <button type="button" data-s="trad">
            繁 Traditional
          </button>
        </div>
        {/* The frequency list, in a tab of its own. It is not a view of
            whatever word is open -- it is the whole list -- so taking the
            dictionary's own pane for it loses the thing you were looking at
            to get somewhere unrelated. target="_blank" is what the strip
            reads as "a tab of its own" (see Frames.tsx), so this opens beside
            the dictionary rather than over it. */}
        <a className="d-ranks" href="/dictionary/ranks" target="_blank" rel="noreferrer">
          频 Frequency
        </a>
        {/* The favourites, beside it and in a tab of their own for the same
            reason: a list, not a view of the word that is open. Words are
            starred from the corner of their headword box (dict/page.ts). */}
        <a className="d-ranks" href="/dictionary/favorites" target="_blank" rel="noreferrer">
          收藏 Favorites
        </a>
        <a className="d-ranks" href="/dictionary/grammar-words" target="_blank" rel="noreferrer">
          Grammar Terms
        </a>
        <span className="quiet" id="d-note"></span>
      </div>
      {/* The way back. Following a character out of an entry replaces what is
          in this pane, so without this the entry you started from is gone and
          only the browser's Back button knows where it went. Filled by
          dict/page.ts; empty and hidden until a lookup is followed. */}
      <nav className="dcrumbs" id="d-crumbs" hidden aria-label="Lookup history"></nav>
      <div className="dtabs" id="d-tabs" hidden>
        {TABS.map(([key, simp, trad, label]) => (
          <button key={key} type="button" data-tab={key}>
            <span className="zh" data-simp={simp} data-trad={trad}>{simp}</span> {label}
          </button>
        ))}
      </div>
      {TABS.map(([key]) => (
        <div key={key} id={"pane-" + key} className="dpane" hidden={key !== "word"}></div>
      ))}
    </HubPage>
  );
}
