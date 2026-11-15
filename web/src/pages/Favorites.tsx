import { useEffect, useMemo, useRef, useState } from "react";
import { HubPage } from "./HubPage";
import { defIn } from "./dict/text";
import { pinyinPieces, plainly, pyPlaySeq } from "./dict/pinyin";
import {
  favoriteKey,
  readFavorites,
  setFavorite,
  watchFavorites,
  type Favorite,
} from "./dict/favorites";
import "./dictionary.css";
import "./favorites.css";

/**
 * The words starred in the dictionary.
 *
 * Drawn as the dictionary's own results table -- the word, how it is said,
 * what it means -- so a favourite reads the way it did on the page it was
 * starred from, with the date it went on and its star to take off again.
 * A word links back to the dictionary at the reading it was starred at, and
 * its pinyin plays syllable by syllable, as it does there.
 */

type Order = "newest" | "oldest";

const STAR =
  "M12 2.8l2.83 5.74 6.33.92-4.58 4.47 1.08 6.3L12 17.25l-5.66 2.98 1.08-6.3-4.58-4.47 6.33-.92z";

/** "2026-09-12T15:04:05" as a date someone would write. */
function when(at: string): string {
  const d = new Date(at);
  if (!at || isNaN(d.getTime())) return at;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Pinyin with its tones, spacing, tone digits and punctuation taken out. */
function barePinyin(s: string): string {
  return plainly(s).replace(/[\s\d'·,;/-]+/g, "");
}

/**
 * Whether a favourite answers what is in the search box: its characters in
 * either script, its meaning, or its pinyin -- with or without the tones, and
 * however it is spaced, so "xing", "xíng" and "xing2" all find 行.
 */
function matches(f: Favorite, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (f.s.includes(q) || (f.t && f.t.includes(q))) return true;
  if (f.d.toLowerCase().includes(q)) return true;
  const py = barePinyin(q);
  return !!py && barePinyin(f.p).includes(py);
}

export function Favorites() {
  const [list, setList] = useState<Favorite[] | null>(null);
  const [failed, setFailed] = useState("");
  const [script, setScript] = useState("simp");
  const [order, setOrder] = useState<Order>("newest");
  const [query, setQuery] = useState("");
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    readFavorites()
      .then(setList)
      .catch(() => setFailed("The favorites could not be read."));
    // Which script the tables speak, and which way this list was last sorted:
    // both live on disk with the rest of the user's settings.
    fetch("/api/central/prefs", { cache: "no-store" })
      .then((r) => r.json())
      .then((p: { script?: string; favoritesOrder?: string }) => {
        if (p.script === "trad" || p.script === "simp") setScript(p.script);
        if (p.favoritesOrder === "newest" || p.favoritesOrder === "oldest") {
          setOrder(p.favoritesOrder);
        }
      })
      .catch(() => {});
    // A star put on or taken off in the dictionary's tab shows up here.
    return watchFavorites(setList);
  }, []);

  // The server keeps the list in the order the stars went on, newest first.
  // That order is exact where the dates are not -- two stars in the same
  // second tie on the date -- so oldest first is that order turned round
  // rather than a sort on the date string.
  const sorted = useMemo(
    () => (order === "newest" ? list || [] : (list || []).slice().reverse()),
    [list, order],
  );
  const rows = useMemo(() => sorted.filter((f) => matches(f, query)), [sorted, query]);
  const searching = query.trim() !== "";

  function sortBy(next: Order) {
    if (next === order) return;
    setOrder(next);
    fetch("/api/central/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favoritesOrder: next }),
    }).catch(() => {});
  }

  function unstar(f: Favorite) {
    const key = favoriteKey(f.s, f.p);
    setList((l) => (l || []).filter((x) => favoriteKey(x.s, x.p) !== key));
    setFavorite(f, false)
      .then(setList)
      .catch(() => {
        setFailed("That star could not be taken off.");
        readFavorites().then(setList).catch(() => {});
      });
  }

  return (
    <HubPage name="dictionary">
      <h1>Favorites</h1>
      {failed && <p className="note">{failed}</p>}

      <div className="fv-bar">
        {/* The dictionary's own field and clear cross (dictionary.css), so the
            two search boxes are one design. It narrows this list; it does not
            look anything up. */}
        <span className="d-qwrap">
          <input
            ref={box}
            type="search"
            className="fv-q"
            placeholder="Search favorites: characters, pinyin, or English"
            aria-label="Search favorites"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            className="d-clearq"
            title="Clear the search box"
            aria-label="Clear the search box"
            onClick={() => {
              setQuery("");
              box.current?.focus();
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
        <span className="fv-sort">
          <span className="fv-bar-label">Sort by date added</span>
          <span className="script-toggle" role="group" aria-label="Sort by date added">
            {(
              [
                ["newest", "Newest first"],
                ["oldest", "Oldest first"],
              ] as [Order, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={order === value ? "here" : ""}
                aria-pressed={order === value}
                onClick={() => sortBy(value)}
              >
                {label}
              </button>
            ))}
          </span>
        </span>
      </div>

      {!list ? (
        <p className="note">Reading…</p>
      ) : !list.length ? (
        <p className="note">Nothing starred yet.</p>
      ) : !rows.length ? (
        <p className="note">Nothing in your favorites matches “{query.trim()}”.</p>
      ) : (
        <div className="ybsec fv">
          <div className="ybhead">
            Favorites ({searching ? rows.length + " of " + list.length : rows.length})
          </div>
          <table className="ybtable">
            <tbody>
              {rows.map((f) => {
                const word = script === "trad" && f.t ? f.t : f.s;
                const href =
                  "/dictionary?q=" +
                  encodeURIComponent(f.s) +
                  (f.p ? "&p=" + encodeURIComponent(f.p) : "");
                return (
                  <tr key={favoriteKey(f.s, f.p)}>
                    <td className="fv-word">
                      <span className="zhword">
                        <a className="zh-link" href={href}>
                          {word}
                        </a>
                      </span>
                    </td>
                    <td className="fv-py">
                      {/* Every syllable its own button, as in the dictionary. */}
                      <span className="pyrun">
                        {pinyinPieces(f.p).map((piece, i) =>
                          piece.file ? (
                            <button
                              key={i}
                              type="button"
                              className="pys"
                              title={"Play " + piece.text}
                              aria-label={"Play " + piece.text}
                              onClick={() => pyPlaySeq([piece.file])}
                            >
                              {piece.text}
                            </button>
                          ) : (
                            <span key={i}>{piece.text}</span>
                          ),
                        )}
                      </span>
                    </td>
                    <td>{defIn(f.d, script)}</td>
                    <td className="fv-at" title={f.at.replace("T", " ")}>
                      {when(f.at)}
                    </td>
                    <td className="fv-off">
                      <button
                        type="button"
                        className="fv-star"
                        title="Remove from favorites"
                        aria-label={"Remove " + word + " from favorites"}
                        onClick={() => unstar(f)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d={STAR} fill="currentColor" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </HubPage>
  );
}

export default Favorites;
