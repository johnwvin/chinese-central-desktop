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

type Card = (typeof terms)[number];

function shuffled(cards: Card[]): Card[] {
  const deck = cards.slice();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function FlashcardTest({ cards, onBack }: { cards: Card[]; onBack: () => void }) {
  const [deck, setDeck] = useState(() => shuffled(cards));
  const [index, setIndex] = useState(0);
  const [known, setKnown] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const card = deck[index];

  function grade(correct: boolean) {
    if (correct) setKnown(known + 1);
    setIndex(index + 1);
    setRevealed(false);
  }

  function restart() {
    setDeck(shuffled(cards));
    setIndex(0);
    setKnown(0);
    setRevealed(false);
  }

  return (
    <section className="grammar-test" aria-labelledby="grammar-test-title">
      <header className="grammar-test-toolbar">
        <button className="grammar-test-button grammar-test-back" type="button" onClick={onBack}
          title="Back to list" aria-label="Back to list">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5m7 7-7-7 7-7" />
          </svg>
        </button>
        <h1 id="grammar-test-title">Grammar Terms</h1>
        {card && <span className="grammar-test-count" aria-label={`Card ${index + 1} of ${deck.length}`}>
          {index + 1} / {deck.length}
        </span>}
      </header>
      <div className="grammar-test-card" aria-live="polite">
        {card ? (
          <>
            <div className="grammar-test-term" lang="zh-Hans">{card.term}</div>
            {revealed && (
              <>
                <div className="grammar-test-pinyin">{card.pinyin}</div>
                <div className="grammar-test-meaning">{card.meaning}</div>
              </>
            )}
          </>
        ) : (
          <>
            <strong>Test complete</strong>
            <div>{known} / {deck.length} correct</div>
          </>
        )}
      </div>
      <div className="grammar-test-actions">
        {!card ? (
          <button className="grammar-test-button grammar-test-primary" type="button" onClick={restart}>Test again</button>
        ) : revealed ? (
          <>
            <button className="grammar-test-button" type="button" onClick={() => grade(false)}>Missed it</button>
            <button className="grammar-test-button grammar-test-primary" type="button" onClick={() => grade(true)}>Got it</button>
          </>
        ) : (
          <button className="grammar-test-button grammar-test-primary" type="button" onClick={() => setRevealed(true)}>Reveal</button>
        )}
      </div>
    </section>
  );
}

export function GrammarWords() {
  const [query, setQuery] = useState("");
  const [testCards, setTestCards] = useState<Card[] | null>(null);
  const text = query.trim().toLowerCase();
  const sounds = searchPinyin(text);
  const rows = terms.filter(({ term, meaning, pinyinKey }) =>
    term.includes(text) || meaning.toLowerCase().includes(text) || (sounds && pinyinKey.includes(sounds))
  );

  return (
    <HubPage name="dictionary">
      {testCards ? (
        <FlashcardTest cards={testCards} onBack={() => setTestCards(null)} />
      ) : (
        <>
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
            <button className="grammar-test-button" type="button" title="Flashcard test" aria-label="Flashcard test"
              disabled={rows.length === 0} onClick={() => setTestCards(rows)}>闪卡</button>
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
        </>
      )}
    </HubPage>
  );
}
