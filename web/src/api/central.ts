export interface Note {
  id: string;
  title: string;
  body: string;
  at: string;
  folder?: string;
}

export interface Book {
  rel: string;
  name: string;
  kind: "pdf" | "epub";
  size: number;
  folder: string;
}

export interface Books {
  books: Book[];
  path: string;
  there: boolean;
}

/** A book's reading order, or the reason it has none. */
export interface Spine {
  title?: string;
  chapters?: { i: number; label: string; file: string }[];
  error?: string;
}

/** One chapter, as the reader puts it on the page. */
export interface Part {
  title?: string;
  label?: string;
  i?: number;
  count?: number;
  html?: string;
  error?: string;
}

export interface NotesPath {
  path: string;
  count: number;
  here: boolean;
  moved?: boolean;
}

export interface BooksPath {
  path: string;
  count: number;
  there: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  let body: unknown = null;
  const text = await response.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError(`${path} did not answer with JSON`, response.status);
    }
  }

  // The server says what went wrong in `error`, and those sentences are
  // written to be shown, so they are carried through as they are.
  const said = (body as { error?: string } | null)?.error;
  if (said) throw new ApiError(said, response.status);
  if (!response.ok) throw new ApiError(`${path} answered ${response.status}`, response.status);
  return body as T;
}

const get = <T,>(path: string) => request<T>(path);
const post = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body) });

/**
 * The answer as it stands, `error` and all.
 *
 * A book that lists no chapters is not a failed request: the reader puts that
 * sentence where the book would have been, so the answer has to arrive rather
 * than be thrown.
 */
async function raw<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: "no-store" });
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(`${path} did not answer with JSON`, response.status);
  }
}

export const api = {
  notes: () => get<{ notes: Note[]; folders: string[] }>("/api/central/notes"),
  saveNote: (save: { id: string; title: string; body: string; folder: string }) =>
    post<{ notes: Note[]; folders: string[] }>("/api/central/notes", { save }),
  deleteNote: (id: string) => post<{ notes: Note[]; folders: string[] }>("/api/central/notes", { delete: id }),
  createNoteFolder: (name: string) =>
    post<{ notes: Note[]; folders: string[] }>("/api/central/notes", { createFolder: name }),
  deleteNoteFolder: (name: string) =>
    post<{ notes: Note[]; folders: string[] }>("/api/central/notes", { deleteFolder: name }),

  notesPath: () => get<NotesPath>("/api/central/notespath"),
  booksPath: () => get<BooksPath>("/api/central/bookspath"),
  books: () => get<Books>("/api/central/books"),
  // Moves the file itself, on disk, into (and if need be making) that folder
  // under the books folder -- the shelf a book shows up on is read straight
  // off its real folder, not a label kept apart from it.
  moveBook: (rel: string, folder: string) =>
    post<{ ok: true; book: Book }>("/api/central/books/move", { rel, folder }),

  // A book that cannot be read says so in `error` rather than failing, because
  // the reader shows that sentence where the book would have been.
  spine: (f: string) => raw<Spine>(`/api/central/epub?f=${encodeURIComponent(f)}`),
  chapter: (f: string, i: number) =>
    raw<Part>(`/api/central/epub?f=${encodeURIComponent(f)}&i=${i}`),

  prefs: () => get<Record<string, unknown>>("/api/central/prefs"),
  savePrefs: (patch: Record<string, unknown>) =>
    post<{ ok: true }>("/api/central/prefs", patch),

  setNotesPath: (to: string, move: boolean) =>
    post<NotesPath>("/api/central/notespath", { to, move }),
  setBooksPath: (to: string) => post<BooksPath>("/api/central/bookspath", { to }),
};
