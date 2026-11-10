package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"chinese-central/internal/prefs"
)

// A settings file, and a server that has nothing but it: this handler reads
// and writes that one file and touches nothing else.
func placeServer(t *testing.T, start string) (*Server, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "your-settings.json")
	if start != "" {
		if err := os.WriteFile(path, []byte(start), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return &Server{prefs: prefs.File{Path: path}}, path
}

func savePlace(t *testing.T, s *Server, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/api/central/book-place", strings.NewReader(body))
	w := httptest.NewRecorder()
	s.apiBookPlace(w, r)
	return w
}

func booksIn(t *testing.T, path string) map[string]map[string]any {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("no settings file: %v", err)
	}
	var whole struct {
		Books map[string]map[string]any `json:"books"`
	}
	if err := json.Unmarshal(raw, &whole); err != nil {
		t.Fatalf("settings file is not JSON: %v\n%s", err, raw)
	}
	return whole.Books
}

func TestBookPlaceIsWrittenToTheSettingsFile(t *testing.T) {
	s, path := placeServer(t, `{"theme":"auto"}`)
	if w := savePlace(t, s, `{"f":"Novels/Wuxia.epub","at":7,"off":0.25,"of":30,"flow":true,"t":1700}`); w.Code != 200 {
		t.Fatalf("wanted 200, got %d: %s", w.Code, w.Body)
	}
	books := booksIn(t, path)
	one := books["Novels/Wuxia.epub"]
	if one == nil {
		t.Fatalf("the book was not written: %v", books)
	}
	if one["at"] != float64(7) || one["of"] != float64(30) || one["flow"] != true {
		t.Errorf("wrong place written: %v", one)
	}
	// And the settings that were already there are still there.
	raw, _ := os.ReadFile(path)
	if !strings.Contains(string(raw), `"theme"`) {
		t.Errorf("the rest of the settings went missing: %s", raw)
	}
}

// The whole reason the merging happens here: two books open at once, each in
// a page holding its own idea of where every book was.
func TestOneBookSavingDoesNotMoveAnother(t *testing.T) {
	s, path := placeServer(t, "")
	savePlace(t, s, `{"f":"a.epub","at":3,"t":1000}`)
	savePlace(t, s, `{"f":"b.pdf","at":40,"t":1001}`)
	savePlace(t, s, `{"f":"a.epub","at":9,"t":1002}`)

	books := booksIn(t, path)
	if books["a.epub"]["at"] != float64(9) {
		t.Errorf("a.epub should have moved on: %v", books["a.epub"])
	}
	if books["b.pdf"]["at"] != float64(40) {
		t.Errorf("b.pdf should not have moved: %v", books["b.pdf"])
	}
}

// A reader knows the page it is on; it does not always know how many there
// are. Saying nothing about a field must not erase it.
func TestSilenceLeavesAFieldAlone(t *testing.T) {
	s, path := placeServer(t, "")
	savePlace(t, s, `{"f":"a.epub","at":3,"of":30,"t":1000}`)
	savePlace(t, s, `{"f":"a.epub","at":4,"t":1001}`)

	one := booksIn(t, path)["a.epub"]
	if one["of"] != float64(30) {
		t.Errorf("the count was lost: %v", one)
	}
	if one["at"] != float64(4) {
		t.Errorf("the page did not move: %v", one)
	}
}

// Page one is a real answer, not a missing one.
func TestPageZeroIsKept(t *testing.T) {
	s, path := placeServer(t, "")
	savePlace(t, s, `{"f":"a.epub","at":5,"off":0.5,"t":1000}`)
	savePlace(t, s, `{"f":"a.epub","at":0,"off":0,"t":1001}`)

	one := booksIn(t, path)["a.epub"]
	if one["at"] != float64(0) || one["off"] != float64(0) {
		t.Errorf("going back to the start was not recorded: %v", one)
	}
}

func TestMultipleBookmarksAreKeptWithNamesAndPositions(t *testing.T) {
	s, path := placeServer(t, "")
	body := `{"f":"a.pdf","marks":[{"id":1,"at":7,"off":0.2,"name":"Example"},{"id":2,"at":12,"off":0.75,"name":""}],"t":1000}`
	if w := savePlace(t, s, body); w.Code != http.StatusOK {
		t.Fatalf("wanted 200, got %d: %s", w.Code, w.Body)
	}
	marks, ok := booksIn(t, path)["a.pdf"]["marks"].([]any)
	if !ok || len(marks) != 2 {
		t.Fatalf("bookmarks were not preserved: %#v", booksIn(t, path)["a.pdf"])
	}
	first := marks[0].(map[string]any)
	if first["name"] != "Example" || first["at"] != float64(7) || first["off"] != 0.2 {
		t.Errorf("named bookmark changed: %#v", first)
	}
}

func TestBookPlaceNeedsABook(t *testing.T) {
	s, _ := placeServer(t, "")
	if w := savePlace(t, s, `{"at":3}`); w.Code != http.StatusBadRequest {
		t.Errorf("wanted 400 for a place with no book, got %d", w.Code)
	}
	if w := savePlace(t, s, `not json`); w.Code != http.StatusBadRequest {
		t.Errorf("wanted 400 for a body that is not JSON, got %d", w.Code)
	}
}

// A `books` that is not a map of books -- hand-edited, or from something else
// entirely -- is replaced rather than allowed to stop this working.
func TestNonsenseInBooksIsNotFatal(t *testing.T) {
	s, path := placeServer(t, `{"books":"nonsense"}`)
	if w := savePlace(t, s, `{"f":"a.epub","at":3,"t":1000}`); w.Code != 200 {
		t.Fatalf("wanted 200, got %d: %s", w.Code, w.Body)
	}
	if booksIn(t, path)["a.epub"]["at"] != float64(3) {
		t.Errorf("the place was not written over the nonsense")
	}
}
