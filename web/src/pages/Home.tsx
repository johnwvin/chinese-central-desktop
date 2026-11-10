import { HubPage } from "./HubPage";
import "./home.css";

// The same nine pages the strip's menu lists, in the same order, wearing the
// same marks. Whatever is one place is the other.
const PAGES = [
  { href: "/dictionary", icon: "📖", name: "Dictionary" },
  { href: "/pinyin", icon: "🔊", name: "Pinyin chart" },
  { href: "/games", icon: "✏️", name: "Study Tools" },
  { href: "/hsk", icon: "🎓", name: "HSK Prep" },
  { href: "/browser", icon: "🌐", name: "Browser" },
  { href: "/notes", icon: "📝", name: "Notebook" },
  { href: "/books", icon: "📚", name: "Books" },
  { href: "/control", icon: "⚙️", name: "Control" },
];

export function Home() {
  return (
    <HubPage name="home">
      <h1>Chinese Central</h1>

      <form className="homesearch" action="/dictionary" method="get">
        <input
          type="search"
          name="q"
          autoComplete="off"
          spellCheck={false}
          placeholder="Look something up — characters, pinyin, or English"
        />
        <button type="submit" title="Search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>
      </form>

      <div className="homegrid">
        {PAGES.map((page) => (
          <a className="homecard" href={page.href} key={page.href}>
            <span className="hemoji">{page.icon}</span>
            <h3>{page.name}</h3>
          </a>
        ))}
      </div>

    </HubPage>
  );
}
