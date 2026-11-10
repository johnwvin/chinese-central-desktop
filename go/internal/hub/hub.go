package hub

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"chinese-central/internal/books"
	"chinese-central/internal/paths"
	"chinese-central/internal/prefs"
)

// Hub is what the small reads need: where things are, and the settings file
// that says where the notebook and books folders are set.
type Hub struct {
	Layout paths.Layout
	Prefs  prefs.File

	// One writer at a time for the recent-searches ring: two lookups landing
	// together used to lose one of them.
	recentMu *sync.Mutex
}

// NewHub makes a hub with its own lock.
func NewHub(layout paths.Layout, settings prefs.File) Hub {
	return Hub{Layout: layout, Prefs: settings, recentMu: &sync.Mutex{}}
}

type Note struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Body   string `json:"body"`
	At     string `json:"at"`
	Folder string `json:"folder,omitempty"`
}

// NotesDir is where the notebook lives: beside the app's other settings unless
// pointed elsewhere, the way a library sits wherever you point it.
func (h Hub) NotesDir() string {
	if want := h.prefString("notesDir"); want != "" && isDir(want) {
		return want
	}
	return h.Layout.Data
}

func (h Hub) NotesPath() string { return filepath.Join(h.NotesDir(), "notes.json") }

// Notes is every note, newest edit first. A bad or missing file reads empty
// rather than failing: a notebook that cannot be opened is worse than an empty
// one.
func (h Hub) Notes() []Note {
	out := []Note{}
	raw, err := os.ReadFile(h.NotesPath())
	if err != nil {
		return out
	}
	// The file is {"notes": [...]}, but an older one is the bare list.
	var wrapper struct {
		Notes   []map[string]any `json:"notes"`
		Folders []string         `json:"folders"`
	}
	var list []map[string]any
	if json.Unmarshal(raw, &wrapper) == nil && wrapper.Notes != nil {
		list = wrapper.Notes
	} else if json.Unmarshal(raw, &list) != nil {
		return out
	}
	for _, n := range list {
		out = append(out, Note{
			ID:     asString(n["id"]),
			Title:  asString(n["title"]),
			Body:   asString(n["body"]),
			At:     asString(n["at"]),
			Folder: asString(n["folder"]),
		})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At > out[j].At })
	return out
}

// NoteFolders lists the named notebook folders stored beside notes.json.
func (h Hub) NoteFolders() []string {
	raw, err := os.ReadFile(h.NotesPath())
	if err != nil {
		return []string{}
	}
	var book struct {
		Folders []string `json:"folders"`
	}
	if json.Unmarshal(raw, &book) != nil || book.Folders == nil {
		return []string{}
	}
	return book.Folders
}

// ---- books ----

// Book is one PDF or EPUB under the books folder.
type Book struct {
	Rel    string `json:"rel"`
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Size   int64  `json:"size"`
	Folder string `json:"folder"`
}

var bookKinds = map[string]string{".pdf": "pdf", ".epub": "epub"}

// BooksDir is where your PDFs and EPUBs are -- somewhere you already keep
// them, usually; nothing is copied in.
func (h Hub) BooksDir() string {
	if want := h.prefString("booksDir"); want != "" && isDir(want) {
		return want
	}
	return filepath.Join(h.Layout.Data, "books")
}

// Books is every book under the folder, sorted, with its path relative to it
// so nothing outside can be named.
func (h Hub) Books() []Book {
	root := h.BooksDir()
	out := []Book{}
	if !isDir(root) {
		return out
	}
	filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		kind, ok := bookKinds[strings.ToLower(filepath.Ext(p))]
		if !ok {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		// A book sitting straight in the folder has "." for its folder, not
		// "": that is what Python's relative_to gives, the books page groups
		// on it, and the two must agree.
		folder, err := filepath.Rel(root, filepath.Dir(p))
		if err != nil {
			return nil
		}
		name := strings.TrimSuffix(filepath.Base(p), filepath.Ext(p))
		out = append(out, Book{
			Rel:    filepath.ToSlash(rel),
			Name:   name,
			Kind:   kind,
			Size:   info.Size(),
			Folder: filepath.ToSlash(folder),
		})
		return nil
	})
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Folder != out[j].Folder {
			return out[i].Folder < out[j].Folder
		}
		return strings.ToLower(out[i].Name) < strings.ToLower(out[j].Name)
	})
	return out
}

