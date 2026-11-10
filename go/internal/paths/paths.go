package paths

import "path/filepath"

type Layout struct{ Resource, Data string }

func (l Layout) DictDir() string { return filepath.Join(l.Resource, "dict") }
