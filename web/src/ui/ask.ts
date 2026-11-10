/**
 * Asking the reader something, from anywhere.
 *
 * This is what replaced window.confirm(). It is deliberately not a hook: the
 * calls it took over come from a plain click handler on Control, from an async
 * function in Recordings, and from games/bridge.ts, which is not a component
 * at all. A hook could not have served all three. `await confirmDialog(...)`
 * serves them the same way.
 *
 * Nothing here draws anything. A question goes in the queue and DialogHost --
 * mounted once, in App, so it is on every page -- draws whichever is at the
 * front and settles its promise. A question asked before that host is on
 * screen waits in the queue rather than falling back to the browser's box:
 * there is no path through this file that puts a native dialog on screen.
 */

export type Ask = {
  /** The question. Short, and it is the heading. */
  title: string;
  /** What is about to happen. A string, or a paragraph each. */
  body?: string | string[];
  /** Default: "Yes". */
  yes?: string;
  /** Default: "Cancel". */
  no?: string;
  /** Red button, and Cancel starts with the focus. For anything that removes. */
  danger?: boolean;
  /** One button. Nothing is being decided, something is being said. */
  tell?: boolean;
};

export type Waiting = { id: number; ask: Ask; settle: (yes: boolean) => void };

let queue: Waiting[] = [];
let wake: (() => void) | null = null;
let counter = 0;

function raise(ask: Ask): Promise<boolean> {
  return new Promise<boolean>((settle) => {
    queue = [...queue, { id: ++counter, ask, settle }];
    wake?.();
  });
}

/** Ask, and wait for the answer. Replaces window.confirm. */
export function confirmDialog(ask: Ask): Promise<boolean> {
  return raise(ask);
}

/** Say something, and wait for it to be read. Replaces window.alert. */
export function alertDialog(ask: Omit<Ask, "tell" | "no">): Promise<void> {
  return raise({ ...ask, tell: true }).then(() => undefined);
}

/* ---------------------------------------------- what DialogHost uses ---- */

/** The question on screen, or none. */
export function asked(): Waiting | undefined {
  return queue[0];
}

/** Answer the one on screen and let the next through. */
export function answer(yes: boolean) {
  const top = queue[0];
  if (!top) return;
  queue = queue.slice(1);
  top.settle(yes);
  wake?.();
}

/** The host says where to knock. Returns the way to stop. */
export function onAsked(fn: () => void) {
  wake = fn;
  // Anything asked between this module loading and the host mounting is still
  // in the queue, waiting. Draw it.
  if (queue.length) fn();
  return () => {
    if (wake === fn) wake = null;
  };
}
