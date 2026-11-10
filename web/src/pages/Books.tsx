import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type Book } from "../api/central";
import { HubPage } from "./HubPage";
import { loadPdfjs } from "./read/pdfjs";
import { remembered, usePlaces } from "./read/place";
import { Modal } from "../ui/Dialog";
import "./books.css";

/**
 * Your books, on a shelf -- or in a folder.
 *
 * A port of BOOKS_BODY and BOOKS_JS in server.py, with one thing added: two
 * ways to look at the same books folder. Shelves lay every folder out flat,
 * one section per folder, the whole library on one page. Folders are a real
 * file browser -- one level at a time, with a trail back up -- for exactly
 * the times a flat page of forty folders is too much at once.
 *
 * Filing a book anywhere -- a drag, a shelf label, a folder tile, the
 * right-click menu -- ends in the same place, Hub.MoveBook, which moves the
 * file itself: there is no folder here that is not a real one on disk.
 */
export function Books() {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [where, setWhere] = useState("");
  const [failed, setFailed] = useState(false);
  const [find, setFind] = useState("");
  const [error, setError] = useState("");

  // The progress bars are drawn from the app's own record of where each book
  // was left, and that arrives a moment after the page does. Naming it here
  // is what redraws the shelf when it lands -- see place.ts.
  usePlaces();

  // Shelves lay every folder out on one page; Folders is a file browser, one
  // level of `rawPath` at a time. Switching does not reset it -- leaving
  // Folders and coming back returns you where you were.
  const [view, setView] = useState<"shelf" | "folder">("shelf");
  const [rawPath, setPath] = useState("");

  // The book being dragged, and whatever it is over right now -- another
  // book's rel, a shelf's folder, or a folder tile's path -- so both ends of
  // the drag can be lit up without either one having to ask the other what
  // it is doing.
  const [dragging, setDragging] = useState<Book | null>(null);
  const [over, setOver] = useState("");
  const [menu, setMenu] = useState<{ book: Book; x: number; y: number } | null>(null);
  // A move that needs a new folder waits here for its name, rather than
  // asking the OS for one: the rest of the app never leaves its own look for
  // a browser dialog, and this shouldn't either. `books` is one for a
  // right-click's "New folder...", two for a drag that landed on another
  // loose book.
  const [pendingGroup, setPendingGroup] = useState<{ books: Book[] } | null>(null);

  const reload = () =>
    api
      .books()
      .then((d) => {
        setBooks(d.books ?? []);
        setWhere(d.path ?? "");
      })
      .catch(() => setFailed(true));

  useEffect(() => {
    reload();
  }, []);

  // A shelf can run to several screens, and a folder to drop a book on can be
  // off the bottom of the one you're dragging from. Ordinary drag and drop
  // does not scroll the page for you, so while a drag is on, the page scrolls
  // itself once the cursor nears the top or bottom edge -- faster the closer
  // it gets, stopped the moment it isn't. window.scrollBy is a no-op where
  // there is nothing to scroll, so this needs no guard for a short page.
  //
  // A timer, not requestAnimationFrame: a page mid-drag is exactly the case
  // browsers are inconsistent about still running rAF for, since the drag
  // gesture itself owns the browser's normal event loop rhythm. setInterval
  // keeps ticking through that.
  useEffect(() => {
    if (!dragging) return;
    const edge = 72;
    const maxSpeed = 18;
    let speed = 0;

    function onDragOver(e: DragEvent) {
      const y = e.clientY;
      const h = window.innerHeight;
      if (y < edge) speed = -maxSpeed * (1 - y / edge);
      else if (y > h - edge) speed = maxSpeed * (1 - (h - y) / edge);
      else speed = 0;
    }
    window.addEventListener("dragover", onDragOver);
    const id = setInterval(() => {
      if (speed) window.scrollBy(0, speed);
    }, 16);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      clearInterval(id);
    };
  }, [dragging]);

  const shelves = useMemo(() => {
    if (!books) return [];
    const q = find.trim().toLowerCase();
    const kept = books.filter(
      (b) => !q || `${b.name} ${b.folder}`.toLowerCase().includes(q),
    );
    const groups = new Map<string, Book[]>();
    for (const b of kept) {
      const shelf = groups.get(b.folder);
      if (shelf) shelf.push(b);
      else groups.set(b.folder, [b]);
    }
    return [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }, [books, find]);

  // Every folder that holds a book, and every folder above it: a book filed
  // under Novels/Wuxia makes both "Novels" and "Novels/Wuxia" real places to
  // browse, even though nothing sits in Novels itself.
  const allFolders = useMemo(() => {
    if (!books) return [];
    const set = new Set<string>();
    for (const b of books) {
      if (b.folder === "." || !b.folder) continue;
      const parts = b.folder.split("/");
      for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join("/"));
    }
    return [...set].sort();
  }, [books]);

  // Where the browser is actually standing: `rawPath`, corrected if the
  // folder it names just disappeared out from under it -- its last book
  // left, and an empty folder is not left standing (see Hub.MoveBook).
  // Derived rather than corrected back into state after the fact, so a
  // folder vanishing on reload settles in the same render instead of one
  // that briefly shows a dead end.
  const path = useMemo(() => {
    if (rawPath === "" || allFolders.includes(rawPath)) return rawPath;
    const parent = rawPath.includes("/") ? rawPath.slice(0, rawPath.lastIndexOf("/")) : "";
    return parent && allFolders.includes(parent) ? parent : "";
  }, [rawPath, allFolders]);

  // The folder view's own two lists for `path`: the folders directly under
  // it, and the books sitting straight in it -- neither reaching deeper than
  // one level, which is what makes it a browser rather than another shelf.
  const childFolders = useMemo(
    () =>
      allFolders.filter((f) => {
        const parent = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "";
        return parent === path;
      }),
    [allFolders, path],
  );
  const childBooks = useMemo(() => {
    if (!books) return [];
    const want = path === "" ? "." : path;
    const q = find.trim().toLowerCase();
    return books.filter((b) => b.folder === want && (!q || b.name.toLowerCase().includes(q)));
  }, [books, path, find]);

  function doMove(rel: string, folder: string): Promise<boolean> {
    return api
      .moveBook(rel, folder)
      .then(() => true)
      .catch((e: unknown) => {
        setError(e instanceof ApiError ? e.message : "Could not move that book.");
        return false;
      });
  }

  // Dropped on another book: join the folder it is already on, or -- both
  // still loose -- ask what to call a new one for the two of them, picked
  // back up in confirmNewFolder once it is named.
  async function groupOnto(dropped: Book, onto: Book) {
    if (dropped.rel === onto.rel) return;
    setError("");
    const folder = onto.folder === "." ? "" : onto.folder;
    if (!folder) {
      setPendingGroup({ books: [onto, dropped] });
      return;
    }
    if (await doMove(dropped.rel, folder)) reload();
  }

  async function confirmNewFolder(name: string) {
    if (!pendingGroup) return;
    const toMove = pendingGroup.books;
    setPendingGroup(null);
    setError("");
    // Made under wherever the folder browser is standing, not always at the
    // top of the books folder -- a folder named from inside Novels belongs
    // in Novels.
    const full = view === "folder" && path ? path + "/" + name : name;
    let moved = false;
    for (const b of toMove) {
      // Kept going even if one of these fails: whatever landed is real
      // change on disk, and the shelf should say so.
      if (await doMove(b.rel, full)) moved = true;
    }
    if (moved) reload();
  }

  // One book into one folder -- a shelf's label, a folder tile, or the
  // right-click menu's "Add to folder" all land here the same way.
  async function moveToFolder(book: Book, folder: string) {
    setError("");
    const want = folder === "." ? "" : folder;
    const have = book.folder === "." ? "" : book.folder;
    if (have === want) return;
    if (await doMove(book.rel, want)) reload();
  }

  async function removeFromFolder(book: Book) {
    setError("");
    if (await doMove(book.rel, "")) reload();
  }

  const showingFolder = view === "folder";
  const empty = !books || !books.length;

  return (
    <HubPage name="books">
      <h1>Books</h1>
      {error && (
        <p className="note bkerror" onClick={() => setError("")}>
          {error} <span className="bkerror-x">Dismiss</span>
        </p>
      )}
      <div className="bkbar">
        {!empty && (
          <div className="bkviewtoggle">
            <button
              type="button"
              className={view === "shelf" ? "on" : ""}
              onClick={() => setView("shelf")}
            >
              Shelves
            </button>
            <button
              type="button"
              className={view === "folder" ? "on" : ""}
              onClick={() => setView("folder")}
            >
              Folders
            </button>
          </div>
        )}
        <input
          type="search"
          id="bk-find"
          placeholder="Search your books"
          autoComplete="off"
          spellCheck={false}
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
      </div>
      <div id="bk-list">
        {failed ? (
          <p className="note">Could not read your books folder.</p>
        ) : !books ? (
          <p className="note">Loading&hellip;</p>
        ) : empty ? (
          <p className="note">
            No books found in <b>{where}</b>. Point the app at the folder your PDFs and EPUBs are
            in on the{" "}
            <a href="/control" target="_blank" rel="noreferrer">
              Control
            </a>{" "}
            page.
          </p>
        ) : showingFolder ? (
          <>
            <Breadcrumb path={path} onGo={setPath} />
            {childFolders.length > 0 && (
              <div className="bkfoldergrid">
                {childFolders.map((f) => (
                  <FolderTile
                    key={f}
                    path={f}
                    dragging={dragging}
                    over={over}
                    setOver={setOver}
                    onOpen={() => setPath(f)}
                    onDropOnFolder={moveToFolder}
                  />
                ))}
              </div>
            )}
            {childBooks.length ? (
              <div className="bkgrid">
                {childBooks.map((b, i) => (
                  <Card
                    key={b.rel}
                    book={b}
                    eager={i < 12}
                    dragging={dragging}
                    over={over}
                    setOver={setOver}
                    onDragBook={setDragging}
                    onDropOnBook={groupOnto}
                    onContextMenu={(book, x, y) => setMenu({ book, x, y })}
                  />
                ))}
              </div>
            ) : childFolders.length === 0 ? (
              <p className="note">Nothing directly in this folder.</p>
            ) : null}
          </>
        ) : (
          shelves.map(([folder, shelf], n) => (
            <Shelf
              key={folder}
              folder={folder}
              books={shelf}
              from={eagerBefore(shelves, n)}
              dragging={dragging}
              over={over}
              setOver={setOver}
              onDragBook={setDragging}
              onDropOnBook={groupOnto}
              onDropOnShelf={moveToFolder}
              onContextMenu={(book, x, y) => setMenu({ book, x, y })}
            />
          ))
        )}
      </div>
      {menu &&
        (() => {
          const grouped = menu.book.folder !== "." && menu.book.folder !== "";
          const otherFolders = allFolders.filter((f) => f !== menu.book.folder);
          return (
            <BookMenu
              x={menu.x}
              y={menu.y}
              grouped={grouped}
              otherFolders={otherFolders}
              onAddToFolder={(folder) => {
                void moveToFolder(menu.book, folder);
                setMenu(null);
              }}
              onNewFolder={() => {
                setPendingGroup({ books: [menu.book] });
                setMenu(null);
              }}
              onRemoveFromFolder={() => {
                void removeFromFolder(menu.book);
                setMenu(null);
              }}
              onClose={() => setMenu(null)}
            />
          );
        })()}
      {pendingGroup && (
        <NameFolderModal
          books={pendingGroup.books}
          onCancel={() => setPendingGroup(null)}
          onCreate={(name) => void confirmNewFolder(name)}
        />
      )}
    </HubPage>
  );
}

