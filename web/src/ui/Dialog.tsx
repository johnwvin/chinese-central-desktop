/**
 * Central's dialogs: the chrome, and the one host that draws the questions.
 *
 * There were four window.confirm() calls left in the app and every one of them
 * put the same grey browser slab -- "the local address" -- over the page,
 * froze it, and looked like nothing else here. They are all this now.
 *
 * `Modal` is the chrome on its own -- the scrim, the card, the focus trap,
 * Escape, and the scroll lock -- for the two places that draw their own
 * contents (Books names a folder in one). `DialogHost` is what draws the
 * questions raised through ui/ask.ts; App mounts it once, so every page has
 * it.
 */
import { useEffect, useId, useReducer, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { answer, asked, onAsked, type Ask } from "./ask";
import "./dialog.css";

/* ------------------------------------------------------------------ chrome */

const FOCUSABLE = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusable(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function Modal({
  onClose,
  labelledBy,
  describedBy,
  alert,
  wide,
  danger,
  children,
}: {
  /** Escape, and the scrim. What that means is the caller's business. */
  onClose: () => void;
  labelledBy?: string;
  describedBy?: string;
  /** A question with consequences behind it, so a screen reader interrupts. */
  alert?: boolean;
  wide?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);

  // Whatever had the focus gets it again on the way out -- otherwise closing a
  // dialog opened from a row leaves the next Tab starting at the top of the
  // page, which is not where the reader was.
  useEffect(() => {
    back.current = document.activeElement as HTMLElement | null;
    const body = document.body;
    const had = body.style.overflow;
    body.style.overflow = "hidden";
    return () => {
      body.style.overflow = had;
      const to = back.current;
      if (to && document.contains(to) && typeof to.focus === "function") {
        to.focus();
      }
    };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const first =
      el.querySelector<HTMLElement>("[data-first]") ?? focusable(el)[0] ?? el;
    first.focus();
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const el = box.current;
      if (!el) return;
      const list = focusable(el);
      if (!list.length) {
        e.preventDefault();
        return;
      }
      const edge = e.shiftKey ? list[0] : list[list.length - 1];
      const wrap = e.shiftKey ? list[list.length - 1] : list[0];
      const now = document.activeElement;
      if (now === edge || !el.contains(now)) {
        e.preventDefault();
        wrap.focus();
      }
    };
    // Captured, so a page listening for Escape itself -- the tab strip, the
    // reader, the right-click menu -- does not also act on the press that shut
    // this.
    document.addEventListener("keydown", key, true);
    return () => document.removeEventListener("keydown", key, true);
  }, [onClose]);

  return createPortal(
    <div
      className="ccd-scrim"
      // Down, not click: dragging a selection out of the field and letting go
      // over the scrim is not a request to throw the dialog away.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={box}
        className={`ccd-box${wide ? " wide" : ""}${danger ? " danger" : ""}`}
        role={alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------- the asking */

/**
 * The one host. Mounted in App, so it is on every page.
 *
 * Questions are answered one at a time and in the order they were asked; two
 * arriving together stack rather than fight over the screen.
 */
export function DialogHost() {
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => onAsked(bump), []);

  const top = asked();
  if (!top) return null;
  // Keyed on the id so a second question gets its own state, its own focus and
  // its own animation rather than inheriting the first one's.
  return <AskBox key={top.id} ask={top.ask} />;
}

function AskBox({ ask }: { ask: Ask }) {
  const id = useId();
  const lines =
    ask.body == null ? [] : typeof ask.body === "string" ? [ask.body] : ask.body;

  // Cancel holds the focus on anything destructive. The browser's box put OK
  // under the return key, and the whole point of asking about a delete is that
  // a stray keystroke should not carry it out.
  const first = ask.tell || !ask.danger ? "yes" : "no";

  return (
    <Modal
      onClose={() => answer(false)}
      labelledBy={`${id}-t`}
      describedBy={lines.length ? `${id}-b0` : undefined}
      alert
      danger={ask.danger}
    >
      <h2 className="ccd-title" id={`${id}-t`}>
        {ask.title}
      </h2>
      {lines.map((line, i) => (
        <p className="ccd-body" id={`${id}-b${i}`} key={i}>
          {line}
        </p>
      ))}
      <div className="ccd-row">
        {!ask.tell && (
          <button
            type="button"
            className="ccd-btn"
            data-first={first === "no" ? "" : undefined}
            onClick={() => answer(false)}
          >
            {ask.no ?? "Cancel"}
          </button>
        )}
        <button
          type="button"
          className={`ccd-btn ${ask.danger ? "bad" : "go"}`}
          data-first={first === "yes" ? "" : undefined}
          onClick={() => answer(true)}
        >
          {ask.yes ?? (ask.tell ? "OK" : "Yes")}
        </button>
      </div>
    </Modal>
  );
}
