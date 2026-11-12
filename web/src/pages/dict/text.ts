/**
 * CC-CEDICT's definition text, for every page that prints it: the dictionary,
 * the frequency list and the favourites.
 */

/* A CROSS-REFERENCE, AS CC-CEDICT WRITES ONE: `traditional|simplified[pinyin]`.

   Both halves used to be printed, so a table set to Simplified still read "as
   in 回來|回来[huí lái]"; the toggle is a toggle, so only the side in force is
   kept. That much was fixed once already -- for the tidy references. The two
   halves were found as runs of CJK and nothing else, so a reference with
   anything else in it kept both: a proverb has a comma in it
   (又要馬兒跑，又要馬兒不吃草|又要马儿跑，又要马儿不吃草), a slang word a
   number (95後|95后) or a letter (B型超聲|B型超声), and a character outside
   the basic block (𪢌) was not in the ranges at all.

   So the halves are found by what bounds them rather than by what is in them:
   a run with no space, slash, bracket or ASCII punctuation on either side of
   the bar, and a Han character somewhere after it. And CC-CEDICT writes the
   two spellings character for character -- all 12,184 references in this
   edition have halves of the same length -- so where the run before the bar
   is the longer, what is extra at its front was only glued to the reference,
   and is kept as text. */
const REF = /([^\s\/|\[\]()"';:,]+)\|([^\s\/|\[\]()"';:,]+)/gu;
const HAN = /\p{Script=Han}/u;

/** A definition, with each cross-reference in the one script asked for. */
export function defIn(s: string | null | undefined, script: string): string {
  return String(s == null ? "" : s).replace(REF, (all: string, left: string, simp: string) => {
    if (!HAN.test(simp)) return all;
    const l = Array.from(left);
    const n = Array.from(simp).length;
    if (l.length < n) return all;
    const glued = l.slice(0, l.length - n).join("");
    const trad = l.slice(l.length - n).join("");
    return glued + (script === "trad" ? trad : simp);
  });
}

/** Preserve the written distinction that a variant cross-reference describes. */
export function entryDisplay(e: { s: string; t: string; d: string[] }, script: string) {
  const refs = /\bvariant of\s+([^\s\[\];,]+)/gi;
  const raw = e.d.join("; ");
  let head = script === "trad" && e.t ? e.t : e.s;
  const targetIn = (forms: string[]) => script === "trad" ? forms[0] : forms[1] || forms[0];
  for (const match of raw.matchAll(refs)) {
    const forms = match[1].split("|");
    if (head === targetIn(forms)) {
      const distinct = [e.t, e.s].find((form) => form && !forms.includes(form));
      if (distinct) head = distinct;
    }
  }
  const senses = e.d.map((sense) => sense.replace(refs, (_all, reference: string) => {
    const forms = reference.split("|");
    const preferred = targetIn(forms);
    const target = preferred === head ? forms.find((form) => form !== head) || preferred : preferred;
    return "variant of " + target;
  })).map((sense) => defIn(sense, script));
  return {
    head,
    senses,
    definition: senses.join("; "),
    variantOnly: e.d.length > 0 && e.d.every((field) => /\bvariant of\s/i.test(field)),
  };
}
