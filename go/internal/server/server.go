package server

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"chinese-central/internal/dict"
	"chinese-central/internal/hub"
	"chinese-central/internal/paths"
	"chinese-central/internal/prefs"
	"chinese-central/web"
)

type Server struct {
	layout paths.Layout
	prefs  prefs.File
	hub    hub.Hub
	dict   *dict.Dict
}

func New(layout paths.Layout) *Server {
	settings := prefs.File{Path: filepath.Join(layout.Data, "your-settings.json")}
	words := dict.New(layout.DictDir())
	go words.Load()
	return &Server{layout: layout, prefs: settings, hub: hub.NewHub(layout, settings), dict: words}
}

func (s *Server) Handler() http.Handler { return http.HandlerFunc(s.route) }

func (s *Server) route(w http.ResponseWriter, r *http.Request) {
	host := r.Host
	if name, _, err := net.SplitHostPort(host); err == nil {
		host = name
	}
	if host != "127.0.0.1" && !strings.EqualFold(host, "localhost") {
		http.Error(w, "Local requests only", http.StatusForbidden)
		return
	}
	if r.Method == http.MethodPost {
		origin := r.Header.Get("Origin")
		if (origin != "" && origin != "http://"+r.Host) || r.Header.Get("Sec-Fetch-Site") == "cross-site" {
			http.Error(w, "Local requests only", http.StatusForbidden)
			return
		}
	}
	route := r.URL.Path
	switch {
	case strings.HasPrefix(route, "/api/central/"):
		s.serveCentral(w, r, strings.TrimPrefix(route, "/api/central/"))
	case r.Method != http.MethodGet && r.Method != http.MethodHead:
		w.WriteHeader(http.StatusMethodNotAllowed)
	case strings.HasPrefix(route, "/dictdata/"):
		s.serveDictionaryFile(w, r, strings.TrimPrefix(route, "/dictdata/"))
	case strings.HasPrefix(route, "/bookfile/"):
		s.serveBookFile(w, r, strings.TrimPrefix(route, "/bookfile/"))
	case route == "/favicon.ico":
		s.serveFavicon(w, r)
	case web.Owns(route):
		web.Handler().ServeHTTP(w, r)
	default:
		http.NotFound(w, r)
	}
}

func (s *Server) serveDictionaryFile(w http.ResponseWriter, r *http.Request, rel string) {
	if !filepath.IsLocal(rel) {
		http.NotFound(w, r)
		return
	}
	name := filepath.Join(s.layout.DictDir(), filepath.FromSlash(rel))
	if info, err := os.Stat(name); err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, name)
}

func (s *Server) serveCentral(w http.ResponseWriter, r *http.Request, name string) {
	w.Header().Set("Cache-Control", "no-store")
	switch {
	case name == "edition" && r.Method == http.MethodGet:
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(w, "chinese-central-vanilla")
	case name == "prefs" && r.Method == http.MethodGet:
		writeRaw(w, http.StatusOK, s.prefs.Read())
	case name == "dict" && r.Method == http.MethodGet:
		params := r.URL.Query()
		q := params.Get("q")
		// A full page load with ?q= is a real search -- the nav bars submit
		// here. In-page link clicks never reload, and never record.
		page, _ := strconv.Atoi(params.Get("page"))
		options := dict.SearchOptions{Mode: params.Get("mode"), Match: params.Get("match"), Strokes: params.Get("strokes"), Page: page}
		if params.Get("rec") == "1" {
			s.hub.RecentAdd(q, options.Mode, options.Match, options.Strokes)
		}
		writeJSON(w, http.StatusOK, s.dict.Search(q, options))
	case name == "hover" && r.Method == http.MethodGet:
		at, _ := strconv.Atoi(r.URL.Query().Get("at"))
		writeJSON(w, http.StatusOK, s.dict.Hover(r.URL.Query().Get("text"), at))
	case name == "pinyin" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"syl": s.dict.PinyinSyllables()})
	case name == "recent" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"list": s.hub.Recent()})
	case name == "favorites" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"list": s.hub.Favorites()})
	case name == "notes" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{"notes": s.hub.Notes(), "folders": s.hub.NoteFolders()})
	case name == "notespath" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{
			"path":  s.hub.NotesDir(),
			"count": len(s.hub.Notes()),
			"here":  fileExists(s.hub.NotesPath()),
		})
	case name == "books" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{
			"books": s.hub.Books(),
			"path":  s.hub.BooksDir(),
			"there": dirExists(s.hub.BooksDir()),
		})
	case name == "bookspath" && r.Method == http.MethodGet:
		writeJSON(w, http.StatusOK, map[string]any{
			"path":  s.hub.BooksDir(),
			"count": len(s.hub.Books()),
			"there": dirExists(s.hub.BooksDir()),
		})
	case name == "open-external" && r.Method == http.MethodPost:
		s.apiOpenExternal(w, r)
	case name == "epub" && r.Method == http.MethodGet:
		s.apiEpub(w, r)
	case name == "bookcover" && r.Method == http.MethodGet:
		s.apiBookCover(w, r)
	case name == "bookres" && r.Method == http.MethodGet:
		s.apiBookRes(w, r)
	case name == "notes" && r.Method == http.MethodPost:
		s.apiNotes(w, r)
	case name == "notespath" && r.Method == http.MethodPost:
		s.apiNotesPath(w, r)
	case name == "bookspath" && r.Method == http.MethodPost:
		s.apiBooksPath(w, r)
	case name == "books/move" && r.Method == http.MethodPost:
		s.apiBookMove(w, r)
	case name == "ranks" && r.Method == http.MethodGet:
		// No band asked for: the bands themselves. With one: what is in it.
		q := r.URL.Query()
		from, _ := strconv.Atoi(q.Get("from"))
		to, _ := strconv.Atoi(q.Get("to"))
		s.dict.Load()
		if from == 0 && to == 0 {
			writeJSON(w, http.StatusOK, map[string]any{"bands": s.dict.Bands()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"from": from, "to": to, "chars": s.dict.InBand(from, to)})
	case name == "book-place" && r.Method == http.MethodPost:
		s.apiBookPlace(w, r)
	case name == "hsk-study" && (r.Method == http.MethodGet || r.Method == http.MethodPost):
		s.apiHSKStudy(w, r)
	case name == "favorites" && r.Method == http.MethodPost:
		s.apiFavorites(w, r)
	case name == "prefs" && r.Method == http.MethodPost:
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4<<20))
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "could not read the body"})
			return
		}
		if err := s.prefs.Merge(body); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})

	default:
		http.NotFound(w, r)
	}
}
func decode(r *http.Request, into any) error {
	body, err := io.ReadAll(http.MaxBytesReader(nil, r.Body, 4<<20))
	if err != nil {
		return err
	}
	if len(body) == 0 {
		return nil
	}
	return json.Unmarshal(body, into)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	raw, err := json.Marshal(body)
	if err != nil {
		http.Error(w, "cannot encode the answer", http.StatusInternalServerError)
		return
	}
	writeRaw(w, status, raw)
}

func writeRaw(w http.ResponseWriter, status int, raw []byte) {
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Content-Length", fmt.Sprint(len(raw)))
	w.WriteHeader(status)
	w.Write(raw)
}

func fileExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func dirExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

// logging adds the headers every answer carries, and a line per request.
