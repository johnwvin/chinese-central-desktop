package hub

// The dictionary's favourites: words starred from their own page, kept with
// the rest of what the app writes.
//
// A favourite is a word AT A READING. 行 is háng and xíng, and starring the
// one you were reading must not star the other -- so the reading is half of
// what makes two favourites the same one, and the page links back to it.

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Favorite is one starred word: its spellings, the reading it was starred at,
// what it means, and when. The meaning is kept rather than looked up again so
// the list reads without a dictionary lookup per row.
type Favorite struct {
	S  string `json:"s"`
	T  string `json:"t"`
	P  string `json:"p"`
	D  string `json:"d"`
	At string `json:"at"`
}

// ErrNoWord refuses a favourite with no word in it.
var ErrNoWord = errors.New("there is no word to star")

// One writer at a time: two stars landing together must not lose one.
var favoritesMu sync.Mutex

func (h Hub) favoritesPath() string {
	return filepath.Join(h.Layout.Data, "favorites.json")
}

// favoriteKey is what makes two favourites the same one. The reading is
// compared without its spacing, which is how it is written and not what it
// says.
func favoriteKey(s, p string) string {
	return s + "\x00" + strings.ToLower(strings.Join(strings.Fields(p), ""))
}

// Favorites is every starred word, most recently starred first.
func (h Hub) Favorites() []Favorite {
	out := []Favorite{}
	raw, err := os.ReadFile(h.favoritesPath())
	if err != nil {
		return out
	}
	var list []Favorite
	if json.Unmarshal(raw, &list) != nil {
		return out
	}
	for _, f := range list {
		if f.S != "" {
			out = append(out, f)
		}
	}
	return out
}

// SetFavorite stars a word (on) or takes its star off, and answers with the
// list as it now stands. Starring a word that already has one keeps the date
// it was first starred: nothing was added.
func (h Hub) SetFavorite(f Favorite, on bool) ([]Favorite, error) {
	f.S = strings.TrimSpace(f.S)
	f.T = strings.TrimSpace(f.T)
	f.P = strings.TrimSpace(f.P)
	if f.S == "" || runeLen(f.S) > 60 {
		return nil, ErrNoWord
	}
	if d := []rune(f.D); len(d) > 1000 {
		f.D = string(d[:1000])
	}

	favoritesMu.Lock()
	defer favoritesMu.Unlock()

	key := favoriteKey(f.S, f.P)
	list := h.Favorites()
	kept := make([]Favorite, 0, len(list)+1)
	already := false
	for _, x := range list {
		if favoriteKey(x.S, x.P) == key {
			if on {
				already = true
				kept = append(kept, x)
			}
			continue
		}
		kept = append(kept, x)
	}
	if on && !already {
		f.At = time.Now().Format("2006-01-02T15:04:05")
		kept = append([]Favorite{f}, kept...)
	}

	if err := os.MkdirAll(h.Layout.Data, 0o755); err != nil {
		return nil, err
	}
	raw, err := marshalPlain(kept)
	if err != nil {
		return nil, err
	}
	path := h.favoritesPath()
	if err := writeAtomic(path, path+".tmp", raw); err != nil {
		return nil, err
	}
	return kept, nil
}
