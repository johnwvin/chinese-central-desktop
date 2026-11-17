import { useEffect, useState } from "react";
import { api, type Note } from "../api/central";
import { confirmDialog } from "../ui/ask";
import { HubPage } from "./HubPage";

function noteName(title: string, edited: string): string {
  if (title.trim()) return title;
  return edited ? edited.replace("T", " ") : "Untitled";
}

const blank = (): Note => ({ id: "", title: "", body: "", at: "", folder: "" });

export function Notes() {
  const [list, setList] = useState<Note[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [draft, setDraft] = useState<Note>(blank);
  const [query, setQuery] = useState("");
  const [folderName, setFolderName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  useEffect(() => {
    let live = true;
    void api.notes().then((value) => {
      if (!live) return;
      setList(value.notes);
      setFolders(value.folders);
      const id = new URLSearchParams(location.search).get("note");
      if (id) setDraft(value.notes.find((note) => note.id === id) ?? blank());
    }).catch((error) => { if (live) setMessage(error.message); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function edit(patch: Partial<Note>) {
    setDraft((note) => ({ ...note, ...patch }));
    setDirty(true);
    setMessage("");
  }
  async function choose(note: Note) {
    if (dirty && !await confirmDialog({ title: "Discard unsaved changes?", yes: "Discard" })) return;
    setDraft(note);
    setDirty(false);
    setMessage("");
  }
  async function save() {
    if (busy) return;
    setBusy(true);
    const id = draft.id || crypto.randomUUID();
    try {
      const result = await api.saveNote({ id, title: draft.title, body: draft.body, folder: draft.folder ?? "" });
      setList(result.notes);
      setFolders(result.folders);
      setDraft(result.notes.find((note) => note.id === id) ?? { ...draft, id });
      setDirty(false);
      setMessage("Saved");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!draft.id || !await confirmDialog({ title: `Delete “${noteName(draft.title, draft.at)}”?`, yes: "Delete", danger: true })) return;
    setBusy(true);
    try {
      const result = await api.deleteNote(draft.id);
      setList(result.notes);
      setDraft(blank());
      setDirty(false);
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }
  return <HubPage name="notes">
    <h1>Notebook</h1>
    <div className="plain-notebook">
      <div className="notebook-sidebar-layer">
      <button type="button" className="btn notebook-sidebar-toggle" aria-controls="notebook-sidebar"
        aria-expanded={sidebarOpen} aria-label={sidebarOpen ? "Hide the list" : "Show the list"}
        title={sidebarOpen ? "Hide the list" : "Show the list"} onClick={() => setSidebarOpen(!sidebarOpen)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" /></svg>
      </button>
      <aside id="notebook-sidebar" aria-label="Notes" hidden={!sidebarOpen}>
        <button className="btn" type="button" disabled={busy} onClick={() => void choose(blank())}>New note</button>
        <input type="search" aria-label="Search notes" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
        <ul>{list.filter((note) => `${noteName(note.title, note.at)} ${note.body}`.toLowerCase().includes(query.toLowerCase())).map((note) =>
          <li key={note.id}><button className="btn" type="button" aria-pressed={draft.id === note.id} disabled={busy} onClick={() => void choose(note)}>
            {noteName(note.title, note.at)}{note.folder && <small>{note.folder}</small>}
          </button></li>)}</ul>
      </aside>
      </div>
      <div className="notebook-editor">
        <input aria-label="Title" placeholder={draft.at ? noteName("", draft.at) : "Title"} value={draft.title} disabled={busy} onChange={(event) => edit({ title: event.target.value })} />
        <div className="notebook-folders">
          <select aria-label="Folder" value={draft.folder ?? ""} disabled={busy} onChange={(event) => edit({ folder: event.target.value })}>
            <option value="">Notes</option>{folders.map((folder) => <option key={folder}>{folder}</option>)}
          </select>
          <form onSubmit={(event) => {
            event.preventDefault();
            if (!folderName.trim()) return;
            void api.createNoteFolder(folderName.trim()).then((value) => {
              setFolders(value.folders);
              setFolderName("");
            }).catch((error) => setMessage(error.message));
          }}>
            <input aria-label="New folder name" placeholder="New folder" value={folderName} onChange={(event) => setFolderName(event.target.value)} />
            <button type="submit" className="btn" disabled={!folderName.trim()}>Add</button>
          </form>
        </div>
        <textarea aria-label="Note" value={draft.body} disabled={busy} onChange={(event) => edit({ body: event.target.value })} />
        <div className="notebook-actions">
          <button className="btn accent" type="button" disabled={busy || !dirty} onClick={() => void save()}>Save</button>
          {draft.id && <button className="btn" type="button" disabled={busy} onClick={() => void remove()}>Delete</button>}
          <output aria-live="polite">{message}</output>
        </div>
      </div>
    </div>
  </HubPage>;
}
