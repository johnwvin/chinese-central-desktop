package hub

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type NoteIn struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	Folder    string `json:"folder"`
	FolderSet bool   `json:"-"`
}

// SaveNote puts one note at the top of the notebook, replacing any note that
// already had its id. A note arriving without one is new and is given one.
func (h Hub) SaveNote(one NoteIn) ([]Note, error) {
	id := strings.TrimSpace(one.ID)
	if id == "" {
		id = "n" + randomHex(10)
	}
	folder := one.Folder
	if folder == "" && !one.FolderSet {
		for _, old := range h.Notes() {
			if old.ID == id {
				folder = old.Folder
				break
			}
		}
	}
	if folder != "" && !validNoteFolder(folder) {
		return nil, errors.New("That folder name is not valid.")
	}
	keep := Note{ID: id, Title: one.Title, Body: one.Body, Folder: folder,
		At: time.Now().Format("2006-01-02T15:04:05")}

	notes := []Note{keep}
	for _, n := range h.Notes() {
		if n.ID != id {
			notes = append(notes, n)
		}
	}
	if err := h.writeNotes(notes); err != nil {
		return nil, err
	}
	return h.Notes(), nil
}

// DeleteNote takes one note out of the notebook.
func (h Hub) DeleteNote(id string) ([]Note, error) {
	old := h.Notes()
	notes := []Note{}
	for _, n := range h.Notes() {
		if n.ID != id {
			notes = append(notes, n)
		}
	}
	if err := h.writeNotes(notes); err != nil {
		return nil, err
	}
	for _, n := range old {
		if n.ID == id {
			h.removeNoteFiles(n.ID)
			break
		}
	}
	return h.Notes(), nil
}

// DeleteNoteFolder removes a notebook folder while keeping its notes. Notes
// from the folder are moved to Unfiled and its directory is removed when empty.
func (h Hub) DeleteNoteFolder(name string) ([]Note, []string, error) {
	if !validNoteFolder(name) {
		return nil, nil, errors.New("That folder name is not valid.")
	}
	folders := h.NoteFolders()
	found := false
	keptFolders := make([]string, 0, len(folders))
	for _, folder := range folders {
		if folder == name {
			found = true
			continue
		}
		keptFolders = append(keptFolders, folder)
	}
	if !found {
		return nil, nil, errors.New("That folder does not exist.")
	}
	notes := h.Notes()
	for i := range notes {
		if notes[i].Folder == name {
			notes[i].Folder = ""
		}
	}
	if err := h.writeNotebook(notes, keptFolders); err != nil {
		return nil, nil, err
	}
	_ = os.Remove(filepath.Join(h.NotesDir(), "Notes", name))
	return h.Notes(), keptFolders, nil
}

// writeNotes saves the notebook to one side and moves it into place, so an
// interrupted save cannot leave half a notebook.
func (h Hub) writeNotes(notes []Note) error {
	return h.writeNotebook(notes, h.NoteFolders())
}

func (h Hub) writeNotebook(notes []Note, folders []string) error {
	here := h.NotesPath()
	if err := os.MkdirAll(filepath.Dir(here), 0o755); err != nil {
		return err
	}
	if notes == nil {
		notes = []Note{}
	}
	raw, err := marshalPlain(map[string]any{"notes": notes, "folders": folders})
	if err != nil {
		return err
	}
	if err := writeAtomic(here, strings.TrimSuffix(here, filepath.Ext(here))+".json.tmp", raw); err != nil {
		return err
	}
	noteRoot := filepath.Join(filepath.Dir(here), "Notes")
	if err := os.MkdirAll(filepath.Join(noteRoot, "Unfiled"), 0o755); err != nil {
		return err
	}
	for _, folder := range folders {
		if !validNoteFolder(folder) {
			continue
		}
		if err := os.MkdirAll(filepath.Join(noteRoot, folder), 0o755); err != nil {
			return err
		}
	}
	for _, n := range notes {
		if err := h.writeNoteFile(n, folders); err != nil {
			return err
		}
	}
	return nil
}

func validNoteFolder(name string) bool {
	if strings.TrimSpace(name) != name || name == "" || name == "." || name == ".." || strings.HasSuffix(name, ".") {
		return false
	}
	if strings.ContainsAny(name, `/\\<>:"|?*`) {
		return false
	}
	device := strings.ToUpper(strings.SplitN(name, ".", 2)[0])
	if device == "CON" || device == "PRN" || device == "AUX" || device == "NUL" {
		return false
	}
	if len(device) == 4 && (strings.HasPrefix(device, "COM") || strings.HasPrefix(device, "LPT")) && device[3] >= '1' && device[3] <= '9' {
		return false
	}
	return true
}

// AddNoteFolder creates both the notebook entry and its real directory.
func (h Hub) AddNoteFolder(name string) ([]string, error) {
	name = strings.TrimSpace(name)
	if !validNoteFolder(name) {
		return nil, errors.New("Use a folder name without slashes or Windows-reserved characters.")
	}
	folders := h.NoteFolders()
	for _, f := range folders {
		if f == name {
			return folders, nil
		}
	}
	folders = append(folders, name)
	if err := os.MkdirAll(filepath.Join(h.NotesDir(), "Notes", name), 0o755); err != nil {
		return nil, err
	}
	raw, err := marshalPlain(map[string]any{"notes": h.Notes(), "folders": folders})
	if err != nil {
		return nil, err
	}
	if err := writeAtomic(h.NotesPath(), strings.TrimSuffix(h.NotesPath(), filepath.Ext(h.NotesPath()))+".json.tmp", raw); err != nil {
		return nil, err
	}
	if err := h.writeNotes(h.Notes()); err != nil {
		return nil, err
	}
	return folders, nil
}

