import { useCallback, useEffect, useState } from "react";
import { HubPage } from "./HubPage";
import "./ranks.css";

/**
 * The characters in the order they are actually used.
 *
 * A frequency rank was only ever readable one character at a time -- open
 * something and it says "#2892", which tells you where that one sits and
 * nothing about what is around it. This is the list: the hundred commonest
 * first, then the next four hundred, and out to the tail in widening bands.
 *
 * WHY THE BANDS ARE UNEVEN. The first hundred are not a hundredth of the work
 * of the first ten thousand, they are most of what is on any page, so they get
 * a band to themselves. The bands widen as the characters get rarer, because
 * past a point one more character is worth less than the one before it and a
 * band of a thousand is the right size to look at.
 *
 * One band is fetched at a time. All ten thousand with their readings and
 * meanings is a payload nobody needs to be handed to look at the first
 * hundred.
 */

interface BandRow {
  from: number;
  to: number;
  n: number;
}
interface CharRow {
  ch: string;
  rank: number;
  hsk: string;
  py: string;
}

export function Ranks() {
  const [bands, setBands] = useState<BandRow[] | null>(null);
  const [open, setOpen] = useState<BandRow | null>(null);
  const [chars, setChars] = useState<CharRow[] | null>(null);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    fetch("/api/central/ranks", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setBands(d.bands || []))
      .catch(() => setFailed("The frequency list could not be read."));
  }, []);

  const show = useCallback((b: BandRow) => {
    setOpen(b);
    setChars(null);
    fetch(`/api/central/ranks?from=${b.from}&to=${b.to}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setChars(d.chars || []))
      .catch(() => setFailed("That band could not be read."));
  }, []);

  // The first band is what anyone came for, so it is already open.
  useEffect(() => {
    if (bands && bands.length && !open) show(bands[0]);
  }, [bands, open, show]);

  return (
    <HubPage name="dictionary">
      <h1>Frequency Ranks</h1>
      {failed && <p className="note">{failed}</p>}

      <div className="rk-bands">
        {(bands || []).map((b) => (
          <button
            key={b.from}
            type="button"
            className={"rk-band" + (open && open.from === b.from ? " here" : "")}
            onClick={() => show(b)}
          >
            <b>
              {b.from}–{b.to}
            </b>
            <span>{b.n.toLocaleString()} characters</span>
          </button>
        ))}
      </div>

      {open && (
        <div className="rk-list">
          <div className="rk-head">
            {open.from}–{open.to}
          </div>
          {!chars ? (
            <p className="note">Reading…</p>
          ) : (
            <div className="rk-grid">
              {chars.map((c) => (
                <a
                  key={c.rank}
                  className="rk-cell"
                  href={"/dictionary?q=" + encodeURIComponent(c.ch)}
                >
                  <span className="rk-n">#{c.rank}</span>
                  <span className="rk-ch">{c.ch}</span>
                  <span className="rk-py">{c.py}</span>
                  {c.hsk && c.hsk !== "0" && <span className="rk-hsk">HSK {c.hsk}</span>}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </HubPage>
  );
}

export default Ranks;
