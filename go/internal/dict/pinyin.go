package dict

import (
	"regexp"
	"strconv"
	"strings"
)

// CC-CEDICT writes pinyin with a tone digit -- du2 ti3 zi4 -- and the pages
// show real pinyin: dú tǐ zì. Which vowel carries the mark is the standard
// rule: an a or an e takes it; in "ou" the o does; otherwise the last vowel.

var toneMarks = map[rune][]rune{
	'a': []rune("āáǎà"),
	'e': []rune("ēéěè"),
	'i': []rune("īíǐì"),
	'o': []rune("ōóǒò"),
	'u': []rune("ūúǔù"),
	'ü': []rune("ǖǘǚǜ"),
}

var pyToken = regexp.MustCompile(`^([A-Za-zü]+)([1-5])$`)

// PyPretty turns one space-separated numbered reading into marked pinyin.
func PyPretty(p string) string {
	out := []string{}
	for _, tok := range strings.Fields(p) {
		tok = strings.ReplaceAll(tok, "u:", "ü")
		tok = strings.ReplaceAll(tok, "U:", "Ü")

		m := pyToken.FindStringSubmatch(tok)
		if m == nil {
			out = append(out, tok)
			continue
		}
		body := m[1]
		tone, _ := strconv.Atoi(m[2])
		if tone == 5 {
			// The neutral tone carries no mark.
			out = append(out, body)
			continue
		}
		out = append(out, mark(body, tone))
	}
	return strings.Join(out, " ")
}

// mark puts the tone on the right vowel of one syllable.
func mark(body string, tone int) string {
	runes := []rune(body)
	lower := []rune(strings.ToLower(body))

	at := -1
	if i := indexRune(lower, 'a'); i >= 0 {
		at = i
	} else if i := indexRune(lower, 'e'); i >= 0 {
		at = i
	} else if i := indexPair(lower, 'o', 'u'); i >= 0 {
		at = i
	} else {
		// The last vowel that can take a mark.
		for i := len(lower) - 1; i >= 0; i-- {
			if _, ok := toneMarks[lower[i]]; ok {
				at = i
				break
			}
		}
	}
	if at < 0 {
		return body
	}
	marks, ok := toneMarks[lower[at]]
	if !ok || tone-1 >= len(marks) {
		return body
	}
	runes[at] = marks[tone-1]
	return string(runes)
}

func indexRune(runes []rune, want rune) int {
	for i, r := range runes {
		if r == want {
			return i
		}
	}
	return -1
}

// indexPair finds the first of two runes that sit next to each other, and
// answers where the first one is.
func indexPair(runes []rune, first, second rune) int {
	for i := 0; i+1 < len(runes); i++ {
		if runes[i] == first && runes[i+1] == second {
			return i
		}
	}
	return -1
}

// Definition bodies carry CC-CEDICT's numbered cross-references -- "variant of
// X[jiong3]" -- so those become real pinyin too.
//
// WHATEVER SHAPE THE BRACKET IS. This used to match a bracket of spaced
// syllables and nothing else. That is most of them, and it left 263 readings
// in this edition printed as they came, digits and all, because something
// else was in the bracket: a proverb is two clauses with a comma between them
// ([you4 yao4 ma3 r5 pao3 , you4 yao4 ma3 r5 bu4 chi1 cao3]), a foreign name
// is joined with a middle dot ([Ru2 le4 · Fan2 er3 na4]), some readings are
// run together ([shang4zai4], [yi1mo2-yi1yang4]), some carry a letter that is
// not pinyin ([B xing2 chao1 sheng1]), and the ü sometimes arrives with its
// colon spaced out ([Lu : 3 liang2 Shi4]).
//
// So the bracket is not matched as a shape. Every run in it that is a
// numbered syllable is marked where it stands, and the bracket is rewritten
// only if no digit is left over afterwards -- which is what keeps a bracket
// that is not a reading at all from being half turned into one.
var pyBracket = regexp.MustCompile(`\[[^\[\]]*[1-5][^\[\]]*\]`)

// A run of letters, with the colon of a u: and a tone digit if it has them.
// Greedy, so a run is always taken whole: "CO2" is one run, and not a
// syllable, rather than a C followed by the syllable "O2".
var pyRun = regexp.MustCompile(`[A-Za-zü]+(?::[A-Za-zü]*)?[1-5]?`)

// A run that is one numbered syllable: a capital at the front at most.
var pySyllable = regexp.MustCompile(`^[A-Za-zü][a-zü]*(?::[a-zü]*)?[1-5]$`)

// The ü with its colon spaced out. Only after l and n, the two initials a ü
// follows, so a colon that is punctuation stays where it is.
var pySpacedU = regexp.MustCompile(`\b([LlNn]u) : ?(e?[1-5])`)

// prettyBracket is what is inside one bracket with its tones marked, and
// false when what is in there is not a reading.
func prettyBracket(body string) (string, bool) {
	body = pySpacedU.ReplaceAllString(body, "${1}:${2}")
	out := pyRun.ReplaceAllStringFunc(body, func(run string) string {
		if !pySyllable.MatchString(run) {
			return run
		}
		return PyPretty(run)
	})
	return out, !strings.ContainsAny(out, "0123456789")
}

func defsPretty(defs []string) []string {
	out := make([]string, 0, len(defs))
	for _, d := range defs {
		out = append(out, pyBracket.ReplaceAllStringFunc(d, func(m string) string {
			if pretty, ok := prettyBracket(m[1 : len(m)-1]); ok {
				return "[" + pretty + "]"
			}
			return m
		}))
	}
	return out
}
