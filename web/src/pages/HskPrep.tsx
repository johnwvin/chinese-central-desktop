import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { HubPage } from "./HubPage";
import { ActionIcon } from "../ui/ActionIcon";
import { defIn } from "./dict/text";
import { grammarLabel } from "./hsk/labels";
import { GrammarBrowser } from "./hsk/GrammarBrowser";
import { hskList, hskVocabulary, LEVELS, studyData, watchStudy, type Level, type Progress, type StudyData, type StudyStatus, type Vocab } from "./hsk/study";
import "./hsk-prep.css";

type LevelFilter = "selection" | "all" | Level;
type LevelSort = "auto" | "source" | "category" | "asc" | "desc";
type Kind = "vocabulary" | "grammar";
interface GrammarExample { chinese: string; pinyin?: string; english?: string }
interface Grammar { id: string; level: Level; path: string[]; title?: string; content: string[]; pages?: number[]; explanation: string | string[]; examples?: GrammarExample[] }
interface Source { title: string; website: string; url: string; published: string; effective: string; retrieved: string }
interface Data { vocabulary: Vocab[]; grammar: Grammar[]; source: Source }
type Item = { kind: "vocabulary"; value: Vocab } | { kind: "grammar"; value: Grammar };
interface Session { cards: Item[]; index: number; flipped: boolean; answers: number }
const KEY = "cc.hsk-prep.review.v1";
const STATUS_KEY = "cc.hsk-prep.status.v1";
const LIST_KEY = "cc.hsk-prep.page-size.v1";
const STATUS_LABELS: Record<StudyStatus, string> = { review: "复习", unlearned: "未学习", memorized: "已掌握" };
const PAGE_SIZES = [10, 25, 50, 100, 250];
const MAX_VOCAB_PAGE = 250;
function readPageSizes(): Record<Kind, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(LIST_KEY) ?? "{}");
    const valid = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0;
    return { vocabulary: valid(saved?.vocabulary) ? Math.min(saved.vocabulary || MAX_VOCAB_PAGE, MAX_VOCAB_PAGE) : 50, grammar: valid(saved?.grammar) ? saved.grammar : 50 };
  } catch { return { vocabulary: 50, grammar: 50 }; }
}

