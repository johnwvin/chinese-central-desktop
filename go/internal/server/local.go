package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"chinese-central/internal/books"
	"chinese-central/internal/hub"
)

// apiFavorites stars one word or takes its star off, and answers with the
// whole list -- so the page that changed it has what the file now holds
// without asking again.
func (s *Server) apiFavorites(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		S  string `json:"s"`
		T  string `json:"t"`
		P  string `json:"p"`
		D  string `json:"d"`
		On bool   `json:"on"`
	}
	if err := decode(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "not JSON"})
		return
	}
	list, err := s.hub.SetFavorite(hub.Favorite{
		S: payload.S, T: payload.T, P: payload.P, D: payload.D}, payload.On)
	if errors.Is(err, hub.ErrNoWord) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "list": list})
}

// ---- the notebook ----

// apiNotes saves or deletes one note, and answers with the whole notebook --
// so a page never has to guess what the file now holds.
func (s *Server) apiNotes(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Delete any `json:"delete"`
		Save   *struct {
			ID     any     `json:"id"`
			Title  string  `json:"title"`
			Body   string  `json:"body"`
			Folder *string `json:"folder"`
		} `json:"save"`
		CreateFolder string `json:"createFolder"`
		DeleteFolder string `json:"deleteFolder"`
	}
	if err := decode(r, &payload); err != nil {
		// Not an object: the notebook as it stands, which is what a GET says.
		writeJSON(w, http.StatusOK, map[string]any{"notes": s.hub.Notes(), "folders": s.hub.NoteFolders()})
		return
	}

	notes := s.hub.Notes()
	var err error
	switch {
	case payload.DeleteFolder != "":
		updated, folders, folderErr := s.hub.DeleteNoteFolder(payload.DeleteFolder)
		if folderErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": folderErr.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"notes": updated, "folders": folders})
		return
	case truthy(payload.Delete):
		notes, err = s.hub.DeleteNote(text(payload.Delete))
	case payload.Save != nil:
		folder := ""
		if payload.Save.Folder != nil {
			folder = *payload.Save.Folder
		}
		notes, err = s.hub.SaveNote(hub.NoteIn{
			ID: text(payload.Save.ID), Title: payload.Save.Title, Body: payload.Save.Body,
			Folder: folder, FolderSet: payload.Save.Folder != nil})
	case payload.CreateFolder != "":
		folders, folderErr := s.hub.AddNoteFolder(payload.CreateFolder)
		if folderErr != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": folderErr.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"notes": s.hub.Notes(), "folders": folders})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"notes": notes, "folders": s.hub.NoteFolders()})
}

// apiNotesPath points the notebook at another folder, and can take the notes
// with it.
func (s *Server) apiNotesPath(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		To   string `json:"to"`
		Move bool   `json:"move"`
	}
	if err := decode(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "No folder given."})
		return
	}
	report, err := s.hub.SetNotesDir(payload.To, payload.Move)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, report)
}

// apiBooksPath points the books page at another folder. Nothing is copied.
func (s *Server) apiBooksPath(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		To string `json:"to"`
	}
	if err := decode(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "No folder given."})
		return
	}
	report, err := s.hub.SetBooksDir(payload.To)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, report)
}

// apiBookMove moves a book into another folder under the books folder, on
// disk -- what groups books on the shelf is the real folder they sit in, so
// this is the one write that can change it.
func (s *Server) apiBookMove(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Rel    string `json:"rel"`
		Folder string `json:"folder"`
	}
	if err := decode(r, &payload); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Which book, and where to?"})
		return
	}
	book, err := s.hub.MoveBook(payload.Rel, payload.Folder)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "book": book})
}

// apiEpub answers with a book's reading order, or one chapter of it.
func (s *Server) apiEpub(w http.ResponseWriter, r *http.Request) {
	path, rel, ok := s.bookAt(r, ".epub")
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "No such book."})
		return
	}
	i, err := strconv.Atoi(r.URL.Query().Get("i"))
	if err != nil {
		i = -1
	}
	// No chapter asked for means the whole reading order.
	read, err := books.ReadSpine(path)
	if i >= 0 && err == nil {
		read, err = books.ReadPart(path, rel, i)
	}
	// A book that cannot be opened at all is this server's problem to report;
	// a book that opens and turns out not to be one says so itself.
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, read)
}

