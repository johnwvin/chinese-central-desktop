package server

// Where each book was left, in the app's own settings file.
//
// The readers have always written this down, but only into the browser's
// localStorage -- which is the browser's, not yours. Set it to clear site data
// on close, open a different one, start a new profile, and every book is back
// at page one with nothing having gone wrong as far as the app is concerned.
// Everything else the app remembers about you lives in your-settings.json;
// this is the books joining it.
//
// ONE BOOK PER CALL, MERGED HERE. The obvious thing is for the page to post
// the whole map back, and it is wrong: this app has a tab strip and a split
// view, so two books can be open at once, each in a page holding its own copy
// of that map from whenever it loaded. Whichever saved last would put the
// other book back where IT thought you were. So a page sends the one book it
// is reading and the merging is done here, against the file as it stands.

import (
	"encoding/json"
	"net/http"
	"sync"
)

// One book's place. Every field is a pointer so that "not sent" and "sent as
// zero" are different things: a reader on page one of a book is at 0, and a
// reader that has nothing to say about the flow should not be taken to mean
// false.
type bookPlace struct {
	F     string          `json:"f"`
	At    *float64        `json:"at"`
	Off   *float64        `json:"off"`
	Of    *float64        `json:"of"`
	Page  *float64        `json:"page"`
	Pages *float64        `json:"pages"`
	Flow  *bool           `json:"flow"`
	Marks json.RawMessage `json:"marks"`
	T     *float64        `json:"t"`
}

// Read-modify-write on one file, so two tabs saving at the same moment do not
// each write what they read before the other did.
var placeMu sync.Mutex

func (s *Server) apiBookPlace(w http.ResponseWriter, r *http.Request) {
	var in bookPlace
	if err := decode(r, &in); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "not JSON"})
		return
	}
	if in.F == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "no book named"})
		return
	}

	placeMu.Lock()
	defer placeMu.Unlock()

	var whole map[string]json.RawMessage
	if err := json.Unmarshal(s.prefs.Read(), &whole); err != nil || whole == nil {
		whole = map[string]json.RawMessage{}
	}
	books := map[string]map[string]any{}
	if raw, ok := whole["books"]; ok {
		// A `books` that is not a map of books is not ours to keep.
		if err := json.Unmarshal(raw, &books); err != nil {
			books = map[string]map[string]any{}
		}
	}

	// What is already known about this one stands unless this call says
	// otherwise: a reader that only knows the page should not wipe the
	// chapter count somebody else worked out.
	one := books[in.F]
	if one == nil {
		one = map[string]any{}
	}
	if in.At != nil {
		one["at"] = *in.At
	}
	if in.Off != nil {
		one["off"] = *in.Off
	}
	if in.Of != nil {
		one["of"] = *in.Of
	}
	if in.Page != nil {
		one["page"] = *in.Page
	}
	if in.Pages != nil {
		one["pages"] = *in.Pages
	}
	if in.Flow != nil {
		one["flow"] = *in.Flow
	}
	if len(in.Marks) > 0 && string(in.Marks) != "null" {
		var marks []map[string]any
		if err := json.Unmarshal(in.Marks, &marks); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid bookmarks"})
			return
		}
		one["marks"] = marks
	}
	if in.T != nil {
		one["t"] = *in.T
	}
	books[in.F] = one

	patch, err := json.Marshal(map[string]any{"books": books})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	if err := s.prefs.Merge(patch); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
