import { useState } from "react";
import { HubPage } from "./HubPage";
import { grammarTerms } from "./dict/grammarTerms";
import { plainly } from "./dict/pinyin";
import "./dictionary.css";
import "./grammar-words.css";

function searchPinyin(value: string): string {
  return plainly(value.normalize("NFC")).replace(/u:/g, "v").replace(/[\s\d'’·-]+/g, "");
}

const terms = grammarTerms.map(([term, pinyin, meaning]) => ({
  term, pinyin, meaning, pinyinKey: searchPinyin(pinyin),
}));

export function GrammarWords() {
  const [query, setQuery] = useState("");
  const text = query.trim().toLowerCase();
  const sounds = searchPinyin(text);
  const rows = terms.filter(({ term, meaning, pinyinKey }) =>
    term.includes(text) || meaning.toLowerCase().includes(text) || (sounds && pinyinKey.includes(sounds))
  );

  return (
    <HubPage name="dictionary">
      <h1>Grammar Terms</h1>
      <div className="searchbar grammar-words-search">
        <span className="d-qwrap">
          <input type="search" className="fv-q" placeholder="Search" aria-label="Search grammar terms"
            autoComplete="off" spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && <button type="button" className="d-clearq" aria-label="Clear search" onClick={(event) => {
            event.currentTarget.parentElement?.querySelector("input")?.focus();
            setQuery("");
          }}>×</button>}
        </span>
      </div>
      {rows.length === 0 && <p role="status">No matching terms.</p>}
      {rows.length > 0 && (
        <div className="ybsec grammar-words">
          <table className="ybtable">
            <thead>
              <tr className="ybhead">
                <th scope="col">Term / Pinyin</th>
                <th scope="col">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ term, pinyin, meaning }) => (
                <tr key={term}>
                  <td>
                    <a className="zhword" href={`/dictionary?${new URLSearchParams({ q: term, p: pinyin })}`}
                      target="_blank" rel="noreferrer">{term}</a>
                    <div className="grammar-word-pinyin">{pinyin}</div>
                  </td>
                  <td>{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </HubPage>
  );
}
