package dict

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestHoverListsCompoundAndCharacterReadings(t *testing.T) {
	d := New(filepath.Join("..", "..", "..", "dict"))
	if !d.Load() {
		t.Skip("dictionary data unavailable")
	}
	first := d.Hover("衣柜", 0)["matches"].([]any)
	if len(first) < 2 || first[0].(map[string]any)["word"] != "衣柜" ||
		first[1].(map[string]any)["word"] != "衣" {
		t.Fatalf("hover on 衣 should list 衣柜 then 衣: %#v", first)
	}
	readings := first[1].(map[string]any)["entries"].([]any)
	if len(readings) < 2 {
		t.Fatalf("hover on 衣 should keep multiple readings: %#v", readings)
	}
	last := d.Hover("衣柜", 1)["matches"].([]any)
	if len(last) != 1 || last[0].(map[string]any)["word"] != "柜" {
		t.Fatalf("hover on 柜 should start at 柜: %#v", last)
	}
	compound := first[0].(map[string]any)["entries"].([]any)[0].(map[string]any)
	for _, meaning := range compound["d"].([]string) {
		if strings.Contains(meaning, "[ge4]") {
			t.Fatalf("popup still shows numbered classifier pinyin: %q", meaning)
		}
	}
}

// A one-character segment carries Unihan's reading even when it has entries,
// so nothing has to read a character off CC-CEDICT's first entry -- which for
// 说 is shuì, "to persuade".
func TestSegmentCarriesUnihanReading(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "dict")
	if _, err := os.Stat(filepath.Join(dir, "cedict.tsv")); err != nil {
		t.Skip("no dictionary data on this machine")
	}
	d := New(dir)
	if !d.Load() {
		t.Skip("dictionary would not load")
	}
	out := d.Query("他说")
	segs, _ := out["segments"].([]any)
	if len(segs) != 2 {
		t.Fatalf("want 2 segments, got %d", len(segs))
	}
	for _, s := range segs {
		m := s.(map[string]any)
		if m["w"] == "说" {
			if m["py"] != "shuō" {
				t.Fatalf("说 segment py = %q, want shuō", m["py"])
			}
			return
		}
	}
	t.Fatal("no 说 segment")
}

func TestCompoundDecompositionUsesWordReading(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "dict")
	if _, err := os.Stat(filepath.Join(dir, "cedict.tsv")); err != nil {
		t.Skip("no dictionary data on this machine")
	}
	d := New(dir)
	if !d.Load() {
		t.Fatal("dictionary would not load")
	}
	out := d.Query("宿舍")
	parts, ok := out["parts"].([]any)
	if !ok || len(parts) != 2 {
		t.Fatalf("want two decomposition parts, got %#v", out["parts"])
	}
	she := parts[1].(map[string]any)
	if she["py"] != "shè" {
		t.Fatalf("舍 should retain the word's shè reading, got %#v", she)
	}
	entries := she["entries"].([]any)
	var residence, abandon bool
	for _, item := range entries {
		row := item.(map[string]any)
		defs := strings.Join(row["d"].([]string), "; ")
		residence = residence || strings.Contains(defs, "residence")
		abandon = abandon || strings.Contains(defs, "abandon")
	}
	if !residence || !abandon {
		t.Fatalf("want all 舍 entries, got %#v", entries)
	}
}

func TestCompoundDecompositionKeepsWholeContextualEntry(t *testing.T) {
	d := New(filepath.Join("..", "..", "..", "dict"))
	if !d.Load() {
		t.Skip("dictionary data unavailable")
	}
	parts := d.Query("总经理")["parts"].([]any)
	if len(parts) != 3 {
		t.Fatalf("want three parts, got %#v", parts)
	}
	jing := parts[1].(map[string]any)
	entries := jing["entries"].([]any)
	var ordinary, surname bool
	for _, item := range entries {
		row := item.(map[string]any)
		defs := strings.Join(row["d"].([]string), "; ")
		ordinary = ordinary || strings.Contains(defs, "classics") && strings.Contains(defs, "longitude")
		surname = surname || strings.Contains(defs, "surname Jing")
	}
	if jing["py"] != "jīng" || !ordinary || !surname {
		t.Fatalf("want complete ordinary and surname entries, got %#v", jing)
	}
}