let loading: Promise<Data> | undefined;
function load(): Promise<Data> {
  if (!loading) loading = Promise.all([hskVocabulary(), hskList<Grammar[]>("grammar"), hskList<Source>("source")])
    .then(([vocabulary, grammar, source]) => ({ vocabulary, grammar, source }))
    .catch((error) => { loading = undefined; throw error; });
  return loading;
}
function readProgress(): Progress {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => v && typeof v === "object" &&
      Number.isFinite(v.due) && Number.isFinite(v.streak) && Number.isFinite(v.seen) && typeof v.known === "boolean"));
  } catch { return {}; }
}
function readStatuses(): Record<string, StudyStatus> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STATUS_KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, value]) => value === "review" || value === "unlearned" || value === "memorized")) as Record<string, StudyStatus>;
  } catch { return {}; }
}
function shuffled<T>(values: T[]): T[] {
  const result = values.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function folded(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[\s’'·-]/g, "");
}
function title(point: Grammar): string {
  return point.title || grammarLabel(point.path[point.path.length - 1] ?? "Grammar pattern");
}
function categoryPath(point: Grammar): string {
  return point.path.slice(0, -1).map(grammarLabel).join(" · ") || "Grammar patterns";
}
const POS_LABELS: Record<string, string> = {
  名: "Nouns", 动: "Verbs", 形: "Adjectives", 副: "Adverbs", 代: "Pronouns", 数: "Numerals",
  量: "Measure words", 介: "Prepositions", 连: "Conjunctions", 助: "Particles", 叹: "Interjections",
  前缀: "Prefixes", 后缀: "Suffixes", 拟声: "Onomatopoeia",
};
function categoryKey(item: Item): string {
  if (item.kind === "grammar") return item.value.path.map(grammarLabel).join(" · ").toLocaleLowerCase();
  return (item.value.pos ?? "").replace(/[（）()]/g, "").split(/[、，,]/).filter(Boolean)
    .map((part) => POS_LABELS[part] ?? part).join(" · ").toLocaleLowerCase();
}
function SourcePage({ page }: { page: number }) {
  return <a className="hsk-source-page" href={`https://hsk.cn-bj.ufileos.com/3.0/%E6%96%B0%E7%89%88HSK%E8%80%83%E8%AF%95%E5%A4%A7%E7%BA%B21219.pdf#page=${page + 3}`} target="_blank" rel="noreferrer">Syllabus p. {page}</a>;
}
function Meaning({ word }: { word: Vocab }) {
  return <>{defIn(word.meaning, "simp") || "Open the dictionary for this word."}{word.glossSource && <small className="hsk-muted">{word.glossSource}</small>}</>;
}
function Pattern({ point }: { point: Grammar }) {
  const notes = Array.isArray(point.explanation) ? point.explanation : [point.explanation];
  return <>
    <div className="hsk-explanation">{notes.map((note, i) => <p key={i}>{note}</p>)}</div>
    {!!point.content.length && <div className="hsk-patterns">{point.content.map((line, i) => <p key={i}>{line}</p>)}</div>}
    {!!point.examples?.length && <div className="hsk-examples"><h3>Examples</h3>{point.examples.map((example, i) => <div className="hsk-example" key={i}>
      <p className="hsk-example-zh" lang="zh">{example.chinese}</p>{example.pinyin && <p className="hsk-example-pinyin">{example.pinyin}</p>}{example.english && <p className="hsk-example-en">{example.english}</p>}
    </div>)}</div>}
  </>;
}

function Pagination({ total, perPage, page, onSize, onPage, position, maxSize }: {
  total: number; perPage: number; page: number; onSize: (n: number) => void; onPage: (n: number) => void; position: string; maxSize?: number;
}) {
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(String(perPage || 50));
  const [jump, setJump] = useState(String(page + 1));
  const size = perPage || Math.max(1, total);
  const pages = Math.max(1, Math.ceil(total / size));
  const isCustom = custom || (perPage !== 0 && !PAGE_SIZES.includes(perPage));
  useEffect(() => { setDraft(String(perPage || 50)); }, [perPage]);
  useEffect(() => { setJump(String(page + 1)); }, [page]);
  return <nav className="hsk-pagination" aria-label={`${position} list controls`}>
    <span className="hsk-item-range">{total ? `${(page * size + 1).toLocaleString()}–${Math.min((page + 1) * size, total).toLocaleString()}` : "0"} of {total.toLocaleString()}</span>
    <label><select aria-label="Items per page" title="Items per page" value={isCustom ? "custom" : String(perPage)} onChange={(e) => {
      if (e.target.value === "custom") { setCustom(true); return; }
      setCustom(false); onSize(Number(e.target.value));
    }}>{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}{!maxSize && <option value={0}>All</option>}<option value="custom">Custom</option></select></label>
    {isCustom && <form onSubmit={(e) => { e.preventDefault(); const n = Number(draft); if (Number.isSafeInteger(n) && n > 0 && (!maxSize || n <= maxSize)) { onSize(n); setCustom(false); } }}>
      <input aria-label="Custom items per page" type="number" min={1} max={maxSize} step={1} required value={draft} onChange={(e) => setDraft(e.target.value)} /><button className="btn plain" type="submit" title="Apply page size" aria-label="Apply page size"><ActionIcon name="check" /></button>
    </form>}
    <div className="hsk-page-navigation">
      <button className="btn plain" type="button" aria-label="First page" disabled={page === 0} onClick={() => onPage(0)} title="First page"><ActionIcon name="first" /></button>
      <button className="btn plain" type="button" disabled={page === 0} onClick={() => onPage(page - 1)} title="Previous page" aria-label="Previous page"><ActionIcon name="back" /></button>
      <form onSubmit={(e) => { e.preventDefault(); const n = Number(jump); if (Number.isInteger(n) && n >= 1 && n <= pages) onPage(n - 1); }}>
        <label><input type="number" aria-label="Go to page" title="Enter a page number and press Enter" min={1} max={pages} step={1} required value={jump} onChange={(e) => setJump(e.target.value)} /> / {pages.toLocaleString()}</label>
      </form>
      <button className="btn plain" type="button" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)} title="Next page" aria-label="Next page"><ActionIcon name="forward" /></button>
      <button className="btn plain" type="button" aria-label="Last page" disabled={page + 1 >= pages} onClick={() => onPage(pages - 1)} title="Last page"><ActionIcon name="last" /></button>
    </div>
  </nav>;
}

