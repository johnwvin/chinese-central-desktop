import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api/central";
import { HubPage } from "./HubPage";

export function Control() {
  return <HubPage name="control">
    <h1>Control</h1>
    <div className="location-settings">
      <LocationField label="Books folder" load={api.booksPath} save={api.setBooksPath} />
      <LocationField label="Notebook folder" load={api.notesPath} save={(path) => api.setNotesPath(path, false)} />
    </div>
  </HubPage>;
}

function LocationField({ label, load, save }: {
  label: string;
  load: () => Promise<{ path: string }>;
  save: (path: string) => Promise<{ path: string }>;
}) {
  const [path, setPath] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void load().then((value) => { if (live) setPath(value.path); })
      .catch((error) => { if (live) setMessage(String(error.message)); });
    return () => { live = false; };
  }, [load]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try { setPath((await save(path.trim())).path); setMessage("Saved"); }
    catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <form className="location-form" onSubmit={submit}>
    <label>{label}<input type="text" value={path} onChange={(event) => { setPath(event.target.value); setMessage(""); }} required /></label>
    <button type="submit" className="btn" disabled={busy || !path.trim()}>Save</button>
    <output aria-live="polite">{message}</output>
  </form>;
}
