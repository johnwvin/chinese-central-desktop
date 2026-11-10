package dict

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

// Every shape of reading CC-CEDICT puts in a definition's brackets comes out
// marked -- not only the spaced syllables the first version was written for.
func TestDefinitionReadingsAreMarkedWhateverTheirShape(t *testing.T) {
	cases := []struct{ in, want string }{
		{"variant of 冏[jiong3]", "variant of 冏[jiǒng]"},
		{
			"see 又要馬兒跑，又要馬兒不吃草|又要马儿跑，又要马儿不吃草[you4 yao4 ma3 r5 pao3 , you4 yao4 ma3 r5 bu4 chi1 cao3]",
			"see 又要馬兒跑，又要馬兒不吃草|又要马儿跑，又要马儿不吃草[yòu yào mǎ r pǎo , yòu yào mǎ r bù chī cǎo]",
		},
		{"[Ru2 le4 · Fan2 er3 na4]", "[Rú lè · Fán ěr nà]"},
		{"[shang4zai4]", "[shàngzài]"},
		{"[yi1mo2-yi1yang4]", "[yīmó-yīyàng]"},
		{"[B xing2 chao1 sheng1]", "[B xíng chāo shēng]"},
		{"[jiu3 jia4 HPV yi4 miao2]", "[jiǔ jià HPV yì miáo]"},
		{"[Lu : 3 liang2 Shi4]", "[Lǚ liáng Shì]"},
		{"[gong1 lu : 4 fang4 da4 qi4]", "[gōng lǜ fàng dà qì]"},
		{"[nu:e4 dai4]", "[nüè dài]"},
		// Not readings, and left exactly as they are.
		{"formula [CO2]", "formula [CO2]"},
		{"see note [3]", "see note [3]"},
	}
	for _, c := range cases {
		if got := defsPretty([]string{c.in})[0]; got != c.want {
			t.Errorf("%q\n got %q\nwant %q", c.in, got, c.want)
		}
	}
}

// Nothing in this edition's definitions is left with a numbered syllable in
// its brackets. The one above checks the shapes that were known; this is what
// finds the ones that were not.
func TestNoDefinitionKeepsANumberedReading(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "dict")
	if _, err := os.Stat(filepath.Join(dir, "cedict.tsv")); err != nil {
		t.Skip("no dictionary data on this machine")
	}
	d := New(dir)
	if !d.Load() {
		t.Skip("dictionary would not load")
	}
	numbered := regexp.MustCompile(`\[[^\[\]]*[A-Za-zü][1-5][^\[\]]*\]`)
	left := 0
	for i := range d.entries {
		for _, def := range d.defsOf(i) {
			if m := numbered.FindString(def); m != "" {
				if left < 10 {
					t.Errorf("%s: %s", d.entries[i].Simp, m)
				}
				left++
			}
		}
	}
	if left > 0 {
		t.Errorf("%d definitions still carry a numbered reading", left)
	}
}
