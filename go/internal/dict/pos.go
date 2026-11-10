package dict

// Parts of speech, one reading at a time.
//
// A PART OF SPEECH BELONGS TO A READING, NOT TO A WORD. 好 is an adjective as
// hǎo and a verb as hào; 行 is a measure word as háng and a verb as xíng. The
// word lists that tag parts of speech give one answer per written word, so
// they cannot say which reading they meant. The dictionary's own entries can,
// in the places they say so: a classifier line means a noun, a meaning written
// "to walk" is a verb, "classifier for" is a measure word, "surname Zhong" is
// a surname, "aspect particle" and "interjection of surprise" say what they
// are. Those clues are read from each entry, and the word list fills in
// what the clues leave out -- but only where it cannot be pinned on the wrong
// reading.
//
// Three sources, best first:
//
//   - the entry's own clues, above;
//   - jieba's word list (jieba.tsv), which tags nearly every word with the full
//     set -- pronouns, conjunctions, particles and the rest;
//   - the Chinese Open Wordnet (pos.tsv), which knows only nouns, verbs,
//     adjectives and adverbs, for the words jieba cannot place.
//
// And where none of them can place a reading, the words that share its meaning
// usually agree on one: 美丽 is filed by jieba as a place name, but the other
// words that mean "beautiful" are adjectives.

import "strings"

// What jieba's tags mean, as the keys the page labels. A tag that is only a
// fragment of a word (zg, g, x) says nothing a reader can use and is left out.
var posFromJieba = map[string][]string{
	"n": {"noun"}, "ng": {"noun"}, "s": {"noun"}, "t": {"noun"}, "tg": {"noun"},
	"nr": {"name"}, "nrt": {"name"}, "nrfg": {"name"}, "nz": {"name"}, "nt": {"name"},
	"ns": {"place"},
	"v":  {"verb"}, "vg": {"verb"}, "vi": {"verb"}, "vq": {"verb"}, "vd": {"verb"},
	"vn": {"verb", "noun"},
	// b and z are the adjectives that cannot stand as a predicate and the
	// vivid reduplicated ones (高级, 绿油油). A learner's dictionary calls both
	// adjectives, and "distinguishing word" would tell nobody anything.
	"a": {"adjective"}, "ag": {"adjective"}, "ad": {"adjective"}, "b": {"adjective"}, "z": {"adjective"},
	"an": {"adjective", "noun"},
	"d":  {"adverb"}, "dg": {"adverb"}, "df": {"adverb"},
	"r": {"pronoun"}, "rr": {"pronoun"}, "rz": {"pronoun"}, "rg": {"pronoun"},
	"m": {"numeral"}, "mg": {"numeral"}, "mq": {"numeral", "measure"},
	"q": {"measure"},
	"p": {"preposition"},
	"c": {"conjunction"},
	"u": {"particle"}, "uj": {"particle"}, "ul": {"particle"}, "uv": {"particle"},
	"uz": {"particle"}, "ud": {"particle"}, "ug": {"particle"},
	"y": {"modal"}, "yg": {"modal"},
	"e": {"interjection"},
	"o": {"onomatopoeia"},
	"f": {"locative"},
	"i": {"idiom"},
	"l": {"phrase"},
	"j": {"abbreviation"},
	"h": {"prefix"},
	"k": {"suffix"},
}

// The keys that name something rather than describe a use of the language.
var properPOS = map[string]bool{"name": true, "place": true, "surname": true}

var posFromWordnet = map[rune]string{'n': "noun", 'v': "verb", 'a': "adjective", 'r': "adverb"}

// The labels CEDICT puts in front of a meaning that are a part of speech.
var posMarkers = map[string]string{
	"idiom": "idiom", "onom.": "onomatopoeia", "interj.": "interjection",
	"interjection": "interjection", "particle": "particle",
	"modal particle": "modal", "prefix": "prefix", "suffix": "suffix",
}

// The ways CEDICT describes a grammatical particle, in brackets or out:
// 着 "aspect particle indicating action in progress", 吗 "(question particle
// for yes-no questions)", 过 "(experienced action marker)". A list rather than
// any mention of "particle", or 粒子, "elementary particle", would be one.
var particlePhrases = []string{
	"aspect particle", "structural particle", "question particle",
	"sentence-final particle", "final particle", "possessive particle",
	"interrogative particle", "grammatical particle", "action marker",
}

