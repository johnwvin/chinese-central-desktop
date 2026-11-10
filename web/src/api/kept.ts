import { useEffect, useState } from "react";

/**
 * Settings that are the app's, not the browser's.
 *
 * NOTHING IN THIS APP IS BROWSER-ONLY. localStorage is a fine working copy --
 * it is there the instant a page paints, before any fetch could answer -- but
 * it belongs to the browser: clear site data, open a different browser, start
 * a new profile, and it is gone with no warning and nothing to recover from.
 * Anything worth remembering about how you had the app set goes in
 * your-settings.json, which is the app's own file on your disk, and comes back
 * from there.
 *
 * That rule kept being learned one setting at a time -- the tabs and the theme
 * had it, the books did not, the white noise did not -- so it is a place
 * rather than a habit now. `keep` writes both copies. `pullSettings` reads the
 * file once a page and folds it back in. A setting that goes through here
 * cannot be browser-only by accident; one that does not go through here is the
 * thing to look at when something is forgotten again.
 *
 * The file's copy wins on the way in. It is the app's record; the browser
 * holds a copy of it so the first paint does not have to wait. Where the file
 * has nothing to say -- the first run after a setting moves here -- whatever
 * the browser had is adopted and sent up, so nobody loses a choice they had
 * already made.
 */

type Kind = "string" | "number" | "boolean";

/**
 * Every setting kept this way: the name the browser knows it by, the name it
 * has in the settings file, and what sort of value it is.
 *
 * Two names because the browser's are historical and the file's are read by
 * people. A key that is not in here is not kept anywhere but this browser --
 * which is the thing to avoid, so add to this rather than reaching for
 * localStorage.
 */
const KEPT: Record<string, { name: string; kind: Kind }> = {
  "cc-pdf-zoom": { name: "pdfZoom", kind: "string" },
  "cc-rec-cam": { name: "recordCamera", kind: "string" },
  "cc-rec-mic": { name: "recordMicrophone", kind: "string" },
  // What those two are called, because an id alone does not survive -- see
  // the note over `remember` in Recordings.tsx.
  "cc-rec-cam-name": { name: "recordCameraName", kind: "string" },
  "cc-rec-mic-name": { name: "recordMicrophoneName", kind: "string" },
  "cc-noise-vol": { name: "noiseVolume", kind: "number" },
  "cc-notes-folded": { name: "notesListFolded", kind: "boolean" },
};

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The working copy, so a browser with storage turned off still works. */
const MEM: Record<string, string> = {};

export function kept(key: string): string | null {
  if (key in MEM) return MEM[key];
  try {
    return local()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  MEM[key] = value;
  try {
    local()?.setItem(key, value);
  } catch {
    // Full, or turned off. The file is the copy that matters.
  }
}

/** A string as the settings file should hold it. */
function asJson(key: string, value: string): unknown {
  switch (KEPT[key]?.kind) {
    case "number":
      return Number(value) || 0;
    case "boolean":
      return value === "1" || value === "true";
    default:
      return value;
  }
}

/** And back: what the browser and every caller here work in. */
function asText(key: string, value: unknown): string {
  switch (KEPT[key]?.kind) {
    case "number":
      return typeof value === "number" ? String(value) : "";
    case "boolean":
      return value ? "1" : "";
    default:
      return typeof value === "string" ? value : "";
  }
}

const DIRTY = new Set<string>();
let timer = 0;

export function keep(key: string, value: string): void {
  write(key, value);
  if (!KEPT[key]) return; // Not one of ours: the browser's copy is all there is.
  DIRTY.add(key);
  window.clearTimeout(timer);
  // A slider dragged is a hundred changes and one setting. The file is written
  // when it comes to rest.
  timer = window.setTimeout(flush, 700);
}

function patch(): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of DIRTY) {
    const spec = KEPT[key];
    if (spec) body[spec.name] = asJson(key, MEM[key] ?? "");
  }
  return body;
}

function flush(): void {
  window.clearTimeout(timer);
  if (!DIRTY.size) return;
  const body = patch();
  DIRTY.clear();
  void fetch("/api/central/prefs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    // The server has gone. The browser's copy stands, and the next change
    // sends this setting again.
  });
}

// A page closed a moment after a change still writes it: the beacon outlives
// the page, which a fetch started here would not.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    window.clearTimeout(timer);
    if (!DIRTY.size) return;
    const body = JSON.stringify(patch());
    DIRTY.clear();
    try {
      if (navigator.sendBeacon?.("/api/central/prefs", new Blob([body], { type: "application/json" })))
        return;
    } catch {
      // No beacon, or it would not take it.
    }
    void fetch("/api/central/prefs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  });
}

let pulling: Promise<Record<string, unknown>> | null = null;
/**
 * The settings file, once per page, shared by everything that wants it.
 *
 * The books want it too -- their places are a key in the same file -- so this
 * hands back the whole object rather than only what it folded in. Two readers
 * of one file should not be two round trips. See read/place.ts.
 */
export function pullSettings(): Promise<Record<string, unknown>> {
  if (pulling) return pulling;
  pulling = fetch("/api/central/prefs", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : {}))
    .then((d: unknown) => {
      const all = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
      for (const [key, spec] of Object.entries(KEPT)) {
        if (spec.name in all) {
          write(key, asText(key, all[spec.name]));
          continue;
        }
        // The file has never heard of this one: the first run after it moved
        // here. Whatever this browser had is the answer, and it goes up.
        const here = kept(key);
        if (here != null && here !== "") keep(key, here);
      }
      return all;
    })
    .catch(() => {
      // No server, or one too old to answer. The browser's copy stands.
      return {};
    });
  return pulling;
}

/**
 * True once the settings file is in.
 *
 * Naming it in a component is what redraws that component when the file lands,
 * so a page painted from the browser's copy corrects itself rather than
 * showing a stale setting until something else happens to re-render it.
 */
export function useSettings(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void pullSettings().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, []);
  return ready;
}
