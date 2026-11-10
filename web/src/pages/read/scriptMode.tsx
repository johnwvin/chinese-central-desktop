import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/central";
import { remember, remembered } from "./pdfjs";
import simplifiedToTraditional from "./script-data/STCharacters.txt?raw";
import traditionalToSimplified from "./script-data/TSCharacters.txt?raw";
import traditionalToSimplifiedPhrases from "./script-data/TSPhrases.txt?raw";

export type ReaderScript = "simp" | "trad";

const PREF_KEY = "cc-reader-script";
const originalNodes = new WeakMap<Text, string>();
const originalSpans = new WeakMap<HTMLElement, string>();

type Maps = {
  simpToTrad: Map<string, string>;
  tradToSimp: Map<string, string>;
};

function oneToOneCharacters(rows: string): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  for (const row of rows.split(/\r?\n/)) {
    if (row.startsWith("#")) continue;
    const [source, values] = row.split("\t", 2);
    if ([...source].length !== 1 || !values) continue;
    const possible = candidates.get(source) ?? new Set<string>();
    for (const target of values.trim().split(/\s+/)) possible.add(target);
    candidates.set(source, possible);
  }
  const result = new Map<string, string>();
  for (const [source, possible] of candidates) {
    if (possible.size !== 1) continue;
    const target = possible.values().next().value;
    if (target && [...target].length === 1) result.set(source, target);
  }
  return result;
}

// OpenCC lists the preferred output first. Discarding rows with alternatives
// left traditional/variant forms such as 麼 and 麽 unchanged in simplified mode.
function preferredForms(rows: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const row of rows.split(/\r?\n/)) {
    if (!row || row.startsWith("#")) continue;
    const [source, values] = row.split("\t", 2);
    const target = values?.trim().split(/\s+/)[0];
    if (source && target) result.set(source, target);
  }
  return result;
}

const maps: Maps = {
  simpToTrad: oneToOneCharacters(simplifiedToTraditional),
  tradToSimp: preferredForms(traditionalToSimplified),
};

// Match whole phrases before characters so meaning-dependent forms and names
// (for example 乾隆) survive conversion correctly.
const simplifiedPhrases = new Map<string, { source: string; target: string }[]>();
for (const [source, target] of preferredForms(traditionalToSimplifiedPhrases)) {
  const first = String.fromCodePoint(source.codePointAt(0)!);
  const group = simplifiedPhrases.get(first) ?? [];
  group.push({ source, target });
  simplifiedPhrases.set(first, group);
}
for (const group of simplifiedPhrases.values()) group.sort((a, b) => b.source.length - a.source.length);

function convert(text: string, script: ReaderScript, maps: Maps): string {
  const replacements = script === "trad" ? maps.simpToTrad : maps.tradToSimp;
  let converted = "";
  for (let offset = 0; offset < text.length;) {
    const character = String.fromCodePoint(text.codePointAt(offset)!);
    const phrase = script === "simp"
      ? simplifiedPhrases.get(character)?.find(({ source }) => text.startsWith(source, offset))
      : undefined;
    if (phrase) {
      converted += phrase.target;
      offset += phrase.source.length;
    } else {
      converted += replacements.get(character) ?? character;
      offset += character.length;
    }
  }
  return converted;
}

export function convertScriptText(text: string, script: ReaderScript): string {
  return convert(text, script, maps);
}

export function useReaderScript() {
  const [script, setScriptState] = useState<ReaderScript>(() =>
    remembered(PREF_KEY) === "trad" ? "trad" : "simp",
  );

  useEffect(() => {
    let live = true;
    void api.prefs().then((prefs) => {
      const saved = prefs.script === "trad" ? "trad" : "simp";
      if (live) setScriptState(saved);
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);

  const setScript = useCallback((next: ReaderScript) => {
    setScriptState(next);
    remember(PREF_KEY, next);
    void api.savePrefs({ script: next }).catch(() => undefined);
  }, []);
  return { script, setScript };
}

export function ScriptToggle({ script, onChange }: {
  script: ReaderScript;
  onChange: (script: ReaderScript) => void;
}) {
  return (
    <div className="rd-script-control" role="group" aria-label="Chinese character script">
      <span>Characters</span>
      <div className="rd-script-toggle">
        <button type="button" aria-pressed={script === "simp"} onClick={() => onChange("simp")}>简体</button>
        <button type="button" aria-pressed={script === "trad"} onClick={() => onChange("trad")}>繁體</button>
      </div>
    </div>
  );
}

export async function applyEpubScript(root: HTMLElement, script: ReaderScript): Promise<void> {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.parentElement?.closest("script,style,noscript")) continue;
    nodes.push(node);
  }
  for (const node of nodes) {
    if (!originalNodes.has(node)) originalNodes.set(node, node.data);
    node.data = convert(originalNodes.get(node) ?? node.data, script, maps);
  }
}

export async function applyPdfTextLayer(root: HTMLElement, script: ReaderScript): Promise<void> {
  const spans = [...root.querySelectorAll<HTMLElement>("span:not(.markedContent):not(.endOfContent)")];
  for (const span of spans) {
    if (!originalSpans.has(span)) originalSpans.set(span, span.textContent ?? "");
    const original = originalSpans.get(span) ?? "";
    const converted = convert(original, script, maps);
    span.textContent = converted;
    if (converted !== original) {
      // PDF text is painted into the page canvas. This positioned text replaces
      // only the converted run while keeping the original PDF file unchanged.
      span.style.color = "#000";
      span.style.backgroundColor = "#fff";
      span.style.zIndex = "3";
    } else {
      span.style.removeProperty("color");
      span.style.removeProperty("background-color");
      span.style.removeProperty("z-index");
    }
  }
}
