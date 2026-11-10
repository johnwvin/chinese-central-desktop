import { useState, type ReactNode } from "react";
import { grammarLabel } from "./labels";
import { grammarDescription, grammarGroup, type GrammarNode } from "./hierarchy";

interface BrowserProps<T extends GrammarNode> {
  entries: T[];
  renderEntry: (entry: T) => ReactNode;
  paginate: (entries: T[], page: number, onPage: (page: number) => void) => { shown: T[]; controls: ReactNode };
}

function CategoryCollection<T extends GrammarNode>({ entries, renderEntry, paginate, prefix }: BrowserProps<T> & { prefix: string[] }) {
  const [page, setPage] = useState(0);
  const group = grammarGroup(entries, prefix);
  const entryPage = paginate(group.entries, page, setPage);
  return <>
    {group.categories.length > 0 && <div className="hsk-category-grid">
      {group.categories.slice().sort((a, b) => grammarLabel(a.name).localeCompare(grammarLabel(b.name), "en")).map(({ name, count }) => {
        const path = [...prefix, name];
        return <details className="hsk-category-branch" key={name} data-category-path={JSON.stringify(path)}>
          <summary className="hsk-category-card">
            <span className="hsk-category-card-heading"><strong>{grammarLabel(name)}</strong><small>{count} <span className="hsk-category-arrow" aria-hidden="true">▸</span></small></span>
            <span className="hsk-muted" lang="zh">{name}</span>
            <span className="hsk-category-description">{grammarDescription(name, grammarLabel(name))}</span>
          </summary>
          <div className="hsk-category-children" role="group" aria-label={`${grammarLabel(name)} items`}>
            <CategoryCollection entries={entries} prefix={path} renderEntry={renderEntry} paginate={paginate} />
          </div>
        </details>;
      })}
    </div>}
    {group.entries.length > 0 && <div className="hsk-category-entries">
      <div className="hsk-grammar-list">{entryPage.shown.map(renderEntry)}</div>{entryPage.controls}
    </div>}
  </>;
}

export function GrammarBrowser<T extends GrammarNode>(props: BrowserProps<T>) {
  return <section className="hsk-grammar-browser" aria-label="Grammar categories">
    <h2 className="hsk-category-heading">Grammar categories</h2>
    {props.entries.length ? <CategoryCollection {...props} prefix={[]} /> : <p>No matching grammar points.</p>}
  </section>;
}