func (h Hub) removeNoteFiles(id string) {
	key := "Note -- " + filepath.Base(id) + " -- "
	noteRoot := filepath.Join(h.NotesDir(), "Notes")
	dirs := []string{filepath.Join(noteRoot, "Unfiled")}
	entries, err := os.ReadDir(noteRoot)
	if err == nil {
		for _, entry := range entries {
			if entry.IsDir() && validNoteFolder(entry.Name()) {
				dirs = append(dirs, filepath.Join(noteRoot, entry.Name()))
			}
		}
	}
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() && strings.HasPrefix(entry.Name(), key) && strings.HasSuffix(entry.Name(), ".md") {
				_ = os.Remove(filepath.Join(dir, entry.Name()))
			}
		}
		// Clean up the earlier app-managed mirror name when rewriting old notes.
		_ = os.Remove(filepath.Join(dir, ".cc-note-"+filepath.Base(id)+".md"))
	}
}

func (h Hub) writeNoteFile(n Note, folders []string) error {
	h.removeNoteFiles(n.ID)
	dir := filepath.Join(h.NotesDir(), "Notes", "Unfiled")
	if n.Folder != "" {
		if !validNoteFolder(n.Folder) {
			return errors.New("That folder name is not valid.")
		}
		dir = filepath.Join(h.NotesDir(), "Notes", n.Folder)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	content := "# " + n.Title + "\n\n" + n.Body + "\n"
	label := strings.Map(func(r rune) rune {
		if strings.ContainsRune(`<>:"/\\|?*`, r) || r < 32 {
			return '_'
		}
		return r
	}, strings.TrimSpace(n.Title))
	label = strings.TrimRight(label, ". ")
	if label == "" {
		label = "Untitled"
	}
	runes := []rune(label)
	if len(runes) > 90 {
		label = string(runes[:90])
	}
	path := filepath.Join(dir, "Note -- "+filepath.Base(n.ID)+" -- "+label+".md")
	return writeAtomic(path, path+".tmp", []byte(content))
}

// NotesPathReport is what the notebook's folder card shows.
type NotesPathReport struct {
	Path  string `json:"path"`
	Moved bool   `json:"moved,omitempty"`
	Count int    `json:"count"`
	Here  bool   `json:"here"`
}

// SetNotesDir points the notebook at another folder, optionally taking the
// notes there.
func (h Hub) SetNotesDir(to string, move bool) (NotesPathReport, error) {
	dest := strings.TrimSpace(to)
	if dest == "" {
		return NotesPathReport{}, errors.New("No folder given.")
	}
	if isFile(dest) {
		return NotesPathReport{}, errors.New("That is a file, not a folder.")
	}
	was := h.NotesPath()
	oldDir := filepath.Dir(was)
	oldFolders := h.NoteFolders()
	if err := os.MkdirAll(dest, 0o755); err != nil {
		return NotesPathReport{}, err
	}

	moved := false
	if move && isFile(was) {
		// Copy then remove, so a failure part way through leaves the notebook
		// where it already was.
		target := filepath.Join(dest, "notes.json")
		if resolved(target) != resolved(was) {
			raw, err := os.ReadFile(was)
			if err != nil {
				return NotesPathReport{}, err
			}
			if err := os.WriteFile(target, raw, 0o644); err != nil {
				return NotesPathReport{}, err
			}
			if err := os.Remove(was); err != nil {
				return NotesPathReport{}, err
			}
			moved = true
		}
	}
	if err := h.Prefs.Merge(objectOf("notesDir", dest)); err != nil {
		return NotesPathReport{}, err
	}
	if move {
		if err := h.writeNotes(h.Notes()); err != nil {
			return NotesPathReport{}, err
		}
		oldNoteRoot := filepath.Join(oldDir, "Notes")
		oldDirs := []string{filepath.Join(oldNoteRoot, "Unfiled")}
		for _, folder := range oldFolders {
			if validNoteFolder(folder) {
				oldDirs = append(oldDirs, filepath.Join(oldNoteRoot, folder))
			}
		}
		for _, dir := range oldDirs {
			entries, readErr := os.ReadDir(dir)
			if readErr != nil {
				continue
			}
			for _, n := range h.Notes() {
				prefix := "Note -- " + filepath.Base(n.ID) + " -- "
				for _, entry := range entries {
					if !entry.IsDir() && strings.HasPrefix(entry.Name(), prefix) && strings.HasSuffix(entry.Name(), ".md") {
						_ = os.Remove(filepath.Join(dir, entry.Name()))
					}
				}
				_ = os.Remove(filepath.Join(dir, ".cc-note-"+filepath.Base(n.ID)+".md"))
			}
		}
	}
	return NotesPathReport{Path: h.NotesDir(), Moved: moved,
		Count: len(h.Notes()), Here: isFile(h.NotesPath())}, nil
}

func resolved(p string) string {
	if real, err := filepath.EvalSymlinks(p); err == nil {
		return real
	}
	return p
}

func randomHex(n int) string {
	raw := make([]byte, (n+1)/2)
	if _, err := rand.Read(raw); err != nil {
		// Never in practice, and a note that cannot be told apart from
		// another is worse than one named after the clock.
		return fmt.Sprintf("%0*x", n, time.Now().UnixNano())[:n]
	}
	return hex.EncodeToString(raw)[:n]
}