// How many PDFs have already been drawn by the time this shelf is reached.
// The first dozen on the page are drawn straight away; the rest wait.
function eagerBefore(shelves: [string, Book[]][], upto: number) {
  let n = 0;
  for (let i = 0; i < upto; i++) n += shelves[i][1].length;
  return n;
}

/** Where the folder browser is standing, as a trail back up to the top. */
function Breadcrumb({ path, onGo }: { path: string; onGo: (path: string) => void }) {
  const parts = path ? path.split("/") : [];
  return (
    <div className="bkcrumbs">
      <span
        className={"bkcrumb" + (path === "" ? " bkcrumb-current" : "")}
        onClick={() => onGo("")}
      >
        Books
      </span>
      {parts.map((part, i) => {
        const full = parts.slice(0, i + 1).join("/");
        const last = i === parts.length - 1;
        return (
          <span key={full}>
            <span className="bkcrumb-sep">/</span>
            <span
              className={"bkcrumb" + (last ? " bkcrumb-current" : "")}
              onClick={() => onGo(full)}
            >
              {part}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** One folder, in the folder browser: a tile to open it, and a place to drop
 *  a book to file it there. */
function FolderTile({
  path,
  dragging,
  over,
  setOver,
  onOpen,
  onDropOnFolder,
}: {
  path: string;
  dragging: Book | null;
  over: string;
  setOver: (key: string) => void;
  onOpen: () => void;
  onDropOnFolder: (dropped: Book, folder: string) => void;
}) {
  const key = "folder:" + path;
  const name = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;
  return (
    <div
      className={"bkfoldertile" + (over === key ? " drop-target" : "")}
      onClick={onOpen}
      onDragOver={(e) => {
        if (!dragging) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(key);
      }}
      onDragLeave={() => {
        if (over === key) setOver("");
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver("");
        if (dragging) onDropOnFolder(dragging, path);
      }}
    >
      <span className="bkfoldericon">📁</span>
      <span className="bkfoldername">{name}</span>
    </div>
  );
}

function Shelf({
  folder,
  books,
  from,
  dragging,
  over,
  setOver,
  onDragBook,
  onDropOnBook,
  onDropOnShelf,
  onContextMenu,
}: {
  folder: string;
  books: Book[];
  from: number;
  dragging: Book | null;
  over: string;
  setOver: (key: string) => void;
  onDragBook: (book: Book | null) => void;
  onDropOnBook: (dropped: Book, onto: Book) => void;
  onDropOnShelf: (dropped: Book, folder: string) => void;
  onContextMenu: (book: Book, x: number, y: number) => void;
}) {
  // "." is Go's filepath.Rel for "straight in the books folder", not a
  // folder with that name -- shown as no label at all, the same as before
  // this shelf could be dropped on.
  const shelfKey = "shelf:" + folder;
  return (
    <div className="bksec">
      {folder !== "." && (
        <div
          className={"bkgroup" + (over === shelfKey ? " drop-target" : "")}
          onDragOver={(e) => {
            if (!dragging) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setOver(shelfKey);
          }}
          onDragLeave={() => {
            if (over === shelfKey) setOver("");
          }}
          onDrop={(e) => {
            e.preventDefault();
            setOver("");
            if (dragging) onDropOnShelf(dragging, folder);
            onDragBook(null);
          }}
        >
          {folder}
        </div>
      )}
      <div className="bkgrid">
        {books.map((b, i) => (
          <Card
            key={b.rel}
            book={b}
            eager={from + i < 12}
            dragging={dragging}
            over={over}
            setOver={setOver}
            onDragBook={onDragBook}
            onDropOnBook={onDropOnBook}
            onContextMenu={onContextMenu}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * How far into a book you are.
 *
 * The reader writes down where it left you, and this is the same two numbers
 * read back: a shelf that cannot say which of nine books you are halfway
 * through is a shelf you have to open nine books to read.
 */
function placeIn(rel: string): { at: number; of: number } | null {
  try {
    if (/\.epub$/i.test(rel)) {
      const at = Number(remembered("cc-book-page:" + rel));
      const of = Number(remembered("cc-book-pages:" + rel));
      if (at >= 1 && of >= at) return { at, of };
    }
    // Through `remembered`, not localStorage: the shelf and the reader read
    // one record, and it is the one the app keeps on disk as well as in the
    // browser. See place.ts.
    const of = Number(remembered("cc-book-of:" + rel));
    if (!isFinite(of) || of < 2) return null;
    const at = Number(remembered("cc-book-at:" + rel));
    if (!isFinite(at) || at < 0) return null;
    // The reader counts pages from one and chapters from zero, which is the
    // difference between a PDF's page numbers and an EPUB's spine.
    const page = /\.pdf$/i.test(rel) ? at : at + 1;
    return { at: Math.min(Math.max(1, page), of), of };
  } catch {
    return null;
  }
}

function Card({
  book,
  eager,
  dragging,
  over,
  setOver,
  onDragBook,
  onDropOnBook,
  onContextMenu,
}: {
  book: Book;
  eager: boolean;
  dragging: Book | null;
  over: string;
  setOver: (key: string) => void;
  onDragBook: (book: Book | null) => void;
  onDropOnBook: (dropped: Book, onto: Book) => void;
  onContextMenu: (book: Book, x: number, y: number) => void;
}) {
  const place = placeIn(book.rel);
  const isDragging = dragging?.rel === book.rel;
  const isOver = over === book.rel;
  return (
    // Both kinds go through our own reader. The browser's PDF viewer is a
    // closed box: the text in it cannot be selected from outside, so the
    // right-click menu -- copy, look it up, split view -- had nothing to work
    // with on exactly the books you most want it on.
    <a
      className={
        "bkcard" + (isDragging ? " dragging" : "") + (isOver ? " drop-target" : "")
      }
      href={"/books/read?f=" + encodeURIComponent(book.rel)}
      target="_blank"
      rel="noreferrer"
      title={book.name}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", book.rel);
        onDragBook(book);
      }}
      onDragEnd={() => {
        onDragBook(null);
        setOver("");
      }}
      onDragOver={(e) => {
        if (!dragging || dragging.rel === book.rel) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOver(book.rel);
      }}
      onDragLeave={() => {
        if (over === book.rel) setOver("");
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver("");
        if (dragging && dragging.rel !== book.rel) onDropOnBook(dragging, book);
        onDragBook(null);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(book, e.clientX, e.clientY);
      }}
    >
      {book.kind === "epub" ? <EpubCover book={book} /> : <PdfCover book={book} eager={eager} />}
      <span className={"kind " + book.kind}>{book.kind.toUpperCase()}</span>
      {place && (
        <span
          className="bkprog"
          title={`${place.at} of ${place.of}`}
          style={{ ["--done" as string]: `${(place.at / place.of) * 100}%` }}
        />
      )}
      <h3>{book.name}</h3>
      <div className="meta">
        {size(book.size)}
        {place ? (
          <>
            {size(book.size) ? " · " : ""}
            <b className="bkat">
              {place.at}/{place.of}
            </b>
          </>
        ) : null}
      </div>
    </a>
  );
}

/**
 * A chapter's own styling, torn off before it goes into the thumbnail.
 *
 * The reader wants a book's `<style>` -- that is how it looks the way its
 * publisher meant. A thumbnail sitting in a dark card three inches wide does
 * not: a book styled for white paper can set text the same colour as its own
 * background, invisible on paper and invisible here for the same reason,
 * except here there was never any paper for it to sit on. Classes go too, on
 * the same reasoning -- a book's own "note" or "btn" is a coincidence away
 * from this app's.
 */
function stripStyling(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  div.querySelectorAll("style, link").forEach((el) => el.remove());
  div.querySelectorAll("[style]").forEach((el) => el.removeAttribute("style"));
  div.querySelectorAll("[class]").forEach((el) => el.removeAttribute("class"));
  return div.innerHTML;
}

/** An EPUB names its own cover. One that does not falls back to a plain mark. */
function EpubCover({ book }: { book: Book }) {
  const [missing, setMissing] = useState(false);
  // Empty string once asked for and the book turned out to have no readable
  // first page either -- distinct from null, "haven't asked yet", so it is
  // only ever fetched once.
  const [firstPage, setFirstPage] = useState<string | null>(null);

  useEffect(() => {
    if (!missing || firstPage !== null) return;
    api
      .chapter(book.rel, 0)
      .then((part) => setFirstPage(stripStyling(part.html || "")))
      .catch(() => setFirstPage(""));
  }, [missing, firstPage, book.rel]);

  return (
    <div className="cover">
      {!missing ? (
        <img
          loading="lazy"
          alt=""
          src={"/api/central/bookcover?f=" + encodeURIComponent(book.rel)}
          onError={() => setMissing(true)}
        />
      ) : firstPage ? (
        // The reader's own reading order, scaled down rather than redrawn --
        // a page of the actual book beats a mark that just says "this is a
        // book". Pictures inside are hidden: a thumbnail firing off requests
        // for full-size in-book images just to sit at 20% scale is the same
        // waste PdfCover's lazy draw exists to avoid.
        <div className="epub-firstpage" dangerouslySetInnerHTML={{ __html: firstPage }} />
      ) : (
        <span className="none">📗</span>
      )}
    </div>
  );
}

/**
 * A PDF has no cover to read, so its first page is drawn instead -- and only
 * once the card is near the screen, because nine books is nine downloads and
 * you may only be looking at three of them.
 *
 * The first dozen are drawn straight away: a tab opened behind this one never
 * runs an observer, and a shelf of empty rectangles is not a shelf.
 */
function PdfCover({ book, eager }: { book: Book; eager: boolean }) {
  const cover = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const drawn = useRef(false);

  useEffect(() => {
    const holder = cover.current;
    if (!holder) return;
    let live = true;

    const draw = () => {
      if (drawn.current) return;
      drawn.current = true;
      const url = "/bookfile/" + book.rel.split("/").map(encodeURIComponent).join("/");
      loadPdfjs()
        .then((L) => L.getDocument(url).promise)
        .then((doc) => doc.getPage(1))
        .then((page) => {
          if (!live || !cover.current) return;
          const canvas = document.createElement("canvas");
          const want = 330;
          const v1 = page.getViewport({ scale: 1 });
          const vp = page.getViewport({ scale: want / v1.width });
          canvas.width = Math.ceil(vp.width);
          canvas.height = Math.ceil(vp.height);
          cover.current.insertBefore(canvas, cover.current.firstChild);
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          return page.render({ canvasContext: ctx, viewport: vp }).promise;
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    };

    if (eager || !window.IntersectionObserver) {
      draw();
      return () => {
        live = false;
      };
    }
    const watch = new IntersectionObserver(
      (rows) => {
        for (const r of rows) {
          if (!r.isIntersecting) continue;
          watch.unobserve(r.target);
          draw();
        }
      },
      { rootMargin: "300px" },
    );
    watch.observe(holder);
    return () => {
      live = false;
      watch.disconnect();
    };
  }, [book.rel, eager]);

  return (
    <div className="cover" ref={cover} data-rel={book.rel}>
      {failed ? <span className="none">📄</span> : null}
    </div>
  );
}

function size(n: number) {
  if (!n) return "";
  const mb = n / 1048576;
  return mb >= 1 ? mb.toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
}

/**
 * A book's right-click menu: file it in a folder already on the shelf, start
 * a new one for it alone, or -- already on one -- come back off it. Closed
 * by anything else: another click, a key, the page scrolling out from under
 * it.
 */
function BookMenu({
  x,
  y,
  grouped,
  otherFolders,
  onAddToFolder,
  onNewFolder,
  onRemoveFromFolder,
  onClose,
}: {
  x: number;
  y: number;
  grouped: boolean;
  otherFolders: string[];
  onAddToFolder: (folder: string) => void;
  onNewFolder: () => void;
  onRemoveFromFolder: () => void;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const away = () => onClose();
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Not the same tick this menu opened on -- the right-click that opened it
    // is itself a "pointerdown" the browser hasn't finished delivering yet.
    const id = setTimeout(() => {
      document.addEventListener("pointerdown", away);
      document.addEventListener("scroll", away, true);
      document.addEventListener("keydown", esc);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("scroll", away, true);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  return (
    <div
      className="bkctxmenu"
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 60) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {!expanded ? (
        <>
          <div className="bkctxitem" onClick={() => setExpanded(true)}>
            Add to folder ▸
          </div>
          {grouped && (
            <div className="bkctxitem" onClick={onRemoveFromFolder}>
              Remove from folder
            </div>
          )}
        </>
      ) : (
        <>
          <div className="bkctxitem bkctxback" onClick={() => setExpanded(false)}>
            ‹ Back
          </div>
          <div className="bkctxitem" onClick={onNewFolder}>
            + New folder&hellip;
          </div>
          {otherFolders.length > 0 && (
            <>
              <div className="bkctxsep" />
              <div className="bkctxfolders">
                {otherFolders.map((f) => (
                  <div key={f} className="bkctxitem" onClick={() => onAddToFolder(f)}>
                    {f}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * What to call the folder a drag, or "New folder...", just asked for.
 *
 * `books` is one for a right-click's own "New folder...", two for a drag
 * that landed on another book still loose in the books folder.
 */
function NameFolderModal({
  books,
  onCancel,
  onCreate,
}: {
  books: Book[];
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onCreate(trimmed);
  };

  const who = books.map((b) => `“${b.name}”`).join(" and ");

  // The app's own modal chrome -- the same one the questions on the other
  // pages wear -- so Escape, the scrim, the focus trap and the way back to
  // whatever was focused are all had for free and behave the same here.
  return (
    <Modal onClose={onCancel} labelledBy="bk-newfolder">
      <h2 className="ccd-title" id="bk-newfolder">
        New folder
      </h2>
      <p className="ccd-body">Name a folder for {who}.</p>
      <div className="ccd-field">
        <input
          type="text"
          value={name}
          data-first
          placeholder="Folder name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
      </div>
      <div className="ccd-row">
        <button type="button" className="ccd-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="ccd-btn go"
          disabled={!name.trim()}
          onClick={submit}
        >
          Create folder
        </button>
      </div>
    </Modal>
  );
}

export default Books;
