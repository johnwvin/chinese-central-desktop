/**
 * Back to top.
 *
 * The button scrolls the current tab's document to the top.
 *
 * Built against the DOM rather than rendered, for the same reason the
 * right-click menu is: it sits on document.body, outside whatever page is
 * mounted, and every page wants exactly the same one.
 */

const ID = "cc-totop";
/** How far down before going back is worth offering. */
const SHOW = 400;

function style() {
  if (document.getElementById("cc-totop-style")) return;
  const el = document.createElement("style");
  el.id = "cc-totop-style";
  el.textContent = `
#${ID} {
  position: fixed; right: 18px; bottom: 18px; z-index: 50;
  width: 42px; height: 42px; padding: 0; border-radius: 50%;
  display: grid; place-items: center; 
  color: var(--muted, #5b6672);
  background: var(--card, #fff);
  border: 1px solid var(--line, #e3e7ec);
  box-shadow: 0 2px 6px rgba(0,0,0,.18), 0 10px 26px rgba(0,0,0,.16);
  opacity: 0; transform: translateY(8px); pointer-events: none;
  transition: opacity .16s ease, transform .16s ease,
              color .14s ease, border-color .14s ease;
}
#${ID}.on { opacity: 1; transform: none; pointer-events: auto; }
#${ID}:hover { color: var(--accent, #d99e00); border-color: var(--accent, #d99e00); }
#${ID}:active { transform: scale(.92); }
#${ID} svg { width: 19px; height: 19px; display: block; }
@media print { #${ID} { display: none; } }`;
  document.head.appendChild(el);
}

/** Installs the button for the mounted page and removes it on navigation. */
export function installBackToTop() {
  if (document.getElementById(ID)) return;
  style();

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = ID;
  btn.title = "Back to top";
  btn.setAttribute("aria-label", "Back to top");
  // Drawn, not written: the arrow character sits off its own centre in a round
  // button, which is exactly enough to look wrong without looking obviously so.
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
    ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>';
  // Instant, not smooth. These pages are long, and animating the whole way
  // back makes the browser lay the page out again on every frame of the trip.
  // "instant" rather than the default so a page with scroll-behavior: smooth
  // cannot put the animation back. Keep in step with backtotop.html.
  btn.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "instant" }));
  document.body.appendChild(btn);

  let on = false;
  let waiting = false;
  const paint = () => {
    waiting = false;
    const want = (window.scrollY || document.documentElement.scrollTop || 0) > SHOW;
    if (want === on) return;
    on = want;
    btn.classList.toggle("on", on);
  };
  const onScroll = () => {
    if (waiting) return;
    waiting = true;
    requestAnimationFrame(paint);
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", paint);
  paint();
  return () => {
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", paint);
    btn.remove();
  };
}
