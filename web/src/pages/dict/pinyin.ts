/**
 * Pinyin you can press to hear, for every page that shows it: the dictionary
 * and the favourites.
 *
 * Click any pinyin to hear it, syllable by syllable, from the same recordings
 * the Pinyin chart plays.
 */

const MARKS: Record<string, [string, number]> = {
  "ā": ["a", 1], "á": ["a", 2], "ǎ": ["a", 3], "à": ["a", 4],
  "ē": ["e", 1], "é": ["e", 2], "ě": ["e", 3], "è": ["e", 4],
  "ī": ["i", 1], "í": ["i", 2], "ǐ": ["i", 3], "ì": ["i", 4],
  "ō": ["o", 1], "ó": ["o", 2], "ǒ": ["o", 3], "ò": ["o", 4],
  "ū": ["u", 1], "ú": ["u", 2], "ǔ": ["u", 3], "ù": ["u", 4],
  "ǖ": ["ü", 1], "ǘ": ["ü", 2], "ǚ": ["ü", 3], "ǜ": ["ü", 4],
};


const INITIALS = ["", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h",
                  "j", "q", "x", "zh", "ch", "sh", "r", "z", "c", "s",
                  "y", "w"];
const FINALS = ["a", "o", "e", "i", "u", "v", "ai", "ei", "ao", "ou", "an",
                "en", "ang", "eng", "ong", "er", "ia", "ie", "iao", "iu",
                "ian", "in", "iang", "ing", "iong", "ua", "uo", "uai", "ui",
                "uan", "un", "uang", "ueng", "ue", "ve", "van", "vn", "io",
                "n", "ng", "m"];
const SYLLABLES = new Set<string>();
INITIALS.forEach((i) => FINALS.forEach((f) => { if (i || f) SYLLABLES.add(i + f); }));

/** A run with its tone marks taken off, for matching against the list. */
export function plainly(s: string): string {
  return Array.from(s.toLowerCase())
    .map((c) => (MARKS[c] ? MARKS[c][0] : c))
    .join("")
    .split("ü").join("v");
}

/**
 * One run of pinyin as its syllables, with the marks still on them.
 *
 * The pieces are cut out of the original, so what comes back still reads
 * as it was written. A run that will not divide comes back whole.
 */
export function syllables(run: string): string[] {
  if (!run) return [];
  const out: string[] = [];
  let at = 0;
  while (at < run.length) {
    let took = 0;
    for (let size = Math.min(6, run.length - at); size > 0; size--) {
      if (SYLLABLES.has(plainly(run.slice(at, at + size)))) { took = size; break; }
    }
    if (!took) return [run];
    out.push(run.slice(at, at + took));
    at += took;
  }
  return out;
}

/** One syllable's recording, or "" for anything that is not one. */
export function pyFile(tok: string): string {
  let syl = "";
  let tone = 5;
  let ok = false;
  Array.from(tok.toLowerCase()).forEach((ch) => {
    if (MARKS[ch]) {
      syl += MARKS[ch][0];
      tone = MARKS[ch][1];
      ok = true;
    } else if ((ch >= "a" && ch <= "z") || ch === "ü") {
      syl += ch;
      ok = true;
    }
  });
  return ok && syl ? "cmn-" + syl.split("ü").join("v") + tone + ".mp3" : "";
}

let pySeqRun = 0;
export function pyPlaySeq(files: string[]): void {
  // Rapid: every clip preloads at once, the lead-in silence is
  // skipped, and the next syllable starts before the tail plays out.
  const myRun = ++pySeqRun;
  const els = files.map((f) => {
    const a = new Audio("/dictdata/audio/" + f);
    a.preload = "auto";
    return a;
  });
  (function go(i: number) {
    if (myRun !== pySeqRun || i >= els.length) return;
    const a = els[i];
    let advanced = false;
    function next() {
      if (advanced) return;
      advanced = true;
      a.pause();
      go(i + 1);
    }
    // PLAYED WHOLE. This used to start 0.12s in and move on 0.45s before
    // the end, to skip the padding the old recordings carried. The clips
    // are trimmed now, so those offsets cut into the syllable itself --
    // and on a short one (a neutral tone runs about 0.28s) "past
    // duration - 0.45" was true from the first frame, so it advanced
    // immediately and the clip never played at all. Nothing is skipped
    // and nothing is cut: a clip ends when it ends.
    a.onended = next;
    a.onerror = next;
    const p = a.play();
    if (p && p.catch) p.catch(next);
  })(0);
}

/** One piece of a reading as it is drawn, and the recording that plays it --
    "" for what lies between syllables, and for anything that is not one. */
export interface PinyinPiece {
  text: string;
  file: string;
}

/**
 * A reading cut into what is drawn: every syllable a piece of its own with
 * its recording, so a click speaks that syllable alone and never the whole
 * run, and the spaces and punctuation between them as plain text.
 */
export function pinyinPieces(marked: string | null | undefined): PinyinPiece[] {
  const out: PinyinPiece[] = [];
  if (!marked) return out;
  String(marked)
    .split(/(\s+|[·,;/])/)
    .forEach((part) => {
      if (!part) return;
      if (/^(\s+|[·,;/])$/.test(part)) {
        out.push({ text: part, file: "" });
        return;
      }
      // A run written as one word becomes one piece per syllable, so kělè
      // is two things to press and not one that presses nothing.
      syllables(part).forEach((one) => out.push({ text: one, file: pyFile(one) }));
    });
  return out;
}
