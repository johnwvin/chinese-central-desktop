import { useEffect, useRef, useState } from "react";
import { ActionIcon } from "../../ui/ActionIcon";

export interface FindHit { unit: number; occurrence: number }

function matches(text: string, query: string) {
  const pattern = query.trim().split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return [...text.matchAll(new RegExp(pattern, "giu"))];
}

function textParts(root: ParentNode) {
  let text = "";
  const nodes: { node: Text; start: number; end: number }[] = [];
  const walk = (node: Node) => {
    if (node instanceof Text) {
      nodes.push({ node, start: text.length, end: text.length + node.length });
      text += node.data;
      return;
    }
    if (node instanceof Element && node.matches("script,style,rt,rp,.rd-epub-measure")) return;
    const boundary = node instanceof Element && node.matches("br,p,div,li,article,section,blockquote,h1,h2,h3,h4,h5,h6,tr");
    if (boundary && text && !/\s$/.test(text)) text += " ";
    for (const child of node.childNodes) walk(child);
    if (boundary && text && !/\s$/.test(text)) text += " ";
  };
  walk(root);
  return { text, nodes };
}

export const searchableText = (root: ParentNode) => textParts(root).text;

export function matchRange(root: ParentNode, query: string, occurrence: number) {
  const { text, nodes } = textParts(root);
  const hit = matches(text, query)[occurrence];
  if (!hit) return null;
  const start = hit.index, end = start + hit[0].length;
  const first = nodes.find((part) => part.end > start);
  const last = nodes.find((part) => part.end >= end);
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, Math.max(0, start - first.start));
  range.setEnd(last.node, Math.max(0, end - last.start));
  return range;
}

export function showFindRange(range: Range) {
  CSS.highlights.set("reader-find", new Highlight(range));
  const rect = range.getBoundingClientRect();
  if (rect.height) window.scrollBy(0, rect.top - window.innerHeight / 2);
}

export async function waitForFind<T>(read: () => T | null, signal: AbortSignal): Promise<T | null> {
  const deadline = Date.now() + 12000;
  while (!signal.aborted && Date.now() < deadline) {
    const value = read();
    if (value !== null) return value;
    await new Promise((done) => window.setTimeout(done, 50));
  }
  return null;
}

export function ReaderFind({ units, text, reveal }: {
  units: number;
  text: (unit: number) => Promise<string>;
  reveal: (hit: FindHit, query: string, signal: AbortSignal) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ query: string; hits: FindHit[] } | null>(null);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const methods = useRef({ text, reveal });
  methods.current = { text, reveal };
  const cache = useRef(new Map<number, string>());
  const active = open && result?.query === query ? result.hits[index] : undefined;

  useEffect(() => {
    const show = () => {
      setOpen(true);
      requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
    };
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey
        && (event.key.toLowerCase() === "f" || event.code === "KeyF")) {
        event.preventDefault();
        event.stopPropagation();
        show();
      } else if (open && event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("cc-reader-find", show);
    document.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("cc-reader-find", show);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !query.trim() || !units) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const hits: FindHit[] = [];
      try {
        for (let unit = 0; unit < units && !cancelled; unit++) {
          let content = cache.current.get(unit);
          if (content === undefined) {
            content = await methods.current.text(unit);
            cache.current.set(unit, content);
          }
          matches(content, query).forEach((_, occurrence) => hits.push({ unit, occurrence }));
        }
        if (!cancelled) {
          setResult({ query, hits });
          setIndex(0);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [open, query, units]);

  useEffect(() => {
    const controller = new AbortController();
    if (active) void methods.current.reveal(active, query, controller.signal).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => { controller.abort(); CSS.highlights.delete("reader-find"); };
  }, [active, query]);

  if (!open) return null;
  const total = result?.query === query ? result.hits.length : 0;
  const move = (direction: number) => {
    if (total) setIndex((current) => (current + direction + total) % total);
  };
  return <form className="rd-find" role="search" onSubmit={(event) => { event.preventDefault(); }}>
    <input type="search" ref={input} aria-label="Find in book" placeholder="Find" value={query}
      onChange={(event) => { setFailed(false); setQuery(event.target.value); setResult(null); }}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); move(event.shiftKey ? -1 : 1); } }} />
    <output aria-live="polite">{failed ? "Find unavailable" : !query.trim() ? "" : result?.query !== query ? "…" : total ? `${index + 1} / ${total}` : "0 / 0"}</output>
    <button type="button" disabled={!total} title="Previous match" aria-label="Previous match" onClick={() => move(-1)}><ActionIcon name="up" /></button>
    <button type="button" disabled={!total} title="Next match" aria-label="Next match" onClick={() => move(1)}><ActionIcon name="down" /></button>
    <button type="button" title="Close find" aria-label="Close find" onClick={() => setOpen(false)}><ActionIcon name="close" /></button>
  </form>;
}