// apiBookCover answers with the picture an EPUB names for itself.
func (s *Server) apiBookCover(w http.ResponseWriter, r *http.Request) {
	path, _, ok := s.bookAt(r, ".epub")
	if !ok {
		http.NotFound(w, r)
		return
	}
	raw, mime := books.Cover(path)
	if raw == nil {
		http.NotFound(w, r)
		return
	}
	sendFile(w, raw, mime, "")
}

// apiBookRes answers with a picture or stylesheet from inside a book, which is
// what a chapter's rewritten links ask for.
func (s *Server) apiBookRes(w http.ResponseWriter, r *http.Request) {
	path, _, ok := s.bookAt(r, "")
	inner := r.URL.Query().Get("p")
	if !ok || inner == "" {
		http.NotFound(w, r)
		return
	}
	raw, mime := books.Res(path, inner)
	if raw == nil {
		http.NotFound(w, r)
		return
	}
	sendFile(w, raw, mime, "")
}

// serveBookFile hands over the file itself, which is how a PDF gets drawn: the
// browser already has a reader, so nothing has to be shipped for one.
func (s *Server) serveBookFile(w http.ResponseWriter, r *http.Request, rel string) {
	path, _, err := books.At(s.hub.BooksDir(), rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	mime := "application/epub+zip"
	if strings.EqualFold(filepath.Ext(path), ".pdf") {
		mime = "application/pdf"
	}
	sendFile(w, raw, mime, disposition(filepath.Base(path)))
}

// bookAt is the book a request names, its path under the books folder, and
// whether it is there at all.
func (s *Server) bookAt(r *http.Request, want string) (string, string, bool) {
	path, rel, err := books.At(s.hub.BooksDir(), r.URL.Query().Get("f"))
	if err != nil {
		return "", "", false
	}
	if want != "" && !strings.EqualFold(filepath.Ext(path), want) {
		return "", "", false
	}
	return path, rel, true
}

// serveFavicon is the app's own icon, which the browser asks for by itself.
func (s *Server) serveFavicon(w http.ResponseWriter, r *http.Request) {
	raw, err := os.ReadFile(filepath.Join(s.layout.Resource, "bin", "app.ico"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	sendFile(w, raw, "image/x-icon", "")
}

// ---- plumbing ----

func sendFile(w http.ResponseWriter, raw []byte, mime, disposition string) {
	h := w.Header()
	h.Set("Content-Type", mime)
	h.Set("Content-Length", fmt.Sprint(len(raw)))
	if disposition != "" {
		h.Set("Content-Disposition", disposition)
	}
	w.WriteHeader(http.StatusOK)
	w.Write(raw)
}

// disposition is `inline`, with a filename the header can actually carry.
//
// Headers go out as latin-1. A book called "My Teacher is a Martian：..." has
// a fullwidth colon in its name, and sending that name raised part way through
// the response in the Python app and dropped the connection, so the book could
// not be opened at all. A name latin-1 can hold goes exactly as it did;
// anything else goes the way RFC 5987 says, with a plain fallback beside it
// for whatever does not read that.
func disposition(name string) string {
	plain := []rune(name)
	simple := true
	for i, r := range plain {
		if r > 0xFF {
			simple = false
			plain[i] = '?'
		}
	}
	if simple {
		return `inline; filename="` + name + `"`
	}
	return `inline; filename="` + strings.ReplaceAll(string(plain), `"`, "") +
		`"; filename*=UTF-8''` + books.Quote(name)
}

func text(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case json.Number:
		return t.String()
	default:
		return fmt.Sprint(t)
	}
}

// truthy is Python's idea of a value worth acting on: not missing, not empty,
// not zero, not false.
func truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case string:
		return t != ""
	case float64:
		return t != 0
	default:
		return true
	}
}
