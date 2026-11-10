/**
 * pdf.js, loaded once from the dictionary folder.
 *
 * It ships with the app in dict/vendor, so a book opens with no internet.
 * The library puts itself on `window.pdfjsLib`; these types say only what the
 * reader and the shelf actually ask of it.
 */

export interface Viewport {
  width: number;
  height: number;
}

export interface Page {
  getViewport(options: { scale: number }): Viewport;
  render(options: {
    canvasContext: CanvasRenderingContext2D;
    viewport: Viewport;
  }): { promise: Promise<void> };
  getTextContent(): Promise<unknown>;
}

export interface Doc {
  numPages: number;
  getPage(n: number): Promise<Page>;
  getOutline(): Promise<OutlineItem[] | null>;
  getDestination(name: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
}

export interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  items: OutlineItem[];
}

export interface Lib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(url: string): { promise: Promise<Doc> };
  renderTextLayer(options: {
    textContentSource: unknown;
    container: HTMLElement;
    viewport: Viewport;
    textDivs: HTMLElement[];
  }): { promise: Promise<void> };
}

declare global {
  interface Window {
    pdfjsLib?: Lib;
  }
}

let asked: Promise<Lib> | null = null;

/**
 * The library, fetched on the first book that needs it and kept after.
 *
 * KEPT ONLY IF IT WORKED. This held on to the promise whatever became of it,
 * so a single failed load -- the script asked for while the server was still
 * coming up, a moment's hiccup, anything -- was answered to every later
 * caller for the life of the page. And the caller's response to a rejection
 * is to hand the book to the browser's own PDF viewer, so one bad moment
 * turned into "sometimes it opens in the wrong reader" that never recovered
 * until the tab was reloaded. Every book after it, and every cover on the
 * shelf, took the same cached no.
 *
 * A rejection is therefore forgotten, and the next book tries again.
 */
export function loadPdfjs(): Promise<Lib> {
  if (asked) return asked;
  const attempt = new Promise<Lib>((ok, bad) => {
    const script = document.createElement("script");
    script.src = "/dictdata/vendor/pdf.min.js";
    script.onload = () => {
      const lib = window.pdfjsLib;
      if (!lib) {
        bad(new Error("no pdfjsLib"));
        return;
      }
      lib.GlobalWorkerOptions.workerSrc = "/dictdata/vendor/pdf.worker.min.js";
      ok(lib);
    };
    script.onerror = () => bad(new Error("pdf.js would not load"));
    document.head.appendChild(script);
  });
  asked = attempt.catch((e: unknown) => {
    asked = null;
    throw e;
  });
  return asked;
}

/**
 * What is remembered, and under which name.
 *
 * These were localStorage and nothing else, which is why a book's place did
 * not survive a browser that clears site data. They live in `place.ts` now,
 * which writes through to the app's own settings file as well; re-exported
 * here so a reader can go on asking the module it always asked.
 */
export { remember, remembered } from "./place";