// MoveBook moves a book on disk into another folder under the books folder,
// making that folder if it is not there yet. Books() reads the shelf a book
// sits on straight off the folder it is actually in, so grouping books here
// only means something if this is a real move on disk -- a label pasted over
// the file where it already sat would just be a shelf that lied.
func (h Hub) MoveBook(rel, folder string) (Book, error) {
	root := h.BooksDir()
	src, _, err := books.At(root, rel)
	if err != nil {
		return Book{}, errors.New("No such book.")
	}
	top, err := filepath.Abs(root)
	if err != nil {
		return Book{}, err
	}

	folder = strings.Trim(filepath.ToSlash(strings.TrimSpace(folder)), "/")
	destDir := top
	if folder != "" && folder != "." {
		destDir, err = filepath.Abs(filepath.Join(top, filepath.FromSlash(folder)))
		under, relErr := filepath.Rel(top, destDir)
		if err != nil || relErr != nil || under == ".." || strings.HasPrefix(under, ".."+string(filepath.Separator)) {
			return Book{}, errors.New("Not a folder in your books folder.")
		}
	}
	if st, err := os.Stat(destDir); err == nil && !st.IsDir() {
		return Book{}, errors.New("That name is already a book, not a folder.")
	}
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return Book{}, fmt.Errorf("can't make that folder: %w", err)
	}

	dest := filepath.Join(destDir, filepath.Base(src))
	if dest != src {
		if _, err := os.Stat(dest); err == nil {
			return Book{}, errors.New("A book with that name is already in that folder.")
		}
		oldDir := filepath.Dir(src)
		if err := os.Rename(src, dest); err != nil {
			return Book{}, fmt.Errorf("could not move the book: %w", err)
		}
		// A folder is only worth having while something is on it: the last
		// book leaving one should not leave an empty folder standing where a
		// shelf used to be. Climbs the chain -- Novels/Wuxia empties into an
		// otherwise-empty Novels -- and stops at the books folder itself,
		// which this never removes, or at the first ancestor still holding
		// something else.
		removeEmptyChain(top, oldDir)
	}

	newRel, err := filepath.Rel(top, dest)
	if err != nil {
		return Book{}, err
	}
	newFolder, err := filepath.Rel(top, destDir)
	if err != nil {
		return Book{}, err
	}
	info, err := os.Stat(dest)
	if err != nil {
		return Book{}, err
	}
	return Book{
		Rel:    filepath.ToSlash(newRel),
		Name:   strings.TrimSuffix(filepath.Base(dest), filepath.Ext(dest)),
		Kind:   bookKinds[strings.ToLower(filepath.Ext(dest))],
		Size:   info.Size(),
		Folder: filepath.ToSlash(newFolder),
	}, nil
}

// removeEmptyChain removes dir and, in turn, each ancestor left empty by that
// removal, stopping at the first one that still holds something or at top --
// which is never itself removed, books folder or not. dir may already be
// outside top (nothing calls this with such a path today), in which case it
// does nothing rather than reach beyond where the books folder starts.
func removeEmptyChain(top, dir string) {
	for {
		if dir == top {
			return
		}
		rel, err := filepath.Rel(top, dir)
		if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return
		}
		entries, err := os.ReadDir(dir)
		if err != nil || len(entries) > 0 {
			return
		}
		if os.Remove(dir) != nil {
			return
		}
		dir = filepath.Dir(dir)
	}
}

// Recent is the dictionary's recent searches, newest first.
func (h Hub) Recent() []any {
	out := []any{}
	raw, err := os.ReadFile(filepath.Join(h.Layout.Data, "recent-searches.json"))
	if err != nil {
		return out
	}
	var list []any
	if json.Unmarshal(raw, &list) != nil {
		return out
	}
	return list
}

// RecentAdd puts a search at the front of the recent-searches ring, capped so
// it never balloons.
func (h Hub) RecentAdd(q string) {
	q = strings.TrimSpace(q)
	if q == "" || runeLen(q) > 60 {
		return
	}
	h.recentMu.Lock()
	defer h.recentMu.Unlock()

	list := h.Recent()
	kept := []any{q}
	for _, x := range list {
		if s, ok := x.(string); ok && s == q {
			continue
		}
		kept = append(kept, x)
		if len(kept) == 200 {
			break
		}
	}
	raw, err := json.Marshal(kept)
	if err != nil {
		return
	}
	path := filepath.Join(h.Layout.Data, "recent-searches.json")
	tmp := path + ".tmp"
	if os.WriteFile(tmp, raw, 0o644) == nil {
		if os.Rename(tmp, path) != nil {
			os.Remove(tmp)
		}
	}
}

func runeLen(s string) int { return len([]rune(s)) }

func (h Hub) prefString(key string) string {
	var into map[string]any
	if json.Unmarshal(h.Prefs.Read(), &into) != nil {
		return ""
	}
	return asString(into[key])
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}

func isFile(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

// BooksPathReport is what the books folder card shows.
type BooksPathReport struct {
	Path  string `json:"path"`
	Count int    `json:"count"`
	There bool   `json:"there"`
}

// SetBooksDir points the books page at another folder. Nothing is copied and
// nothing is made: this names somewhere your books already are.
func (h Hub) SetBooksDir(to string) (BooksPathReport, error) {
	dest := strings.TrimSpace(to)
	if dest == "" {
		return BooksPathReport{}, errors.New("No folder given.")
	}
	if !isDir(dest) {
		return BooksPathReport{}, errors.New("That folder is not there.")
	}
	if err := h.Prefs.Merge(objectOf("booksDir", dest)); err != nil {
		return BooksPathReport{}, err
	}
	return BooksPathReport{Path: h.BooksDir(), Count: len(h.Books()), There: true}, nil
}

// objectOf is a one-key JSON object, for merging a single setting.
func objectOf(key, value string) []byte {
	raw, _ := json.Marshal(map[string]string{key: value})
	return raw
}

// marshalPlain encodes without escaping <, > and & -- Python's
// ensure_ascii=False leaves them alone, and a note about "a > b" should read
// that way in the file too.
func marshalPlain(v any) ([]byte, error) {
	var b strings.Builder
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return []byte(strings.TrimSuffix(b.String(), "\n")), nil
}

// writeAtomic writes beside the file and moves it into place.
func writeAtomic(path, tmp string, raw []byte) error {
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}
