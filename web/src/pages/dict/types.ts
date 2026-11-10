/**
 * What `/api/central/dict?q=` answers, as the page reads it.
 *
 * The wire's own names are kept exactly (`s`, `t`, `p`, `d`, `udef`,
 * `radch`, `related_by_entry`), the way the rest of src/api does, so that
 * nothing sits between this page and the capture that proves the Go server
 * and the Python one agree. Fields are optional where the server leaves them
 * out rather than sending an empty one.
 */

/** One dictionary entry: simplified, traditional, pinyin, definitions. */
export interface Entry {
  s: string;
  t: string;
  p: string;
  d: string[];
}

/** How a character was formed, when the etymology knows. */
export interface Etymology {
  type: string;
  hint?: string;
  semantic?: string;
  phonetic?: string;
}

/** A node of the decomposition tree: a character and what it is made of. */
export interface TreeNode {
  ch: string;
  idc?: string;
  py?: string;
  gloss?: string;
  py_status?: string;
  gloss_status?: string;
  hint?: string;
  source?: string;
  symbol?: boolean;
  roles?: string[];
  kids?: TreeNode[];
}

/** One character's own record. */
export interface CharInfo {
  ch: string;
  mandarin?: string;
  cantonese?: string;
  udef?: string;
  defs?: { p: string; d: string[] }[];
  strokes?: number | string;
  stroke?: boolean;
  radical?: number | string;
  radch?: string;
  cangjie?: string;
  fourcorner?: string;
  unicode?: string;
  grade?: string;
  band?: number | string;
  gsn?: string;
  hsk?: string;
  rank?: number;
  trad?: string;
  simp?: string;
  decomp?: string;
  ety?: Etymology;
  tree?: TreeNode;
  tree_source?: string;
  dong_hint?: string;
}

/** The four kinds of neighbour a reading has. */
export interface Related {
  head?: Entry[];
  tail?: Entry[];
  derived?: Entry[];
  similar?: Entry[];
}

/** One word found inside a longer piece of text. */
export interface Segment {
  w: string;
  py?: string;
  gloss?: string;
  entries: Entry[];
}

// One sense of one reading, and the words that share it.
export interface Sense {
  gloss: string;
  similar: Entry[];
}

export interface EntryThesaurus {
  py: string;
  senses: Sense[];
  seealso: Entry[];
  measure: Entry[];
  /** Wiktionary edition(s) when the exact headword supplied the classifiers. */
  measure_source?: string;
}

export interface DictData {
  q: string;
  entries: Entry[];
  chars: CharInfo[];
  parts?: { ch: string; py: string; entries: Entry[] }[];
  parts_by_entry?: { ch: string; py: string; entries: Entry[] }[][];
  pos?: string;
  /** The parts of speech of each entry, in the entries' order: keys such as
      "noun", "verb", "measure". 好 is an adjective as hǎo and a verb as hào,
      so this belongs to a reading rather than to the word. See pos.go. */
  pos_by_entry?: string[][];
  thesaurus?: { similar: Entry[]; seealso: Entry[]; measure: Entry[] };
  // The same thing kept apart by reading and by sense, which is how it is
  // shown: 会 is huì, to know how to and to meet, and it is also kuài, to
  // reckon accounts, and those do not share a synonym between them.
  thesaurus_by_entry?: EntryThesaurus[];
  /** Sentence, translation, and how the word is said in it ("" when the
      dictionary cannot say). See readingIn in go/internal/dict. */
  examples?: [string, string, string?][];
  related?: Related;
  related_by_entry?: Related[];
  segments?: Segment[];
  error?: string;
  // Shown before anything has been searched for: how much there is to search.
  total?: number;
  sents?: number;
}
