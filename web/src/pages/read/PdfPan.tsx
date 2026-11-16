import { useEffect, useRef, type RefObject } from "react";

/** Horizontal scrollbar anchored to the viewport of the PDF tab. */
export function PdfPan({ pages, ready }: { pages: RefObject<HTMLDivElement | null>; ready: boolean }) {
  const bar = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const content = pages.current;
    const control = thumb.current;
    const frame = bar.current;
    if (!ready || !content || !control || !frame) return;
    let pending = 0;
    const update = () => {
      pending = 0;
      const viewport = document.documentElement.clientWidth;
      const width = document.documentElement.scrollWidth;
      const travel = Math.max(0, width - viewport);
      frame.hidden = travel <= 1;
      control.max = String(travel);
      control.value = String(Math.round(window.scrollX));
      // Show a proportional thumb, with a usable minimum at high zoom.
      frame.style.setProperty("--pdf-thumb-width", `clamp(28px, ${100 * viewport / Math.max(1, width)}%, 100%)`);
    };
    const schedule = () => {
      if (!pending) pending = requestAnimationFrame(update);
    };
    const changes = new MutationObserver(schedule);
    changes.observe(content, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, { passive: true });
    update();
    return () => {
      changes.disconnect();
      cancelAnimationFrame(pending);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule);
    };
  }, [pages, ready]);

  return <div className="pf-pan" ref={bar} hidden>
    <input type="range" min="0" max="0" step="1" ref={thumb}
      aria-label="Scroll PDF horizontally"
      onInput={(event) => window.scrollTo(event.currentTarget.valueAsNumber, window.scrollY)} />
  </div>;
}