// A GLOSS FIELD IS OFTEN SEVERAL GLOSSES. This edition of CEDICT writes 会 as
// "can; to have the skill; to know how to/.../to meet; to get together/...",
// and keying the thesaurus on the whole field found the one other entry that
// bundles "to meet; to get together" the same way -- 聚头, and nothing else.
// Each gloss is keyed on its own now, so the ordinary synonyms are reachable.
func TestThesaurusSplitsBundledGlosses(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "dict")
	if _, err := os.Stat(filepath.Join(dir, "cedict.tsv")); err != nil {
		t.Skip("no dictionary data on this machine")
	}
	d := New(dir)
	if !d.Load() {
		t.Skip("dictionary would not load")
	}
	th, _ := d.Query("会")["thesaurus"].(map[string]any)
	similar, _ := th["similar"].([]any)
	if len(similar) < 20 {
		t.Fatalf("会 has %d similar words, want at least 20", len(similar))
	}

	at := map[string]int{}
	for i, row := range similar {
		if m, ok := row.(map[string]any); ok {
			if s, _ := m["s"].(string); s != "" {
				at[s] = i
			}
		}
	}
	for _, w := range []string{"聚头", "聚会", "会合"} {
		if _, ok := at[w]; !ok {
			t.Errorf("会 should reach %s", w)
		}
	}
	// "can" is the modal in 会 and the tin in 罐, and nothing in the data
	// tells them apart -- so the tin is outranked rather than excluded,
	// because excluding it would also lose 能, 可以 and 能够.
	if i, ok := at["罐"]; ok && i < 10 {
		t.Errorf("罐 (a tin) ranked %d for 会; should not be near the top", i)
	}
}

// A CHARACTER IS NOT ONE WORD. 会 is huì -- to know how to, to meet -- and it
// is also kuài, to reckon accounts. Their synonyms were being poured into one
// list with nothing to say which sense any row answered.
func TestThesaurusKeepsReadingsAndSensesApart(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "dict")
	if _, err := os.Stat(filepath.Join(dir, "cedict.tsv")); err != nil {
		t.Skip("no dictionary data on this machine")
	}
	d := New(dir)
	if !d.Load() {
		t.Skip("dictionary would not load")
	}

	byEntry, _ := d.Query("会")["thesaurus_by_entry"].([]any)
	if len(byEntry) < 2 {
		t.Fatalf("会 has %d readings in the thesaurus, want both huì and kuài", len(byEntry))
	}

	readings := map[string][]any{}
	for _, e := range byEntry {
		m := e.(map[string]any)
		py, _ := m["py"].(string)
		senses, _ := m["senses"].([]any)
		readings[py] = senses
	}
	if _, ok := readings["huì"]; !ok {
		t.Fatalf("no huì reading; got %v", readings)
	}

	// Each sense carries its own words, and a word answering one sense must
	// not be listed under another it has nothing to do with.
	where := map[string]string{}
	for _, s := range readings["huì"] {
		sm := s.(map[string]any)
		gloss, _ := sm["gloss"].(string)
		sim, _ := sm["similar"].([]any)
		if len(sim) == 0 {
			t.Errorf("sense %q kept with no words", gloss)
		}
		for _, r := range sim {
			if w, _ := r.(map[string]any)["s"].(string); w != "" {
				where[w] = gloss
			}
		}
	}
	// 聚头 means to meet; it has no business under "can" or "union; group".
	if g := where["聚头"]; !strings.Contains(g, "to meet") {
		t.Errorf("聚头 filed under %q, want the meeting sense", g)
	}
	// 可以 answers the modal, not the gathering.
	if g := where["可以"]; g != "" && !strings.Contains(g, "can") {
		t.Errorf("可以 filed under %q, want the \"can\" sense", g)
	}
}

func TestWiktionaryClassifiersUseExactHeadword(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "dict")
	if _, err := os.Stat(filepath.Join(dir, "wiktionary_classifiers.tsv")); err != nil {
		t.Skip("classifier supplement not present")
	}
	d := New(dir)
	if !d.Load() {
		t.Fatal("dictionary did not load")
	}
	entries, _ := d.Query("电扇")["thesaurus_by_entry"].([]any)
	if len(entries) == 0 {
		t.Fatal("电扇 entry missing")
	}
	entry := entries[0].(map[string]any)
	if source, _ := entry["measure_source"].(string); !strings.Contains(source, "zh") {
		t.Fatalf("classifier source = %q, want direct Wiktionary entry", source)
	}
	rows, _ := entry["measure"].([]any)
	got := map[string]bool{}
	for _, row := range rows {
		got[row.(map[string]any)["s"].(string)] = true
	}
	if !got["把"] || !got["台"] || got["架"] {
		t.Fatalf("电扇 classifiers = %v, want 把 and 台 only", got)
	}
	// The word's own CC-CEDICT classifiers retain priority over the supplement.
	direct, _ := d.Query("电风扇")["thesaurus_by_entry"].([]any)
	if source := direct[0].(map[string]any)["measure_source"]; source != "" {
		t.Errorf("direct classifier unexpectedly sourced from %v", source)
	}
}