// particleKey is what a piece of a meaning says if it names a particle or an
// interjection, or "".
func particleKey(s string) string {
	if strings.Contains(s, "modal particle") {
		return "modal"
	}
	for _, p := range particlePhrases {
		if strings.Contains(s, p) {
			return "particle"
		}
	}
	if strings.HasPrefix(s, "interjection") {
		return "interjection"
	}
	return ""
}

func withKey(keys []string, k string) []string {
	for _, have := range keys {
		if have == k {
			return keys
		}
	}
	return append(keys, k)
}

// grammatical is a part of speech said in the neutral tone: a particle, a
// modal particle, a suffix.
func grammatical(k string) bool {
	return k == "particle" || k == "modal" || k == "suffix"
}

// neutralTone says every syllable of a numbered reading is in the neutral
// tone: 的 de5, 着 zhe5.
func neutralTone(pinyin string) bool {
	syllables := strings.Fields(pinyin)
	if len(syllables) == 0 {
		return false
	}
	for _, s := range syllables {
		if !strings.HasSuffix(s, "5") {
			return false
		}
	}
	return true
}

// capitalised says a reading is a name: CEDICT writes proper nouns with a
// capital, Zhong1 the surname against zhong1 the middle.
func capitalised(pinyin string) bool {
	return pinyin != "" && pinyin[0] >= 'A' && pinyin[0] <= 'Z'
}

// entryClues is what one entry says about its own part of speech, and whether
// the entry is only a pointer to another ("see 道行[dao4 heng2]", "variant
// of ...") and so has no part of speech of its own to give.
func entryClues(defs string) (keys []string, pointer bool) {
	meanings, pointers := 0, 0
	for _, field := range strings.Split(defs, "/") {
		field = strings.TrimSpace(field)
		if field == "" {
			continue
		}
		low := strings.ToLower(field)
		// A classifier is only ever written for a noun.
		if strings.HasPrefix(low, "cl:") {
			keys = withKey(keys, "noun")
			continue
		}
		meanings++
		if isPointer(low) {
			pointers++
		}
		for _, part := range strings.Split(low, ";") {
			part = strings.TrimSpace(part)
			// "(bound form) to walk", "(idiom) ...": the labels in front are
			// read, and then set aside so the meaning after them is.
			for strings.HasPrefix(part, "(") {
				end := strings.Index(part, ")")
				if end < 0 {
					break
				}
				if k := posMarkers[part[1:end]]; k != "" {
					keys = withKey(keys, k)
				} else if k := particleKey(part[1:end]); k != "" {
					keys = withKey(keys, k)
				}
				part = strings.TrimSpace(part[end+1:])
			}
			if k := particleKey(part); k != "" {
				keys = withKey(keys, k)
			}
			switch {
			case strings.HasPrefix(part, "to "):
				keys = withKey(keys, "verb")
			case strings.HasPrefix(part, "classifier for"), strings.HasPrefix(part, "measure word for"):
				keys = withKey(keys, "measure")
			case strings.HasPrefix(part, "surname "):
				keys = withKey(keys, "surname")
			}
		}
	}
	return keys, meanings > 0 && pointers == meanings
}

// isPointer is a meaning that only sends you to another entry. "abbr. for" is
// not one: an abbreviation is a word in its own right.
func isPointer(low string) bool {
	if strings.HasPrefix(low, "abbr. for") {
		return false
	}
	if hasAnyPrefix(low, crossRefPrefixes) {
		return true
	}
	// "erhua variant of", "Japanese variant of", "archaic variant of".
	before, _, found := strings.Cut(low, " variant of ")
	return found && !strings.Contains(before, " ")
}

// wordPOS is what the word lists say about a written word as a whole, names
// left out: jieba first, the wordnet when jieba has nothing usable.
func (d *Dict) wordPOS(word string) []string {
	keys := []string{}
	for _, k := range posFromJieba[d.jieba[word]] {
		if !properPOS[k] {
			keys = withKey(keys, k)
		}
	}
	if len(keys) > 0 {
		return keys
	}
	for _, r := range d.pos[word] {
		if k := posFromWordnet[r]; k != "" {
			keys = withKey(keys, k)
		}
	}
	return keys
}

