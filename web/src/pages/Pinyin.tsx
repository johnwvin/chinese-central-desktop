import { useEffect, useMemo, useRef, useState } from "react";
import { HubPage } from "./HubPage";
import { BANDS, GROUPS, isException, shown, syllableFor, withTone } from "./pinyin-chart";
import "./pinyin.css";

type Tone = "all" | "1" | "2" | "3" | "4" | "5";

const TONES: [Tone, string][] = [
  ["all", "All tones"],
  ["1", "1 ā"],
  ["2", "2 á"],
  ["3", "3 ǎ"],
  ["4", "4 à"],
  // The neutral tone carries no mark -- that absence is the point, so its
  // button shows the bare vowel.
  ["5", "5 a"],
];

export function Pinyin() {
  const [known, setKnown] = useState<Record<string, string[]> | null>(null);
  const [tone, setTone] = useState<Tone>("all");
  const [playing, setPlaying] = useState<string | null>(null);
  const play = usePlayer(setPlaying);

  useEffect(() => {
    fetch("/api/central/pinyin", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setKnown(d.syl ?? {}))
      .catch(() => setKnown({}));
  }, []);

  const syllables = known ?? {};
  const ready = Object.keys(syllables).length > 0;

  // Which recordings the table itself uses, so the rest can be listed under it.
  const { rows, placed } = useMemo(() => build(syllables), [syllables]);
  const leftovers = useMemo(
    () => Object.keys(syllables).filter((raw) => !placed.has(raw)).sort(),
    [syllables, placed],
  );

  const neutral = useMemo(
    () => Object.keys(syllables).filter((raw) => (syllables[raw] ?? []).includes("5")).length,
    [syllables],
  );

  const hit = (raw: string) => {
    const has = syllables[raw] ?? [];
    const wanted = (tone === "all" ? ["1", "2", "3", "4", "5"] : [tone]).filter((t) =>
      has.includes(t),
    );
    if (wanted.length) play(raw, wanted);
  };

  const cell = (raw: string, extraBold = false) => {
    // A chosen tone puts its mark on every syllable; ones never recorded in
    // that tone go quiet. All tones shows them bare.
    const has = (syllables[raw] ?? []).includes(tone);
    const text = tone === "all" || !has ? shown(raw) : withTone(shown(raw), tone);
    return (
      <button
        key={raw}
        type="button"
        className={
          "pcell" +
          (extraBold || isException(shown(raw)) ? " xb" : "") +
          (playing === raw ? " playing" : "") +
          (tone !== "all" && !has ? " off" : "")
        }
        onClick={() => hit(raw)}
      >
        {text}
      </button>
    );
  };

  return (
    <HubPage name="pinyin">
      <h1>Pinyin chart</h1>

      <div className="tonebar">
        {TONES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={value === tone ? "here" : undefined}
            onClick={() => setTone(value)}
          >
            {label}
          </button>
        ))}
        <span className="quiet">
          {tone === "all"
            ? "All tones plays a syllable through every tone."
            : tone === "5"
              ? `The neutral tone is written with no mark at all. Only these ${neutral} syllables take one; the rest never do.`
              : ""}
        </span>
      </div>

      {ready && (
        <div className="pwrap">
          <table className="pchart">
            <tbody>
              <tr>
                <th className="ghead" />
                {GROUPS.map(([name, finals]) => (
                  <th className="ghead" colSpan={finals.length} key={name}>
                    {name}
                  </th>
                ))}
              </tr>

              {/* The finals, and where a final is a syllable all by itself --
                  a, ai, ao, e, en, er -- the label is that syllable and plays
                  it. There used to be a second copy of this row along the
                  bottom carrying those; one row of finals is enough, and the
                  one at the top is the one being read across. */}
              <tr>
                <th className="sub" />
                {GROUPS.flatMap(([name, finals]) =>
                  finals.map((final, i) => {
                    const raw = final.split("ü").join("v");
                    return (
                      <th className={"sub" + (i === 0 ? " gstart" : "")} key={name + final}>
                        {syllables[raw] ? cell(raw) : final}
                      </th>
                    );
                  }),
                )}
              </tr>

              {rows.map((row) => (
                <tr className={row.className} key={row.initial + row.className}>
                  <td className="lead">{row.initial}</td>
                  {row.cells.map((raw, i) => (
                    <td className={row.starts.has(i) ? "gstart" : undefined} key={i}>
                      {raw ? cell(raw) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="pnote">
        A <b>bold</b> syllable is an exception: its vowel does not sound the way the column
        usually does (<b>zi</b> vs. ni, <b>yan</b> vs. ban, <b>ye</b> vs. de, <b>yuan</b> vs.
        duan).
      </div>

      <div id="others">
        {!ready && known && (
          <>The recordings haven't been downloaded yet — use the Dictionary card on the Control page.</>
        )}
        {ready && leftovers.length > 0 && (
          <>
            <div className="quiet" style={{ margin: "0 0 8px" }}>
              Interjections and rare syllables
            </div>
            {leftovers.map((raw) => cell(raw))}
          </>
        )}
      </div>

      <div className="pcredit">
        Four tones: the Chinese Language Institute (studycli.org). Neutral tone: YellowBridge.
        Rare syllables and the interjections: Chen Wang, Shtooka project, CC&nbsp;BY-SA.
      </div>
    </HubPage>
  );
}

interface Row {
  initial: string;
  className: string;
  cells: (string | null)[];
  starts: Set<number>;
}

function build(known: Record<string, string[]>) {
  const rows: Row[] = [];
  const placed = new Set<string>();

  BANDS.forEach((band, bandAt) => {
    band.forEach((initial, at) => {
      const cells: (string | null)[] = [];
      const starts = new Set<number>();
      GROUPS.forEach(([, finals]) => {
        finals.forEach((final, i) => {
          if (i === 0) starts.add(cells.length);
          const raw = syllableFor(initial, final, known);
          if (raw) placed.add(raw);
          cells.push(raw);
        });
      });
      rows.push({
        initial,
        className: (bandAt % 2 ? "bandB" : "bandA") + (at === 0 ? " bandtop" : ""),
        cells,
        starts,
      });
    });
  });

  // The vowel-only row at the foot of the table.
  GROUPS.forEach(([, finals]) =>
    finals.forEach((final) => {
      const raw = final.split("ü").join("v");
      if (known[raw]) placed.add(raw);
    }),
  );

  return { rows, placed };
}

/**
 * Plays one syllable through the tones asked for, one after another.
 *
 * Skipping 0.12s in and cutting 0.45s off the end trims the silence the
 * four-tone recordings are padded with, at about 1.1s each. The neutral tones
 * run 0.17-0.41s, where those same trims land past the end of the file and it
 * never plays at all -- so only a recording long enough is trimmed.
 */
function usePlayer(setPlaying: (raw: string | null) => void) {
  const run = useRef(0);

  useEffect(() => {
    return () => {
      run.current++;
    };
  }, []);

  return (raw: string, tones: string[]) => {
    const mine = ++run.current;
    setPlaying(raw);

    const clips = tones.map((t) => {
      const audio = new Audio(`/dictdata/audio/cmn-${raw}${t}.mp3`);
      audio.preload = "auto";
      return audio;
    });

    const step = (at: number) => {
      if (mine !== run.current) return;
      if (at >= clips.length) {
        setPlaying(null);
        return;
      }
      const audio = clips[at];
      let moved = false;
      const next = () => {
        if (moved) return;
        moved = true;
        audio.pause();
        step(at + 1);
      };
      // PLAYED WHOLE. This used to start 0.12s in and move on 0.45s before
      // the end, to skip the silence the old recordings were padded with.
      // The clips are trimmed now, so those offsets took the syllable
      // itself. Nothing is skipped and nothing is cut: a clip runs to its
      // own end and the next one follows.
      audio.onended = next;
      audio.onerror = next;
      void audio.play().catch(next);
    };
    step(0);
  };
}
