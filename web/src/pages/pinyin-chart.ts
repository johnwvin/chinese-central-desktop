// How the pinyin chart is laid out, and how a syllable is written.
//
// The rows are the initials, grouped into bands; the columns are the finals,
// grouped by their vowel. Which of the two hundred-odd combinations are real
// syllables is not decided here -- it is whichever recordings are on disk,
// which /api/central/pinyin reports.

export const GROUPS: [string, string[]][] = [
  ["A", ["a", "ai", "ao", "an", "ang"]],
  ["O", ["o", "ong", "ou"]],
  ["E", ["e", "ei", "en", "eng", "er"]],
  ["I", ["i", "ia", "iao", "ie", "iu", "ian", "iang", "in", "ing", "iong"]],
  ["U", ["u", "ua", "uo", "ui", "uai", "uan", "un", "uang"]],
  ["Ü", ["ü", "üe", "üan", "ün"]],
];

export const BANDS: string[][] = [
  ["b", "p", "m", "f"],
  ["d", "t", "n", "l"],
  ["z", "c", "s"],
  ["zh", "ch", "sh", "r"],
  ["g", "k", "h"],
  ["j", "q", "x"],
  ["w", "y"],
];

// w and y are not really initials: they are how a final is written when it
// starts the syllable, and the spelling changes as it goes.
const WROW: Record<string, string> = {
  a: "wa", ai: "wai", an: "wan", ang: "wang", o: "wo",
  ei: "wei", en: "wen", eng: "weng", u: "wu",
};

const YROW: Record<string, string> = {
  a: "ya", ao: "yao", an: "yan", ang: "yang", e: "ye",
  i: "yi", in: "yin", ing: "ying", ong: "yong", ou: "you",
  "ü": "yu", "üe": "yue", "üan": "yuan", "ün": "yun",
};

// A syllable whose vowel does not sound the way its column usually does.
const BOLD = new Set([
  "zi", "ci", "si", "zhi", "chi", "shi", "ri",
  "ju", "juan", "jun", "qu", "quan", "qun",
  "xu", "xuan", "xun", "ye", "yan", "wen",
  "yu", "yuan", "yun",
]);

export const isException = (shown: string) => BOLD.has(shown);

const MARKS: Record<string, string> = {
  a: "āáǎà", e: "ēéěè", i: "īíǐì", o: "ōóǒò", u: "ūúǔù", "ü": "ǖǘǚǜ",
};

// Combining macron / acute / caron / grave, for a nasal that is the whole
// syllable and so has to carry the mark itself.
const COMBINING = "̄́̌̀";

/** A recording's name written the way it is read: nv -> nü. */
export function shown(raw: string): string {
  return raw.replace("_", "").split("v").join("ü");
}

/** One syllable with its tone mark on the right vowel. */
export function withTone(syllable: string, tone: string): string {
  const at = Number(tone) - 1;
  if (at < 0 || at > 3) return syllable;

  let pos = -1;
  if (syllable.includes("a")) pos = syllable.indexOf("a");
  else if (syllable.includes("e")) pos = syllable.indexOf("e");
  else if (syllable.includes("ou")) pos = syllable.indexOf("o");
  else {
    for (let i = syllable.length - 1; i >= 0; i--) {
      if (MARKS[syllable.charAt(i)]) {
        pos = i;
        break;
      }
    }
  }
  if (pos >= 0) {
    return syllable.slice(0, pos) + MARKS[syllable.charAt(pos)].charAt(at) + syllable.slice(pos + 1);
  }

  // hm, hng, m, n, ng have no vowel to mark. They are syllabic nasals: the
  // nasal carries the tone itself, so m becomes ḿ and hng becomes hǹg.
  for (let i = 0; i < syllable.length; i++) {
    const ch = syllable.charAt(i);
    if (ch === "m" || ch === "n") {
      return syllable.slice(0, i + 1) + COMBINING.charAt(at) + syllable.slice(i + 1);
    }
  }
  return syllable;
}

/**
 * The recording name for one square of the chart, or null where the initial
 * and the final do not make a syllable.
 */
export function syllableFor(
  initial: string,
  final: string,
  known: Record<string, string[]>,
): string | null {
  if (initial === "w") return WROW[final] ?? null;
  if (initial === "y") return YROW[final] ?? null;

  let f = final;
  if ("jqx".includes(initial)) {
    // After j, q and x the umlaut is not written, and a plain u never
    // follows them.
    if (final === "ü") f = "u";
    else if (final === "üe") f = "ue";
    else if (final === "üan") f = "uan";
    else if (final === "ün") f = "un";
    else if (final.charAt(0) === "u") return null;
  }
  const raw = (initial + f).split("ü").join("v");
  return known[raw] ? raw : null;
}
