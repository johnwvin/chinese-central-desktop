export const searchModes = {
  auto: { label: "Auto", placeholder: "Search", matches: [] },
  english: {
    label: "English",
    placeholder: "Search English definitions",
    matches: [["phrase", "Whole words"], ["exact", "Exact definition"], ["contains", "Contains text"]],
  },
  pinyin: {
    label: "Pinyin",
    placeholder: "Pinyin (e.g. nǐ hǎo or ni3 hao3)",
    matches: [["exact", "Exact reading"], ["starts", "Starts with"]],
  },
  chinese: {
    label: "Characters",
    placeholder: "Chinese character or word",
    matches: [["contains", "Contains"], ["exact", "Exact word"], ["starts", "Starts with"], ["ends", "Ends with"]],
  },
  radical: { label: "Radical / strokes", placeholder: "Radical or Kangxi number", matches: [] },
} as const;

type SearchMode = keyof typeof searchModes;

export function searchMode(value: string | null): SearchMode {
  return value && Object.hasOwn(searchModes, value) ? value as SearchMode : "auto";
}

export function searchParams(q: string, mode: string, match = "", strokes = ""): URLSearchParams {
  const params = new URLSearchParams({ q: q.trim() });
  const type = searchMode(mode);
  if (type === "auto") return params;
  params.set("mode", type);
  const matches = searchModes[type].matches;
  if (matches.length) {
    params.set("match", matches.find(([value]) => value === match)?.[0] ?? matches[0][0]);
  }
  if (type === "radical" && strokes) params.set("strokes", strokes);
  return params;
}

export function queryLabel(params: URLSearchParams): string {
  const query = params.get("q") ?? "";
  const strokes = params.get("strokes");
  return [query, strokes && `${strokes} strokes`].filter(Boolean).join(" · ");
}
