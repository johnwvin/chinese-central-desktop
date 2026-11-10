import { HubPage } from "./HubPage";
import "./source.css";

export function Source() {
  return (
    <HubPage name="source">
      <h1>Sources</h1>
      <section className="source-entry">
        <h2>Character origins and components</h2>
        <p>
          The Dong Chinese Character Wiki supplies character definitions,
          pronunciations, and verified component notes. Its component breakdown
          is used where the existing breakdown has no named character parts.
          The offline copy keeps only these dictionary fields.
        </p>
        <p>
          Source: <a href="https://www.dong-chinese.com/wiki">Dong Chinese Character Wiki</a>,
          character dump dated December 27, 2025. Adapted under
          {" "}<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>.
        </p>
      </section>
      <section className="source-entry">
        <h2>Dictionary character conversion</h2>
        <p>
          The dictionary uses character mappings from OpenCC.
          Characters with multiple listed replacements are left unchanged.
        </p>
        <p>
          Source: <a href="https://github.com/BYVoid/OpenCC/tree/3ac34aa439a9908dd49fa92b5174b46314787ac2/data/dictionary">OpenCC character tables</a>,
          used under <a href="https://github.com/BYVoid/OpenCC/blob/3ac34aa439a9908dd49fa92b5174b46314787ac2/LICENSE">Apache 2.0</a>.
        </p>
      </section>
      <section className="source-entry">
        <h2>Dictionary measure words</h2>
        <p>
          Measure words already supplied by CC-CEDICT remain unchanged. When an
          entry has none, Chinese Central may use classifiers recorded for that
          exact noun in the Chinese or English editions of Wiktionary. It does
          not infer them from related words.
        </p>
        <ul>
          <li><a href="https://cc-cedict.org/">CC-CEDICT</a></li>
          <li><a href="https://kaikki.org/dictionary/downloads/zh/zh-extract.jsonl.gz">Chinese Wiktionary extract</a></li>
          <li><a href="https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl.gz">English Wiktionary extract</a></li>
        </ul>
        <p>
          Wiktionary material is available under <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>.
          The extracts were retrieved September 22, 2026, and filtered to
          Mandarin classifiers for matching headwords.
        </p>
      </section>
    </HubPage>
  );
}
