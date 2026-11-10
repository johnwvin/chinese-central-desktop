package dict

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The real dictionary, when it is here. These are questions about the actual
// data -- which word 车 is standing in, and what that word is called -- so a
// made-up fixture would only be testing itself.
func realDict(t *testing.T) *Dict {
	t.Helper()
	dir := filepath.Join("..", "..", "..", "dict")
	if _, err := os.Stat(filepath.Join(dir, "cedict.tsv")); err != nil {
		t.Skip("no dictionary data beside the checkout")
	}
	d := New(dir)
	d.Load()
	return d
}

func TestReadingInTellsTheCarFromTheChariot(t *testing.T) {
	d := realDict(t)
	for _, c := range []struct {
		sentence, q, want string
	}{
		{"火车6点出发。", "车", "chē"}, // 火车, one word, huǒ chē
		{"叫救护车。", "车", "chē"},   // 救护车, jiù hù chē
		{"出租车到了。", "车", "chē"},  // 出租车
		{"舍车保帅", "车", "jū"},     // shě jū bǎo shuài -- the chess one
		{"我有一辆车。", "车", ""},     // a bare 车: all three readings at once
	} {
		got := d.readingIn(c.sentence, c.q)
		if !SameReading(got, c.want) {
			t.Errorf("%q: wanted %q, got %q", c.sentence, c.want, got)
		}
	}
}

func TestSameReadingIgnoresCaseAndSpacing(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{
		{"chē", "Chē", true},
		{"huǒ chē", "huǒchē", true},
		{"chē", "jū", false},
		{"chē", "che", false}, // the marks are the reading
	} {
		if got := SameReading(c.a, c.b); got != c.want {
			t.Errorf("SameReading(%q,%q) = %v, wanted %v", c.a, c.b, got, c.want)
		}
	}
}

// NOT ONE CHARACTER, A RULE.
//
// 车 is where this was noticed, and nothing about the fix is 车's: a sentence
// is read through whatever word it is standing in, for any word. So the
// property is checked across the characters that actually have this problem
// -- every reading handed out is one the word really has, or an honest blank.
func TestNoExampleIsGivenAReadingTheWordHasNot(t *testing.T) {
	d := realDict(t)
	// Characters read more than one way, which are the only ones that can be
	// filed under the wrong meaning.
	for _, q := range []string{
		"车", "了", "行", "长", "重", "乐", "好", "教", "还", "和",
		"得", "差", "着", "为", "地", "都", "少", "假", "空", "血",
	} {
		ex := d.examples(q, "")
		if len(ex) == 0 {
			continue
		}
		// Every reading this word is allowed to have.
		mine := []string{}
		for _, i := range d.bySimp[q] {
			mine = append(mine, PyPretty(d.entries[i].Pinyin))
		}
		split := map[string]int{}
		for _, row := range ex {
			got, ok := row.([]string)
			if !ok || len(got) != 3 {
				t.Fatalf("%s: an example is sentence, translation and reading: %#v", q, row)
			}
			split[got[2]]++
			if got[2] == "" {
				continue
			}
			ours := false
			for _, r := range mine {
				// Toneless, because a neutral tone is a real answer that no
				// entry lists: CC-CEDICT writes 暖和 nuan3 huo5, and tone 5
				// carries no mark, so the 和 in it comes out "huo" while the
				// entries offer huó and huò. Which of the two it is reduced
				// from is not in the data, so nothing is claimed -- a
				// sentence like that matches no reading and shows under
				// none, which is the conservative half of the point. What
				// this is guarding against is a reading belonging to a
				// different character altogether, and that is a difference
				// in the letters.
				if toneless(got[2]) == toneless(r) {
					ours = true
				}
			}
			if !ours {
				t.Errorf("%s: %q was given the reading %q, which %s does not have (it has %v)",
					q, got[0], got[2], q, mine)
			}
		}
		t.Logf("%s (%v): %v", q, mine, split)
	}
}

// toneless is a reading with its marks taken off, for the one comparison that
// wants to ignore them. Nothing in the app compares readings this way -- there
// the marks are the reading, or hǎo and hào would be the same word.
func toneless(s string) string {
	marks := map[rune]rune{
		'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
		'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e',
		'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
		'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
		'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
		'ǖ': 'v', 'ǘ': 'v', 'ǚ': 'v', 'ǜ': 'v', 'ü': 'v',
	}
	out := []rune{}
	for _, r := range strings.ToLower(s) {
		if r == ' ' {
			continue
		}
		if m, ok := marks[r]; ok {
			r = m
		}
		out = append(out, r)
	}
	return string(out)
}
