import { useEffect, useMemo, useState } from "react";
import { HubPage } from "./HubPage";
import { plainly } from "./dict/pinyin";
import { hskVocabulary, levelLabel, type Vocab } from "./hsk/study";
import "./dictionary.css";
import "./grammar-words.css";

const wordClasses: Record<string, string> = {
  "助": "Particle",
  "介": "Preposition",
  "连": "Conjunction",
  "代": "Pronoun",
  "副": "Adverb",
  "量": "Measure word",
  "数": "Numeral",
  "数量": "Numeral–measure expression",
  "叹": "Interjection",
  "前缀": "Prefix",
  "后缀": "Suffix",
};

function searchPinyin(value: string): string {
  return plainly(value.normalize("NFC")).replace(/[\s\d'’·-]+/g, "");
}

function grammarWords(vocabulary: Vocab[]) {
  return vocabulary.flatMap((word) => {
    const tags = (word.pos ?? "").split(/[（）()、，,]+/).map((tag) => tag.trim());
    const classes = [...new Set(tags)].map((tag) => wordClasses[tag]).filter(Boolean);
    if (!classes.length) return [];
    return [{ word, classes, pinyinKey: searchPinyin(word.pinyin) }];
  });
}

export function GrammarWords() {
  const [words, setWords] = useState<ReturnType<typeof grammarWords> | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    hskVocabulary().then((list) => setWords(grammarWords(list))).catch(() => setFailed(true));
  }, []);

  const rows = useMemo(() => {
    const text = query.trim().toLowerCase();
    const pinyin = searchPinyin(text);
    return words?.filter(({ word, classes, pinyinKey }) =>
      !text || word.word.includes(text) || word.label.includes(text) ||
      word.meaning.toLowerCase().includes(text) ||
      classes.some((label) => label.toLowerCase().includes(text)) ||
      (pinyin && pinyinKey.includes(pinyin)),
    );
  }, [words, query]);

  return (
    <HubPage name="dictionary">
      <h1>Grammar Words</h1>
      <div className="searchbar grammar-words-search">
        <span className="d-qwrap">
          <input type="search" className="fv-q" placeholder="Search" aria-label="Search grammar words"
            autoComplete="off" spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" className="d-clearq" aria-label="Clear search" onClick={(event) => {
            event.currentTarget.parentElement?.querySelector("input")?.focus();
            setQuery("");
          }}>×</button>}
        </span>
      </div>
      {failed && <p role="alert">Could not load grammar words.</p>}
      {!failed && !rows && <p role="status">Loading…</p>}
      {rows?.length === 0 && <p role="status">No matching words.</p>}
      {!!rows?.length && (
        <div className="ybsec grammar-words">
          <table className="ybtable">
            <thead>
              <tr className="ybhead">
                <th scope="col">Word / Pinyin</th>
                <th scope="col">Word class</th>
                <th scope="col">Meaning</th>
                <th scope="col">Level</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ word, classes }) => (
                <tr key={word.id}>
                  <td>
                    <a className="zhword" href={`/dictionary?${new URLSearchParams({ q: word.word, p: word.pinyin })}`}
                      target="_blank" rel="noreferrer">{word.word}</a>
                    <div className="grammar-word-pinyin">{word.pinyin}</div>
                  </td>
                  <td>{classes.join(", ")}</td>
                  <td>{word.meaning}</td>
                  <td>{levelLabel(word.level)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </HubPage>
  );
}
