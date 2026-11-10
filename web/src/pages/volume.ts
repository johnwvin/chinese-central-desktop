// Shared level for pronunciation recordings in app pages.
let current = 1;
let patched = false;
let playing: HTMLMediaElement | undefined;
/** Loud as the master alone goes: twice what the element can do by itself. */
export const MAX_VOLUME = 2;

let ctx: AudioContext | null = null;
const gains = new WeakMap<HTMLMediaElement, GainNode>();
/** Elements the graph could not take, so they are not tried again and again. */
const refused = new WeakSet<HTMLMediaElement>();

function audio(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  // When it is finally allowed to run, put the level on again -- whatever was
  // asked for while it was held is applied then, without anyone doing
  // anything.
  ctx.addEventListener("statechange", () => {
    if (ctx?.state === "running") setVolume(current);
  });
  return ctx;
}

/**
 * The gain stage for one element, made the first time it is needed.
 *
 * Null means this element cannot be boosted -- no audio graph, another origin,
 * or a context that will not start -- and the caller leaves it at its own full
 * volume rather than routing it into silence.
 */
function gainFor(el: HTMLMediaElement): GainNode | null {
  const have = gains.get(el);
  if (have) return have;
  if (refused.has(el)) return null;
  const c = audio();
  if (!c) {
    refused.add(el);
    return null;
  }
  if (c.state === "suspended") void c.resume();
  // Held for now; statechange above brings the level back when it starts.
  if (c.state !== "running") return null;
  try {
    const node = c.createGain();
    c.createMediaElementSource(el).connect(node);
    node.connect(c.destination);
    gains.set(el, node);
    return node;
  } catch {
    // Already tapped by something else, or a source we are not allowed to
    // read. Either way it stays as it was.
    refused.add(el);
    return null;
  }
}

function apply(el: HTMLMediaElement): void {
  el.volume = Math.min(1, current);
  el.muted = current === 0;
  const node = current > 1 ? gainFor(el) : gains.get(el) ?? null;
  if (node) node.gain.value = Math.max(current, 1);
}

/** Set the volume of everything this page plays, now and later. */
export function setVolume(v: number): void {
  current = Math.max(0, Math.min(MAX_VOLUME, Number(v) || 0));
  if (playing && !playing.ended) apply(playing);
}

/**
 * Install the hook the strip calls.
 *
 * play() is wrapped once per page rather than a listener being added to each
 * clip: a clip that is created, played and dropped inside one function never
 * exists long enough to be given one.
 */
export function installVolume(): void {
  const hooks = window as unknown as {
    __ccVol?: (v: number) => void;
    __ccVoiceVolume?: () => number;
  };
  hooks.__ccVol = setVolume;
  // SpeechSynthesisUtterance is not an HTMLMediaElement and never passes
  // through play(), so the right-click menu asks for the same effective level
  // explicitly. Its API tops out at 1; quieter settings still apply exactly,
  // while boosting above normal remains the media gain stage's job.
  hooks.__ccVoiceVolume = () => Math.min(1, current);
  if (patched) return;
  patched = true;

  const proto = HTMLMediaElement.prototype;
  const play = proto.play;
  proto.play = function (this: HTMLMediaElement) {
    if (this instanceof HTMLAudioElement && this.src.startsWith(location.origin + "/dictdata/audio/")) {
      playing = this;
      apply(this);
    }
    return play.call(this);
  };
}