export function HskPrep() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [initial] = useState(() => new URLSearchParams(location.search));
  const [level, setLevel] = useState<Level>(() => LEVELS.find((value) => value === initial.get("level")) ?? "1");
  const [kind, setKind] = useState<Kind>("vocabulary");
  const [cumulative, setCumulative] = useState(false);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("selection");
  const [levelSort, setLevelSort] = useState<LevelSort>("auto");
  const [query, setQuery] = useState(() => initial.get("word") ?? "");
  const [page, setPage] = useState(0);
  const [pageSizes, setPageSizes] = useState(readPageSizes);
  const [progress, setProgress] = useState<Progress>({});
  const [statuses, setStatuses] = useState<Record<string, StudyStatus>>({});
  const writes = useRef(Promise.resolve());
  const grading = useRef(false);
  const [statusFilter, setStatusFilter] = useState<StudyStatus | "all">(() => initial.has("word") ? "all" : "unlearned");
  const [saveError, setSaveError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [count, setCount] = useState(20);
  const [reviewMenuOpen, setReviewMenuOpen] = useState(false);
  const [tableMenu, setTableMenu] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    let live = true;
    setError("");
    const legacy = { statuses: readStatuses(), progress: readProgress() };
    const saved = Object.keys(legacy.statuses).length || Object.keys(legacy.progress).length
      ? studyData({ ...legacy, fillMissing: true }) : studyData();
    Promise.all([load(), saved]).then(([value, study]) => {
      if (!live) return;
      setStatuses(study.statuses);
      setProgress(study.progress);
      setData(value);
    }).catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [retry]);
  useEffect(() => {
    let live = true;
    const sync = () => {
      const pending = writes.current;
      void pending.then(() => studyData()).then((study) => {
        if (!live || pending !== writes.current) return;
        setStatuses(study.statuses);
        setProgress(study.progress);
      }).catch(() => { if (live) setSaveError("Could not refresh saved HSK study data."); });
    };
    const unwatch = watchStudy(sync);
    return () => { live = false; unwatch(); };
  }, []);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".hsk-column-menu")) return;
      setTableMenu(null);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setTableMenu(null); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", escape); };
  }, []);

  const indexedItems = useMemo(() => {
    const index = new Map<Level, { item: Item; search: string }[]>();
    for (const itemLevel of LEVELS) index.set(itemLevel, []);
    const add = (item: Item, text: string) => index.get(item.value.level)?.push({ item, search: folded(text) });
    if (kind === "vocabulary") {
      data?.vocabulary.forEach((value) => add({ kind, value }, [value.word, value.pinyin, value.meaning].join(" ")));
    } else {
      data?.grammar.forEach((value) => add({ kind, value }, [
        title(value), ...value.path, ...value.content,
        Array.isArray(value.explanation) ? value.explanation.join(" ") : value.explanation,
        value.examples?.map((example) => [example.chinese, example.pinyin, example.english].join(" ")).join(" "),
      ].join(" ")));
    }
    return index;
  }, [data, kind]);

  const matchingItems = useMemo(() => {
    const allowed = levelFilter === "all" ? LEVELS : levelFilter === "selection"
      ? cumulative ? LEVELS.slice(0, LEVELS.indexOf(level) + 1) : [level]
      : [levelFilter];
    const search = folded(query);
    return allowed.flatMap((itemLevel) => (indexedItems.get(itemLevel) ?? [])
      .filter((entry) => !search || entry.search.includes(search))
      .map((entry) => entry.item));
  }, [indexedItems, level, cumulative, levelFilter, query]);
  const items = useMemo(() => {
    const filtered = statusFilter === "all" ? matchingItems : matchingItems.filter((item) => (statuses[item.value.id] ?? "unlearned") === statusFilter);
    const sort = levelSort === "auto" ? (kind === "grammar" ? "category" : "source") : levelSort;
    if (sort === "category") return filtered.slice().sort((a, b) => categoryKey(a).localeCompare(categoryKey(b), "en"));
    if (sort !== "asc" && sort !== "desc") return filtered;
    const direction = sort === "desc" ? -1 : 1;
    return filtered.slice().sort((a, b) => direction * (LEVELS.indexOf(a.value.level) - LEVELS.indexOf(b.value.level)));
  }, [matchingItems, statusFilter, statuses, levelSort, kind]);
  const now = Date.now();
  const reviewItems = matchingItems.filter((item) => statuses[item.value.id] === "review");
  const masteredItems = matchingItems.filter((item) => statuses[item.value.id] === "memorized");
  const due = reviewItems.filter((item) => !progress[item.value.id] || progress[item.value.id].due <= now);
  const perPage = pageSizes[kind];
  const size = perPage || Math.max(1, items.length);
  const shown = items.slice(page * size, (page + 1) * size);
  const current = session?.cards[session.index];

  function resetView() { setPage(0); setSession(null); }
  function saveStudy(patch: Partial<StudyData>) {
    const result = writes.current.then(() => studyData(patch)).then((study) => {
      setStatuses(study.statuses);
      setProgress(study.progress);
      setSaveError("");
    });
    writes.current = result.catch(() => setSaveError("Could not save HSK study data."));
    return result;
  }
  function setItemStatus(id: string, status: StudyStatus) {
    void saveStudy({ statuses: { [id]: status } }).catch(() => {});
  }
  const statusCount = (status: StudyStatus) => matchingItems.filter((item) => (statuses[item.value.id] ?? "unlearned") === status).length;
  function changePageSize(n: number) {
    const next = { ...pageSizes, [kind]: n };
    setPageSizes(next);
    // Keep the first item currently being read on screen after resizing.
    setPage(n ? Math.floor(page * size / n) : 0);
    try { localStorage.setItem(LIST_KEY, JSON.stringify(next)); }
    catch { setSaveError("Your page-size preference could not be saved on this device."); }
  }
  function toggleTableMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    if (tableMenu) { setTableMenu(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    setTableMenu({ top: Math.min(rect.bottom + 4, window.innerHeight - 250), left: Math.max(8, Math.min(rect.left, window.innerWidth - 266)) });
  }
  const pagination = (position: string) => <Pagination total={items.length} perPage={perPage} page={page} onSize={changePageSize} onPage={setPage} position={position} maxSize={MAX_VOCAB_PAGE} />;
  function startReview(pool: Item[]) {
    setSession({ cards: shuffled(pool).slice(0, count || pool.length), index: 0, flipped: false, answers: 0 });
  }
  async function grade(good: boolean) {
    if (!session || !current || !session.flipped || grading.current) return;
    const previous = progress[current.value.id];
    const streak = good ? (previous?.streak ?? 0) + 1 : 0;
    const next: Progress = { [current.value.id]: {
      streak, seen: (previous?.seen ?? 0) + 1, known: good,
      due: Date.now() + (good ? Math.min(30, 2 ** Math.min(streak - 1, 5)) * 86400000 : 60000),
    } };
    grading.current = true;
    try {
      await saveStudy({ progress: next });
      const cards = session.cards.slice();
      if (!good) cards.splice(Math.min(session.index + 4, cards.length), 0, current);
      setSession((active) => active === session
        ? { cards, index: session.index + 1, flipped: false, answers: session.answers + 1 } : active);
    } catch {
      // saveStudy reports the error. Keep this card on screen so it can be retried.
    } finally { grading.current = false; }
  }

  return <HubPage name="hsk">
    <h1>HSK Prep</h1>
    <nav className="hsk-levels" aria-label="HSK level">{LEVELS.map((value) => <button type="button" className="btn" aria-pressed={value === level} key={value}
      onClick={() => { setLevel(value); resetView(); }}>HSK {value === "7-9" ? "7–9" : value}</button>)}</nav>
    <div className="hsk-toolbar">
      <div className="hsk-toolbar-main">
      <div className="hsk-tabs" role="tablist" aria-label="Study lists">{(["vocabulary", "grammar"] as const).map((value) => <button type="button" role="tab" aria-selected={kind === value}
        aria-controls="hsk-content" id={`hsk-tab-${value}`} className="btn" key={value} onClick={() => { setKind(value); resetView(); }}>{value === "vocabulary" ? "词汇" : "语法"}</button>)}</div>
      <label><input type="checkbox" checked={cumulative} onChange={(e) => { setCumulative(e.target.checked); resetView(); }} /> 包含较低等级</label>
      </div>
    </div>
    {error ? <p role="alert">{error} <button type="button" className="btn" onClick={() => setRetry((r) => r + 1)}>Retry</button></p> : !data ? <p>Loading HSK lists…</p> : <>
      <div className="hsk-search-row"><input className="hsk-search" type="search" aria-label="搜索此列表" placeholder="搜索" value={query}
        onChange={(e) => { setQuery(e.target.value); resetView(); }} /></div>
      <nav className="hsk-status-filters" aria-label="Filter by study status">
        {(["unlearned", "review", "memorized"] as const).map((status) => <button key={status} className="btn" type="button" aria-pressed={statusFilter === status} onClick={() => { setStatusFilter(status); resetView(); }}>
          {STATUS_LABELS[status]} ({statusCount(status).toLocaleString()})
        </button>)}
        <button className="btn" type="button" aria-pressed={statusFilter === "all"} onClick={() => { setStatusFilter("all"); resetView(); }}>全部 ({matchingItems.length.toLocaleString()})</button>
        <details className="hsk-review-menu" open={reviewMenuOpen} onToggle={(event) => setReviewMenuOpen(event.currentTarget.open)}>
          <summary className="btn hsk-flashcards-toggle" title="闪卡" aria-label="闪卡">闪卡</summary>
          <div className="hsk-review-popover">
            <select aria-label="每轮闪卡张数" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              <option value={10}>10 张</option><option value={20}>20 张</option><option value={50}>50 张</option><option value={0}>不限</option>
            </select>
            <button type="button" disabled={!due.length} onClick={() => { setReviewMenuOpen(false); startReview(due); }}>
              到期闪卡 <span>{due.length.toLocaleString()}</span>
            </button>
            <button type="button" disabled={!reviewItems.length} onClick={() => { setReviewMenuOpen(false); startReview(reviewItems); }}>
              全部闪卡 <span>{reviewItems.length.toLocaleString()}</span>
            </button>
            <button type="button" disabled={!masteredItems.length} onClick={() => { setReviewMenuOpen(false); startReview(masteredItems); }}>
              已掌握 <span>{masteredItems.length.toLocaleString()}</span>
            </button>
          </div>
        </details>
      </nav>
      {saveError && <p role="alert">{saveError}</p>}
      <section id="hsk-content" role="tabpanel" aria-labelledby={`hsk-tab-${kind}`}>
        {session ? <div className="hsk-review">
          <div className="hsk-review-heading">
            <span>HSK {level === "7-9" ? "7–9" : level} · {kind === "vocabulary" ? "词汇闪卡" : "语法闪卡"}</span>
            {current && <span className="hsk-muted hsk-review-count" aria-label={`第 ${session.index + 1} 张，共 ${session.cards.length} 张`}>{session.index + 1} / {session.cards.length}</span>}
            <button className="btn plain hsk-review-icon" type="button" onClick={() => setSession(null)} title="返回列表" aria-label="返回列表"><ActionIcon name="back" /></button>
          </div>
          {current ? <>
            <div className="hsk-flashcard" aria-live="polite">
              {current.kind === "vocabulary" ? <>
                <div className="hsk-flash-word" lang="zh">{current.value.word}</div>
                {session.flipped && <><p className="hsk-flash-pinyin">{current.value.pinyin}</p><p className="hsk-flash-meaning"><Meaning word={current.value} /></p>
                  <a href={`/dictionary?q=${encodeURIComponent(current.value.word)}`}>查词典</a></>}
              </> : <><h2>{title(current.value)}</h2><p className="hsk-muted">{categoryPath(current.value)}</p>
                {session.flipped && <Pattern point={current.value} />}</>}
            </div>
            <div className="hsk-flash-actions">{!session.flipped ? <button className="btn hsk-review-icon" type="button" onClick={() => setSession({ ...session, flipped: true })} title="显示答案" aria-label="显示答案"><ActionIcon name="eye" /></button> : <>
              <button className="btn plain hsk-review-icon" type="button" onClick={() => grade(false)} title="再练一次" aria-label="再练一次"><ActionIcon name="reload" /></button>
              <button className="btn hsk-review-icon" type="button" onClick={() => grade(true)} title="记住了" aria-label="记住了"><ActionIcon name="check" /></button>
            </>}</div>
          </> : <div className="hsk-complete"><h2>复习完成</h2><p>已答 {session.answers} 次</p></div>}
        </div> : kind === "grammar" ? <GrammarBrowser
          key={`${level}-${cumulative}-${levelFilter}-${query}-${statusFilter}`}
          entries={items.flatMap((item) => item.kind === "grammar" ? [item.value] : [])}
          paginate={(entries, branchPage, onBranchPage) => {
            const size = perPage || Math.max(1, entries.length);
            const currentPage = Math.min(branchPage, Math.max(0, Math.ceil(entries.length / size) - 1));
            return { shown: entries.slice(currentPage * size, (currentPage + 1) * size), controls: <Pagination total={entries.length} perPage={perPage} page={currentPage} onSize={(value) => { changePageSize(value); onBranchPage(0); }} onPage={onBranchPage} position="Grammar" /> };
          }}
          renderEntry={(point) => <article className="hsk-grammar" key={point.id}>
            <header><h2>{title(point)}</h2><label className="hsk-status-control"><span className="sr-only">Study status for {title(point)}</span><select aria-label={`Study status for ${title(point)}`} value={statuses[point.id] ?? "unlearned"} onChange={(e) => setItemStatus(point.id, e.target.value as StudyStatus)}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></header>
            <Pattern point={point} />
            <footer>{point.pages?.map((p) => <SourcePage page={p} key={p} />)}</footer>
          </article>}
        /> : <>
          {pagination("Top")}
          {!items.length ? <p>No matching {kind === "vocabulary" ? "words" : "grammar points"}.</p> : kind === "vocabulary" ? <div className="hsk-table-wrap"><table className="hsk-table">
            <thead><tr>
              <th>词语／拼音</th>
              <th>释义</th>
              <th><div className="hsk-column-heading"><span>等级／来源</span><span className="hsk-column-menu">
                <button type="button" aria-label="Level and source column filter and sort menu" aria-expanded={!!tableMenu} onClick={(event) => toggleTableMenu(event)}>▼</button>
                {tableMenu && <div className="hsk-column-popover" style={{ top: tableMenu.top, left: tableMenu.left }} role="menu">
                  <button type="button" role="menuitemradio" aria-checked={levelSort === "asc"} onClick={() => { setLevelSort("asc"); setTableMenu(null); resetView(); }}>HSK 等级从低到高</button>
                  <button type="button" role="menuitemradio" aria-checked={levelSort === "desc"} onClick={() => { setLevelSort("desc"); setTableMenu(null); resetView(); }}>HSK 等级从高到低</button>
                  <button type="button" role="menuitemradio" aria-checked={levelSort !== "asc" && levelSort !== "desc"} onClick={() => { setLevelSort("source"); setTableMenu(null); resetView(); }}>考纲顺序</button>
                  <hr />
                  <label>按 HSK 等级筛选<select aria-label="Filter vocabulary table by HSK level" value={levelFilter} onChange={(e) => { setLevelFilter(e.target.value as LevelFilter); setTableMenu(null); resetView(); }}>
                    <option value="selection">当前等级</option><option value="all">全部等级</option>{LEVELS.map((value) => <option key={value} value={value}>HSK {value === "7-9" ? "7–9" : value}</option>)}
                  </select></label>
                </div>}
              </span></div></th>
              <th>学习状态</th></tr></thead>
            <tbody>{shown.map((item) => item.kind === "vocabulary" && <tr key={item.value.id}>
              <td><a className="hsk-word" lang="zh" href={`/dictionary?q=${encodeURIComponent(item.value.word)}`}
                onClick={(event) => { if (window.__ccDefineSelection?.(item.value.word)) event.preventDefault(); }}
              >{item.value.word}</a><span className="hsk-pinyin">{item.value.pinyin}</span></td>
              <td><Meaning word={item.value} /></td><td><span>HSK {item.value.levelNote}</span><SourcePage page={item.value.page} /></td>
              <td><label className="hsk-status-control"><span className="sr-only">Study status for {item.value.word}</span><select aria-label={`Study status for ${item.value.word}`} value={statuses[item.value.id] ?? "unlearned"} onChange={(e) => setItemStatus(item.value.id, e.target.value as StudyStatus)}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></td>
            </tr>)}</tbody>
          </table></div> : null}
          {pagination("Bottom")}
        </>}
      </section>
      <details className="hsk-sources"><summary>Sources and syllabus edition</summary>
        <p>Level assignments, vocabulary and grammar patterns come from the official HSK 3.0 syllabus linked by <a href={data.source.website} target="_blank" rel="noreferrer">ChineseTest</a>, published {data.source.published}, effective {data.source.effective}. Retrieved {data.source.retrieved}.</p>
        <p><a href={data.source.url} target="_blank" rel="noreferrer">Original PDF</a></p>
        <p>Vocabulary glosses are adapted from <a href="https://hearmandarin.com/datasets/">HearMandarin</a>. Grammar explanations are Chinese Central study notes.</p>
        <p>Numbers after words or grammar names distinguish syllabus senses or patterns. Parenthesized level numbers indicate additional uses assigned to later levels.</p>
      </details>
    </>}
  </HubPage>;
}
