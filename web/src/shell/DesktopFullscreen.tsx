import { useEffect, useState } from "react";
import { desktopInvoke, installFullscreenKeys } from "./desktop";

export function DesktopFullscreen() {
  const [on, setOn] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    let busy = false;
    const change = async (event: Event) => {
      if (busy) return;
      busy = true;
      try {
        const value = await desktopInvoke<boolean>("app_fullscreen", { action: (event as CustomEvent).detail || "status" });
        if (alive) { setOn(value); setError(""); }
      } catch (e) { if (alive) setError(String(e)); }
      finally { busy = false; }
    };
    installFullscreenKeys(document);
    window.addEventListener("cc-app-fullscreen", change);
    window.addEventListener("focus", change);
    void change(new Event("status"));
    return () => { alive = false; window.removeEventListener("cc-app-fullscreen", change); window.removeEventListener("focus", change); };
  }, []);
  return <button type="button" className="desktop-fullscreen" aria-pressed={on}
    aria-label={on ? "Exit app fullscreen" : "Fullscreen app"}
    title={error || (on ? "Exit fullscreen (F11)" : "Fullscreen app (F11)")}
    onClick={() => window.dispatchEvent(new CustomEvent("cc-app-fullscreen", { detail: "toggle" }))}>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d={on ? "M4 9h5V4M15 4v5h5M20 15h-5v5M9 20v-5H4" : "M9 4H4v5M15 4h5v5M20 15v5h-5M9 20H4v-5"}/>
    </svg>
  </button>;
}
