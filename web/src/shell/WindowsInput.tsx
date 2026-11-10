import { useCallback, useEffect, useState } from "react";

type InputState = {
  layout: string;
  short: string;
  mode: "chinese" | "english" | null;
  modeControl: boolean;
  method: "weasel" | "microsoft_pinyin" | "other";
  name: string;
};
type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

function reportInputFailure(failure: unknown) {
  console.warn("Windows input:", failure);
}

function nativeInvoke(): Invoke | null {
  const bridge = window as Window & {
    __TAURI__?: { core?: { invoke?: Invoke } };
    __TAURI_INTERNALS__?: { invoke?: Invoke };
  };
  return bridge.__TAURI__?.core?.invoke ?? bridge.__TAURI_INTERNALS__?.invoke ?? null;
}

function layoutMark(short: string) {
  return short === "Weasel"
    ? <img className="windows-input-icon" src="/ime-icons/weasel.png" alt="Weasel" />
    : short;
}

export function WindowsInput() {
  const invoke = nativeInvoke();
  const [state, setState] = useState<InputState | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = useCallback(() => {
    if (!invoke) return;
    void invoke("windows_input_state").then((value) => {
      const current = value as InputState;
      setState(current);
    }).catch(reportInputFailure);
  }, [invoke]);

  useEffect(() => {
    if (!invoke) return;
    refresh();
    const timer = window.setInterval(refresh, 800);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [invoke, refresh]);

  if (!invoke || !state) return null;
  const modeLabel = state.mode === "chinese" ? "中" : state.mode === "english" ? "英" : "中/英";

  const toggleMode = () => {
    if (pending) return;
    setPending(true);
    void invoke("toggle_windows_ime").then(() => {
      window.setTimeout(() => {
        void invoke("windows_input_state").then((value) => {
          const current = value as InputState;
          setState(current);
          if (current.mode === null) {
            reportInputFailure("The input method did not report its mode.");
          } else if (state.mode && current.mode === state.mode) {
            reportInputFailure("Windows did not report a mode change.");
          }
        }).catch(reportInputFailure)
          .finally(() => setPending(false));
      }, 500);
    }).catch((failure: unknown) => { reportInputFailure(failure); setPending(false); });
  };

  return (
    <div className="windows-input">
      {state.modeControl && (
        <button type="button" className="windows-ime-mode"
          aria-busy={pending}
          title={state.mode ? `Windows input mode: ${state.mode}. Click to switch.` :
            state.method === "weasel" ? "Switch Weasel between Chinese and English input" : "Switch Windows Chinese/English input mode"}
          aria-label="Switch Windows Chinese or English input mode"
          onMouseDown={(event) => event.preventDefault()}
          onClick={toggleMode}>
          {pending ? "…" : state.mode ? (
            <img className="windows-input-icon"
              src={`/ime-icons/${state.mode === "chinese" ? "chinese" : "ascii"}.png`}
              alt={modeLabel} />
          ) : "?"}
        </button>
      )}
      <span className="windows-layout" title={state.name} aria-label={state.name}>
        {layoutMark(state.short)}
      </span>
    </div>
  );
}
