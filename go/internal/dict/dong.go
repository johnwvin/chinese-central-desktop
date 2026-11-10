package dict

import (
	"encoding/json"
	"os"
	"path/filepath"
	"unicode"
)

// dongRecord holds the small, offline subset of Dong Chinese's character dump.
// Formation notes and component roles are used only when the source marks the
// entry as manually verified.
type dongRecord struct {
	Character  string          `json:"ch"`
	Gloss      string          `json:"gloss"`
	Pinyin     string          `json:"py"`
	Hint       string          `json:"hint"`
	Components []dongComponent `json:"components"`
	Verified   bool            `json:"verified"`
}

type dongComponent struct {
	Character string   `json:"ch"`
	Roles     []string `json:"roles"`
	Hint      string   `json:"hint"`
}

func (d *Dict) loadDong() {
	raw, err := os.ReadFile(filepath.Join(d.dir, "dong.jsonl"))
	if err != nil {
		return
	}
	for _, line := range splitLines(raw) {
		var record dongRecord
		if json.Unmarshal([]byte(line), &record) != nil || record.Character == "" {
			continue
		}
		if previous := d.dong[record.Character]; previous != nil && previous.Verified && !record.Verified {
			continue
		}
		copied := record
		d.dong[record.Character] = &copied
	}
}

// Keep every named character component in the existing decomposition. An
// alternate etymology is used only when it has no character parts to show.
func hasCharacterPart(decomposition string) bool {
	for _, c := range decomposition {
		if unicode.Is(unicode.Han, c) {
			return true
		}
	}
	return false
}