// posByEntry is the parts of speech of each shown entry, in order. `all` is
// every entry the lookup found, which is what decides whether a word-level
// answer can be given to one reading without being given to the wrong one.
func (d *Dict) posByEntry(shown, all []int) [][]string {
	// Per written word: how many real readings it has (not names, not
	// pointers), which parts of speech those readings claim for themselves,
	// and the readings a word-level answer could go to -- the first real one,
	// the first that says nothing of itself, and the first in the neutral
	// tone, each -1 where there is none.
	type group struct {
		claimed                       map[string]bool
		real, first, unclued, neutral int
	}
	groups := map[string]*group{}
	for _, i := range all {
		e := d.entries[i]
		g := groups[e.Simp]
		if g == nil {
			g = &group{claimed: map[string]bool{}, first: -1, unclued: -1, neutral: -1}
			groups[e.Simp] = g
		}
		keys, pointer := entryClues(e.Defs)
		if capitalised(e.Pinyin) || pointer {
			continue
		}
		g.real++
		for _, k := range keys {
			g.claimed[k] = true
		}
		if g.first < 0 {
			g.first = i
		}
		if g.unclued < 0 && len(keys) == 0 {
			g.unclued = i
		}
		if g.neutral < 0 && neutralTone(e.Pinyin) {
			g.neutral = i
		}
	}

	out := make([][]string, 0, len(shown))
	for _, i := range shown {
		e := d.entries[i]
		clues, pointer := entryClues(e.Defs)
		keys := []string{}
		switch {
		case capitalised(e.Pinyin):
			// A name takes what it says of itself, and from the word list
			// only what names a thing -- 中's surname is not a locative.
			keys = append(keys, clues...)
			for _, k := range posFromJieba[d.jieba[e.Simp]] {
				if properPOS[k] {
					keys = withKey(keys, k)
				}
			}
			if len(keys) == 0 {
				keys = append(keys, "name")
			}
		case pointer:
			keys = append(keys, clues...)
		default:
			word := d.wordPOS(e.Simp)
			g := groups[e.Simp]
			if g == nil || g.real <= 1 {
				// The only reading there is: whatever the word lists say is
				// about this one, and the entry's own clues add to it -- 在
				// is a preposition and also, by its entry, a verb.
				keys = append(keys, word...)
				for _, k := range clues {
					keys = withKey(keys, k)
				}
				break
			}
			// One of several readings. What it says of itself is its own.
			//
			// The word list's answer is about the word's commonest use, which
			// is one reading and not all of them -- 的 is a particle as de and
			// not as dí. So each part of speech it gives goes to one reading
			// only, and only if no reading has already claimed it: a particle
			// to the neutral-tone reading, since that is how particles are said
			// (着 zhe, not zhāo; and 吗 má, "what?", is not one at all); anything
			// else to the first reading that says nothing of itself (好's
			// adjective to hǎo, since hào says it is a verb), or failing that to
			// the first reading (长's adjective to cháng).
			keys = append(keys, clues...)
			for _, k := range word {
				particle := k == "particle" || k == "modal"
				if g.claimed[k] || (particle && (g.claimed["particle"] || g.claimed["modal"])) {
					continue
				}
				target := g.unclued
				if target < 0 {
					target = g.first
				}
				if grammatical(k) && g.neutral >= 0 {
					target = g.neutral
				}
				if i == target {
					keys = withKey(keys, k)
				}
			}
		}
		if len(keys) == 0 && !capitalised(e.Pinyin) && !pointer {
			keys = d.votePOS(i)
		}
		if keys == nil {
			keys = []string{}
		}
		out = append(out, keys)
	}
	return out
}

// votePOS is the part of speech the words sharing a reading's meaning agree
// on, when nothing else can place it: at least three of them, and two in three
// saying the same thing. A gloss half the dictionary shares ("to be") is no
// evidence and is skipped.
func (d *Dict) votePOS(i int) []string {
	counts := map[string]int{}
	voters := 0
	seen := map[int]bool{i: true}
	for _, field := range strings.Split(d.entries[i].Defs, "/") {
		for _, key := range glossKeys(field) {
			ids := d.byDef[key]
			if len(ids) > 200 {
				continue
			}
			for _, j := range ids {
				if seen[j] {
					continue
				}
				seen[j] = true
				other := d.entries[j]
				if capitalised(other.Pinyin) {
					continue
				}
				tags := d.wordPOS(other.Simp)
				if len(tags) != 1 {
					continue
				}
				counts[tags[0]]++
				voters++
			}
		}
	}
	best, most := "", 0
	for k, n := range counts {
		if n > most || (n == most && k < best) {
			best, most = k, n
		}
	}
	if voters >= 3 && most*3 >= voters*2 {
		return []string{best}
	}
	return nil
}
