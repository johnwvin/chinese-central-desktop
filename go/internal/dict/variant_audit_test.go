package dict

import (
	"path/filepath"
	"reflect"
	"testing"
)

// Exercise the real query path for every spelling involved in a variant entry.
func TestAllVariantQueries(t *testing.T) {
	d := New(filepath.Join("..", "..", "..", "dict"))
	if !d.Load() {
		t.Fatal("dictionary unavailable")
	}
	queries := map[string][]int{}
	variants := 0
	for i, e := range d.entries {
		if !variantReference.MatchString(e.Defs) {
			continue
		}
		variants++
		queries[e.Simp] = append(queries[e.Simp], i)
		if e.Trad != e.Simp {
			queries[e.Trad] = append(queries[e.Trad], i)
		}
	}
	for q, expected := range queries {
		result := d.Query(q)
		rows := result["entries"].([]any)
		for _, i := range expected {
			found := false
			for _, row := range rows {
				if reflect.DeepEqual(row, d.entryRow(i)) {
					found = true
					break
				}
			}
			if !found {
				t.Errorf("%q omits variant entry %+v", q, d.entries[i])
			}
		}
		canonical := false
		for _, index := range append(append([]int{}, d.bySimp[q]...), d.byTrad[q]...) {
			if !variantOnly(d.entries[index]) {
				canonical = true
				break
			}
		}
		if canonical && len(rows) > 0 {
			first := rows[0].(map[string]any)
			defs := first["d"].([]string)
			onlyVariant := len(defs) > 0
			for _, def := range defs {
				if !variantReference.MatchString(def) {
					onlyVariant = false
				}
			}
			if onlyVariant {
				t.Errorf("%q defaults to a variant despite a full definition", q)
			}
		}
	}
	t.Logf("Audited %d variant entries through %d distinct spelling queries", variants, len(queries))
}
