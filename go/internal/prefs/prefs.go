// Package prefs is the app's own settings file, your-settings.json.
//
// It holds the tab strip, the notebook and books folders, the theme, the
// script, the volume and the stroke speed. Both this and the Python app read
// and write it while the rewrite is under way, so the key order is kept as it
// was found: re-encoding through a Go map would sort the keys and make every
// save look like a rewrite of the whole file.
package prefs

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// File is one settings file on disk.
type File struct{ Path string }

// All requests sharing this file must finish their read/merge/write together.
var fileMu sync.Mutex

func validObject(raw []byte) bool {
	var object map[string]json.RawMessage
	return json.Unmarshal(raw, &object) == nil && object != nil
}

func (f File) readSaved() ([]byte, error) {
	var originalErr error
	for _, path := range []string{f.Path, f.Path + ".bak"} {
		raw, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err == nil && validObject(raw) {
			return raw, nil
		}
		if originalErr == nil {
			if err == nil {
				err = fmt.Errorf("saved settings are not a valid JSON object: %s", path)
			}
			originalErr = err
		}
	}
	if originalErr != nil {
		return nil, originalErr
	}
	return []byte("{}"), nil
}

func saveAtomic(path string, raw []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".settings-*")
	if err != nil {
		return err
	}
	name := file.Name()
	defer os.Remove(name)
	if _, err = file.Write(raw); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(name, path)
}

// Read answers a GET: the file as it stands, or an empty object if it is
// missing or unreadable.
func (f File) Read() []byte {
	fileMu.Lock()
	defer fileMu.Unlock()
	raw, err := f.readSaved()
	if err != nil {
		return []byte("{}")
	}
	return raw
}

// Merge folds the given object into the file, key by key, and writes it back.
// Keys already there keep their place; new ones go on the end.
func (f File) Merge(patch []byte) error {
	incoming, err := parse(patch)
	if err != nil {
		return err
	}
	fileMu.Lock()
	defer fileMu.Unlock()
	raw, err := f.readSaved()
	if err != nil {
		return err
	}
	current, err := parse(raw)
	if err != nil {
		return err
	}
	for _, kv := range incoming {
		replaced := false
		for i := range current {
			if current[i].Key == kv.Key {
				current[i].Value = kv.Value
				replaced = true
				break
			}
		}
		if !replaced {
			current = append(current, kv)
		}
	}

	if err := saveAtomic(f.Path+".bak", raw); err != nil {
		return err
	}
	return saveAtomic(f.Path, encode(current))
}

type pair struct {
	Key   string
	Value json.RawMessage
}

// parse reads a JSON object into its pairs, in the order they appear.
func parse(raw []byte) ([]pair, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	if d, ok := tok.(json.Delim); !ok || d != '{' {
		return nil, errNotObject
	}
	var out []pair
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		key, ok := keyTok.(string)
		if !ok {
			return nil, errNotObject
		}
		var value json.RawMessage
		if err := dec.Decode(&value); err != nil {
			return nil, err
		}
		out = append(out, pair{Key: key, Value: value})
	}
	return out, nil
}

// encode writes the pairs back out the way Python's json.dumps does with its
// default separators, so a file saved by either side looks the same.
func encode(pairs []pair) []byte {
	var b bytes.Buffer
	b.WriteByte('{')
	for i, kv := range pairs {
		if i > 0 {
			b.WriteString(", ")
		}
		key, _ := json.Marshal(kv.Key)
		b.Write(key)
		b.WriteString(": ")
		b.Write(kv.Value)
	}
	b.WriteByte('}')
	return b.Bytes()
}

var errNotObject = jsonError("expected an object")

type jsonError string

func (e jsonError) Error() string { return string(e) }
