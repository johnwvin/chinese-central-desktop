package hub

import (
	"path/filepath"
	"testing"

	"chinese-central/internal/paths"
	"chinese-central/internal/prefs"
)

func newHub(t *testing.T) Hub {
	t.Helper()
	dir := t.TempDir()
	return NewHub(paths.Layout{Resource: dir, Data: dir}, prefs.File{Path: filepath.Join(dir, "your-settings.json")})
}
