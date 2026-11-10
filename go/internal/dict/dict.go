// Package dict is the dictionary: CC-CEDICT, Unihan, the etymology notes, the
// example sentences and the frequency lists, loaded into memory and queried.
//
// This is a port of the dictionary half of server.py, and it answers in the
// same shape, checked against docs/rewrite/golden. Two things about Python had
// to be carried over rather than translated:
//
//   - Its dictionaries keep insertion order, and two places lean on it: the
//     prefix sweep over by_py stops after eighty hits, and the thesaurus's
//     ranking breaks ties in the order words were scored. A Go map is walked
//     in a different order every time, so those keep their own ordered lists.
//   - Its strings are indexed by character, not byte. Every index here is a
//     rune index for the same reason.
package dict

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"
)

// Entry is one CC-CEDICT line: simplified, traditional, numbered pinyin, and
// the definitions as one slash-separated string.
type Entry struct {
	Simp, Trad, Pinyin, Defs string
}

// mmah is one line of the etymology file.
type mmah struct {
	Character     string          `json:"character"`
	Definition    string          `json:"definition"`
	Pinyin        []string        `json:"pinyin"`
	Decomposition string          `json:"decomposition"`
	Radical       string          `json:"radical"`
	Etymology     json.RawMessage `json:"etymology"`

	// Pulled out of Etymology once, because the decomposition tree asks for
	// them on every character it walks.
	semantic, phonetic string
}

// Dict is the whole dictionary, loaded once and read from many requests.
type Dict struct {
	dir string

	mu     sync.RWMutex
	loaded bool

	entries         []Entry
	bySimp          map[string][]int
	byTrad          map[string][]int
	byPy            map[string][]int
	byPyKeys        []string // in the order they were first seen
	contains        map[string][]int
	byDef           map[string][]int
	classifiers     map[string]classifierSupplement
	unihan          map[string]map[string]string
	mmah            map[string]*mmah
	dong            map[string]*dongRecord
	componentSenses map[string]componentSense
	pos             map[string]string
	jieba           map[string]string
	ranks           map[string][]string
	sents           [][2]string

	pinyinOnce sync.Once
	pinyinSyl  map[string][]string

	// The rank list, ordered once. See ranks.go.
	rankOnce sync.Once
	rankList []string
}

type classifierSupplement struct {
	words   []string
	edition string
}

func New(dir string) *Dict { return &Dict{dir: dir} }

// SetDir points the dictionary at another folder and forgets what is loaded --
// a rebuild may have written a newer copy somewhere else.
//
// Forgetting puts the whole read back in front of the next lookup, which is
// the cost server.New goes out of its way to pay up front, so the reload is
// started here too rather than left for whoever asks first.
func (d *Dict) SetDir(dir string) {
	d.mu.Lock()
	d.dir, d.loaded = dir, false
	d.entries, d.sents = nil, nil
	d.pinyinSyl = nil
	d.pinyinOnce = sync.Once{}
	d.mu.Unlock()
	go d.Load()
}

// Load reads the data files. It answers false when there is no dictionary to
// read, which is what the Control page's Dictionary card is for.
func (d *Dict) Load() bool {
	d.mu.RLock()
	if d.loaded {
		d.mu.RUnlock()
		return true
	}
	d.mu.RUnlock()

	d.mu.Lock()
	defer d.mu.Unlock()
	if d.loaded {
		return true
	}

	cedict := filepath.Join(d.dir, "cedict.tsv")
	raw, err := os.ReadFile(cedict)
	if err != nil {
		return false
	}

	d.bySimp = map[string][]int{}
	d.byTrad = map[string][]int{}
	d.byPy = map[string][]int{}
	d.byPyKeys = nil
	d.contains = map[string][]int{}
	d.byDef = map[string][]int{}
	d.classifiers = map[string]classifierSupplement{}
	d.unihan = map[string]map[string]string{}
	d.mmah = map[string]*mmah{}
	d.dong = map[string]*dongRecord{}
	d.componentSenses = map[string]componentSense{}
	d.pos = map[string]string{}
	d.jieba = map[string]string{}
	d.ranks = map[string][]string{}
	d.entries = nil
	d.sents = nil

	for _, line := range splitLines(raw) {
		bits := strings.SplitN(line, "\t", 4)
		if len(bits) != 4 {
			continue
		}
		d.entries = append(d.entries, Entry{bits[0], bits[1], bits[2], bits[3]})
	}

	for i, e := range d.entries {
		d.bySimp[e.Simp] = append(d.bySimp[e.Simp], i)
		if e.Trad != e.Simp {
			d.byTrad[e.Trad] = append(d.byTrad[e.Trad], i)
		}
		key := PyNorm(e.Pinyin)
		if _, seen := d.byPy[key]; !seen {
			d.byPyKeys = append(d.byPyKeys, key)
		}
		d.byPy[key] = append(d.byPy[key], i)

		// Every character either spelling uses, once each.
		seen := map[rune]bool{}
		for _, ch := range e.Simp + e.Trad {
			if ch > 0x2E7F && !seen[ch] {
				seen[ch] = true
				s := string(ch)
				d.contains[s] = append(d.contains[s], i)
			}
		}
	}

	d.loadUnihan()
	d.loadTwoColumn("pos.tsv", func(word, rest string) {
		if word != "" && rest != "" {
			d.pos[word] = rest
		}
	})
	d.loadTwoColumn("jieba.tsv", func(word, rest string) {
		if word != "" && rest != "" {
			d.jieba[word] = rest
		}
	})
	d.loadRanks()
	d.loadMmah()
	d.loadDong()
	d.loadComponentSenses()
	d.loadSentences()
	d.loadClassifierSupplement()

	// Entries sharing a gloss read as synonyms.
	for i, e := range d.entries {
		had := map[string]bool{}
		for _, def := range strings.Split(e.Defs, "/") {
			for _, k := range glossKeys(def) {
				// Once per entry: a word that says "to meet" in two of its
				// senses is not twice the synonym of one that says it once.
				if !had[k] {
					had[k] = true
					d.byDef[k] = append(d.byDef[k], i)
				}
			}
		}
	}

	d.loaded = true
	return true
}

func (d *Dict) loadClassifierSupplement() {
	raw, err := os.ReadFile(filepath.Join(d.dir, "wiktionary_classifiers.tsv"))
	if err != nil {
		return
	}
	for _, line := range splitLines(raw) {
		fields := strings.Split(line, "\t")
		if len(fields) != 4 || fields[0] == "" || fields[1] == "" {
			continue
		}
		key := fields[0] + "\t" + fields[1]
		d.classifiers[key] = classifierSupplement{
			words: strings.Split(fields[2], ","), edition: fields[3],
		}
	}
}

func (d *Dict) loadUnihan() {
	raw, err := os.ReadFile(filepath.Join(d.dir, "unihan.tsv"))
	if err != nil {
		return
	}
	for _, line := range splitLines(raw) {
		bits := strings.Split(line, "\t")
		if len(bits) == 0 || runeLen(bits[0]) != 1 {
			continue
		}
		fields := map[string]string{}
		for _, kv := range bits[1:] {
			k, v, _ := strings.Cut(kv, "=")
			fields[k] = v
		}
		d.unihan[bits[0]] = fields
	}
}

func (d *Dict) loadTwoColumn(name string, take func(string, string)) {
	raw, err := os.ReadFile(filepath.Join(d.dir, name))
	if err != nil {
		return
	}
	for _, line := range splitLines(raw) {
		word, rest, _ := strings.Cut(line, "\t")
		take(word, rest)
	}
}

func (d *Dict) loadRanks() {
	raw, err := os.ReadFile(filepath.Join(d.dir, "ranks.tsv"))
	if err != nil {
		return
	}
	for _, line := range splitLines(raw) {
		bits := strings.Split(line, "\t")
		if len(bits) == 4 && runeLen(bits[0]) == 1 {
			d.ranks[bits[0]] = bits[1:]
		}
	}
}

func (d *Dict) loadMmah() {
	raw, err := os.ReadFile(filepath.Join(d.dir, "mmah.jsonl"))
	if err != nil {
		return
	}
	for _, line := range splitLines(raw) {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var m mmah
		if json.Unmarshal([]byte(line), &m) != nil || m.Character == "" {
			continue
		}
		if len(m.Etymology) > 0 {
			var ety struct {
				Semantic string `json:"semantic"`
				Phonetic string `json:"phonetic"`
			}
			if json.Unmarshal(m.Etymology, &ety) == nil {
				m.semantic, m.phonetic = ety.Semantic, ety.Phonetic
			}
		}
		copied := m
		d.mmah[m.Character] = &copied
	}
}

type componentSense struct {
	pinyin string
	gloss  string
}

func (d *Dict) loadComponentSenses() {
	raw, err := os.ReadFile(filepath.Join(d.dir, "component_senses.tsv"))
	if err != nil {
		return
	}
	for _, line := range splitLines(raw) {
		fields := strings.SplitN(line, "\t", 3)
		if len(fields) == 3 && runeLen(fields[0]) == 1 && fields[2] != "" {
			d.componentSenses[fields[0]] = componentSense{fields[1], fields[2]}
		}
	}
}

func (d *Dict) loadSentences() {
	raw, err := os.ReadFile(filepath.Join(d.dir, "sentences.tsv"))
	if err != nil {
		return
	}
	for _, line := range splitLines(raw) {
		zh, en, _ := strings.Cut(line, "\t")
		if zh != "" && en != "" {
			d.sents = append(d.sents, [2]string{zh, en})
		}
	}
}

// splitLines splits on newlines the way Python's splitlines does for these
// files, dropping the empty piece a trailing newline leaves behind.
func splitLines(raw []byte) []string {
	text := strings.ReplaceAll(string(raw), "\r\n", "\n")
	text = strings.TrimSuffix(text, "\n")
	if text == "" {
		return nil
	}
	return strings.Split(text, "\n")
}

func runeLen(s string) int { return len([]rune(s)) }

// PyNorm reduces pinyin to its letters, so "nǐ hǎo" and "ni3 hao3" and
// "NI3HAO3" all lead to the same place. "u:" and "v" both mean ü.
func PyNorm(p string) string {
	var b strings.Builder
	for _, ch := range strings.ToLower(p) {
		switch {
		case ch >= 'a' && ch <= 'z':
			b.WriteRune(ch)
		case ch == 'v':
			b.WriteRune('v')
		}
	}
	return b.String()
}

// ---- the query ----

// Hover lists every dictionary headword beginning at the hovered character,
// longest first, followed by each one-character reading. It deliberately
// avoids the full dictionary page's costly panels and examples.
func (d *Dict) Hover(text string, at int) map[string]any {
	if !d.Load() {
		return map[string]any{"matches": []any{}}
	}
	d.mu.RLock()
	defer d.mu.RUnlock()
	runes := []rune(text)
	if len(runes) > 16 {
		runes = runes[:16]
	}
	if at < 0 || at >= len(runes) {
		return map[string]any{"matches": []any{}}
	}
	matches := []any{}
	for n := min(8, len(runes)-at); n > 0; n-- {
		word := string(runes[at : at+n])
		ids := append([]int{}, d.bySimp[word]...)
		for _, id := range d.byTrad[word] {
			if !contains(ids, id) {
				ids = append(ids, id)
			}
		}
		if len(ids) > 0 {
			rows := []any{}
			for _, id := range head(ids, 8) {
				rows = append(rows, d.entryRow(id))
			}
			matches = append(matches, map[string]any{
				"word": word, "entries": rows,
			})
		}
	}
	return map[string]any{"matches": matches}
}

// Query answers one lookup, in the shape the dictionary page reads.
func (d *Dict) Query(q string) map[string]any {
	if !d.Load() {
		return map[string]any{
			"error": "The dictionary data hasn't been downloaded yet -- " +
				"use the Dictionary card on the Control page.",
		}
	}
	d.mu.RLock()
	defer d.mu.RUnlock()

	q = strings.TrimSpace(q)
	if q == "" {
		return map[string]any{
			"entries": []any{}, "total": len(d.entries), "sents": len(d.sents),
		}
	}

	out := map[string]any{
		"q": q, "entries": []any{}, "chars": []any{}, "words": []any{},
	}
	runes := []rune(q)
	isCJK := false
	cjkCount := 0
	for _, ch := range runes {
		if ch > 0x2E7F {
			isCJK = true
			cjkCount++
		}
	}

	// Dictionary symbols such as ○ can have variant entries too. An exact
	// symbol lookup must not be sent through the English/pinyin search.
	exactSymbol := (len(d.bySimp[q]) > 0 || len(d.byTrad[q]) > 0) && strings.ContainsFunc(q, unicode.IsSymbol)
	if !isCJK && !exactSymbol {
		out["entries"] = d.rowsFor(d.lookupLatin(q))
		return out
	}

	// The exact word, simplified first, then traditional spellings that are
	// not already among them.
	simpHits := d.bySimp[q]
	hits := append([]int{}, simpHits...)
	for _, i := range d.byTrad[q] {
		if !contains(simpHits, i) {
			hits = append(hits, i)
		}
	}
	// A spelling cross-reference must not become the default character card
	// merely because it comes first in the source file.
	sort.SliceStable(hits, func(i, j int) bool {
		return !variantOnly(d.entries[hits[i]]) && variantOnly(d.entries[hits[j]])
	})
	out["entries"] = d.rowsFor(head(hits, 30))

	if len(hits) == 0 && cjkCount > 1 {
		// Not a dictionary word: a search page, one result per word the text
		// contains (single characters when nothing longer).
		out["segments"] = d.segment(runes)
		return out
	}

	seenCh := []rune{}
	for _, ch := range runes {
		if ch > 0x2E7F && !containsRune(seenCh, ch) {
			seenCh = append(seenCh, ch)
		}
	}
	chars := []any{}
	for _, ch := range seenCh {
		chars = append(chars, d.charPanel(string(ch)))
	}
	out["chars"] = chars

	// Related words, the four ways: same head, same tail, the word buried
	// inside a longer phrase, and sound-alikes. Computed once over all
	// readings, and again per reading -- on the zhong4 page only zhong4 words
	// belong, so each word's pinyin is checked at the character's position.
	out["related"] = d.related(q, hits, "")
	byEntry := []any{}
	for _, i := range head(hits, 6) {
		byEntry = append(byEntry, d.related(q, hits, d.entries[i].Pinyin))
	}
	out["related_by_entry"] = byEntry

	alt := ""
	simp0 := q
	if len(hits) > 0 {
		if trad := d.entries[hits[0]].Trad; trad != q {
			alt = trad
		}
		simp0 = d.entries[hits[0]].Simp
	}
	pos := d.pos[simp0]
	if pos == "" {
		pos = d.pos[q]
	}
	if pos == "" && alt != "" {
		pos = d.pos[alt]
	}
	out["pos"] = pos
	// And for each reading, which is what the page shows -- see pos.go.
	out["pos_by_entry"] = d.posByEntry(head(hits, 30), hits)
	out["thesaurus"] = d.thesaurus(q, hits)
	out["thesaurus_by_entry"] = d.thesaurusByEntry(q, hits)
	out["examples"] = d.examples(q, alt)

	// Keep each compound's syllables, but show every character entry. The
	// dictionary has no explicit compound-to-character-sense mapping, so the
	// reader, not a heuristic, chooses the relevant entry.
	if cjkCount > 1 {
		byEntry := []any{}
		for _, i := range head(hits, 30) {
			byEntry = append(byEntry, d.wordParts(d.entries[i]))
		}
		out["parts_by_entry"] = byEntry
		if len(byEntry) > 0 {
			out["parts"] = byEntry[0]
		}
	}
	return out
}

// wordParts shows every complete single-character entry, including other
// readings, surnames and variants. Matching readings come first, but none are
// omitted or claimed to be the compound's sense.
func (d *Dict) wordParts(word Entry) []any {
	chars := []rune{}
	for _, ch := range word.Simp {
		if ch > 0x2E7F {
			chars = append(chars, ch)
		}
	}
	syllables := strings.Fields(word.Pinyin)
	if len(chars) != len(syllables) {
		return nil
	}
	parts := make([]any, 0, len(chars))
	for pos, ch := range chars {
		s := string(ch)
		reading := syllables[pos]
		seen := map[int]bool{}
		matched, other := []any{}, []any{}
		for _, i := range append(append([]int{}, d.bySimp[s]...), d.byTrad[s]...) {
			if seen[i] {
				continue
			}
			seen[i] = true
			entry := d.entries[i]
			if len([]rune(entry.Simp)) != 1 || len([]rune(entry.Trad)) != 1 {
				continue
			}
			if entry.Pinyin == reading {
				matched = append(matched, d.entryRow(i))
			} else {
				other = append(other, d.entryRow(i))
			}
		}
		parts = append(parts, map[string]any{"ch": s, "py": PyPretty(reading), "entries": append(matched, other...)})
	}
	return parts
}

// lookupLatin finds entries for pinyin or an English word: the exact reading
// first, then readings that start with it, then the definitions themselves.
func (d *Dict) lookupLatin(q string) []int {
	norm := PyNorm(q)
	hits := append([]int{}, d.byPy[norm]...)

	if len(hits) < 40 && norm != "" {
		for _, key := range d.byPyKeys {
			if strings.HasPrefix(key, norm) && key != norm {
				hits = append(hits, d.byPy[key]...)
				if len(hits) > 80 {
					break
				}
			}
		}
	}
	if len(hits) < 10 {
		low := strings.ToLower(q)
		for i, e := range d.entries {
			if strings.Contains(strings.ToLower(e.Defs), low) {
				hits = append(hits, i)
				if len(hits) > 80 {
					break
				}
			}
		}
	}

	seen := map[int]bool{}
	uniq := []int{}
	for _, i := range hits {
		if !seen[i] {
			seen[i] = true
			uniq = append(uniq, i)
		}
	}
	return head(uniq, 60)
}

// ---- rows ----

var variantReference = regexp.MustCompile(`(?i)\bvariant of\s`)

func variantOnly(e Entry) bool {
	seen := false
	for _, field := range strings.Split(e.Defs, "/") {
		if strings.TrimSpace(field) == "" {
			continue
		}
		if !variantReference.MatchString(field) {
			return false
		}
		seen = true
	}
	return seen
}

func (d *Dict) rowsFor(idx []int) []any {
	out := []any{}
	for _, i := range idx {
		out = append(out, d.entryRow(i))
	}
	return out
}

func (d *Dict) entryRow(i int) map[string]any {
	e := d.entries[i]
	return map[string]any{
		"s": e.Simp, "t": e.Trad, "p": PyPretty(e.Pinyin), "d": d.defsOf(i),
	}
}

// defsOf is every meaning the dictionary has for an entry.
//
// EVERY ONE OF THEM. This used to stop at six, in the data rather than in any
// particular view, so nothing downstream could ask for the rest -- they were
// not withheld, they were gone. 带 has seventeen and showed "band; belt;
// girdle; ribbon; tire; area", stopping one word before "zone" and dropping
// to wear, to carry, to take along, to bear, to lead, to bring, to look after
// and to raise -- which is most of how the word is actually used. It is 769
// entries and 1,833 meanings across the dictionary, and because the entries
// with the most senses are the commonest words, it is far more than 0.6% of
// the times anybody looks something up.
//
// If a list is ever too long for somewhere, that is for the somewhere to
// decide. A dictionary that has the answer and does not say it is worse than
// one that never had it, because you cannot tell from the outside.
//
// The classifier goes too. "CL:張|张[zhang1],套[tao4]" is how CEDICT records a
// measure word inside the gloss list; it is metadata, it has its own row on
// the page, and read as a definition of 桌子 it is neither English nor a
// meaning.
func (d *Dict) defsOf(i int) []string {
	parts := []string{}
	for _, def := range strings.Split(d.entries[i].Defs, "/") {
		if def == "" || strings.HasPrefix(strings.ToUpper(strings.TrimSpace(def)), "CL:") {
			continue
		}
		parts = append(parts, def)
	}
	return defsPretty(parts)
}

// ---- character panel ----

var idc = map[rune]bool{
	'⿰': true, '⿱': true, '⿲': true, '⿳': true, '⿴': true, '⿵': true,
	'⿶': true, '⿷': true, '⿸': true, '⿹': true, '⿺': true, '⿻': true,
}

func (d *Dict) charPanel(ch string) map[string]any {
	u := d.unihan[ch]
	m := d.mmah[ch]
	dong := d.dong[ch]

	rs := ""
	if v := u["kRSUnicode"]; v != "" {
		rs = strings.Fields(v)[0]
	}
	// kRSUnicode is "radical.remainder"; only the radical is wanted. The
	// remainder -- the strokes that are not the radical -- is not shown.
	rad, _, _ := strings.Cut(rs, ".")

	mandarin := u["kMandarin"]
	if mandarin == "" && m != nil {
		mandarin = strings.Join(m.Pinyin, " ")
	}
	if mandarin == "" && dong != nil {
		mandarin = dong.Pinyin
	}
	udef := u["kDefinition"]
	if udef == "" && m != nil {
		udef = m.Definition
	}
	if udef == "" && dong != nil {
		udef = dong.Gloss
	}

	var ety any
	decomp, radch := "", ""
	if m != nil {
		decomp, radch = m.Decomposition, m.Radical
		if len(m.Etymology) > 0 && string(m.Etymology) != "null" {
			ety = m.Etymology
		}
	}

	rank := d.ranks[ch]
	at := func(n int) string {
		if n < len(rank) {
			return rank[n]
		}
		return ""
	}

	defs := []any{}
	source := d.bySimp[ch]
	if len(source) == 0 {
		source = d.byTrad[ch]
	}
	// Every reading of the character, not the first six. The Character tab is
	// the page you open to find out what a character does; seven headwords in
	// cedict have more than six readings and this is exactly where they would
	// be looked up.
	for _, i := range source {
		defs = append(defs, map[string]any{
			"p": PyPretty(d.entries[i].Pinyin), "d": d.defsOf(i),
		})
	}
	tree := d.characterTree(ch)
	dongHint := ""
	if dong != nil && dong.Verified && (tree["source"] == "dong" || ety == nil) {
		dongHint = dong.Hint
	}

	return map[string]any{
		"ch":          ch,
		"mandarin":    PyPretty(mandarin),
		"cantonese":   u["kCantonese"],
		"udef":        udef,
		"strokes":     u["kTotalStrokes"],
		"radical":     strings.ReplaceAll(rad, "'", ""),
		"radch":       radch,
		"cangjie":     u["kCangjie"],
		"fourcorner":  u["kFourCornerCode"],
		"unicode":     uPlus(ch),
		"grade":       u["kGradeLevel"],
		"band":        u["kFrequency"],
		"trad":        uplusChars(u["kTraditionalVariant"]),
		"simp":        uplusChars(u["kSimplifiedVariant"]),
		"decomp":      decomp,
		"ety":         ety,
		"tree":        tree,
		"tree_source": tree["source"],
		"dong_hint":   dongHint,
		"stroke":      fileThere(filepath.Join(d.dir, "strokes", ch+".json")),
		"rank":        at(0),
		"hsk":         at(1),
		"gsn":         at(2),
		"defs":        defs,
	}
}

// Every role badge belongs to the component's relationship with its parent.
func (d *Dict) characterTree(ch string) map[string]any {
	return d.decompTree(ch, 0, nil)
}

// decompTree takes the character apart, and each part apart in turn.
func (d *Dict) decompTree(ch string, depth int, ancestors map[string]bool) map[string]any {
	m := d.mmah[ch]
	u := d.unihan[ch]
	dong := d.dong[ch]

	dec := ""
	if m != nil {
		dec = m.Decomposition
	}
	py := u["kMandarin"]
	if py == "" && m != nil {
		py = strings.Join(m.Pinyin, " ")
	}
	if py == "" && dong != nil {
		py = dong.Pinyin
	}
	gloss := ""
	if m != nil {
		gloss = m.Definition
	}
	if gloss == "" {
		gloss = u["kDefinition"]
	}
	if gloss == "" && dong != nil {
		gloss = dong.Gloss
	}
	// When the two source files disagree on a single reading, do not attach
	// one source's pronunciation to the other source's definition.
	if depth > 0 && m != nil && len(strings.Fields(u["kMandarin"])) == 1 &&
		len(m.Pinyin) == 1 && u["kMandarin"] != m.Pinyin[0] {
		if u["kDefinition"] != "" {
			gloss = u["kDefinition"]
		} else if m.Definition != "" {
			py, gloss = m.Pinyin[0], m.Definition
		} else if dong != nil {
			py, gloss = dong.Pinyin, dong.Gloss
		}
	}
	if depth > 0 {
		py, gloss = d.treeComponentSense(ch, py, gloss)
		if supplement, ok := d.componentSenses[ch]; ok {
			if py == "" {
				py = supplement.pinyin
			}
			if gloss == "" {
				gloss = supplement.gloss
			}
		}
	}

	mark := ""
	for _, c := range dec {
		if idc[c] {
			mark = string(c)
			break
		}
	}

	node := map[string]any{
		"ch": ch, "py": py, "gloss": gloss, "idc": mark, "kids": []any{},
	}
	if depth > 0 {
		if py == "" {
			node["py_status"] = "No standalone Mandarin reading recorded in the available sources."
		}
		if gloss == "" {
			node["gloss_status"] = "No definition recorded in the available sources."
		}
	}
	if depth >= 3 {
		return node
	}
	if dong != nil && dong.Verified && len(dong.Components) > 0 &&
		!hasCharacterPart(dec) {
		kids := []any{}
		for _, part := range dong.Components {
			if part.Character == ch || ancestors[part.Character] {
				continue
			}
			if part.Character == "◎" || part.Character == "㇚" {
				kids = append(kids, map[string]any{
					"ch": "◎", "symbol": true, "hint": part.Hint,
					"roles": part.Roles, "kids": []any{},
				})
				continue
			}
			deeper := map[string]bool{ch: true}
			for k := range ancestors {
				deeper[k] = true
			}
			kid := d.decompTree(part.Character, depth+1, deeper)
			kid["hint"] = part.Hint
			roles := append([]string(nil), part.Roles...)
			if m != nil && m.Radical == part.Character {
				found := false
				for _, role := range roles {
					if role == "radical" {
						found = true
						break
					}
				}
				if !found {
					roles = append(roles, "radical")
				}
			}
			kid["roles"] = roles
			kids = append(kids, kid)
		}
		if len(kids) > 0 {
			node["kids"] = kids
			node["source"] = "dong"
			return node
		}
	}

	semantic, phonetic, radical := "", "", ""
	if m != nil {
		semantic, phonetic, radical = m.semantic, m.phonetic, m.Radical
	}

	kids := []any{}
	for _, c := range dec {
		if idc[c] || c == '？' || c <= 0x2E7F {
			continue
		}
		part := string(c)
		if part == ch || ancestors[part] {
			continue
		}
		deeper := map[string]bool{ch: true}
		for k := range ancestors {
			deeper[k] = true
		}
		kid := d.decompTree(part, depth+1, deeper)

		roles := []string{}
		if strings.Contains(semantic, part) {
			roles = append(roles, "meaning")
		}
		if strings.Contains(phonetic, part) {
			roles = append(roles, "sound")
		}
		if strings.Contains(radical, part) {
			roles = append(roles, "radical")
		}
		kid["roles"] = roles
		kids = append(kids, kid)
	}
	node["kids"] = kids
	return node
}

// The tree displays one reading and one meaning per component row. Unihan's
// space-separated kMandarin is a list of alternatives, not a pronunciation.
// A CC-CEDICT entry supplies a *paired* reading and definition when the
// character has only one lexical reading, or when an exact source gloss picks
// one reading unambiguously. Anything else remains unspecified: guessing a
// reading from a similar-looking English word can attach the wrong tone.
func (d *Dict) treeComponentSense(ch, py, gloss string) (string, string) {
	indices := append([]int{}, d.bySimp[ch]...)
	indices = append(indices, d.byTrad[ch]...)
	hasOwnHeadword := false
	for _, i := range indices {
		if d.entries[i].Trad == ch && treeUsableReading(d.entries[i].Defs) {
			hasOwnHeadword = true
			break
		}
	}
	readings := map[string]Entry{}
	for _, i := range indices {
		entry := d.entries[i]
		if runeLen(entry.Simp) != 1 || !treeUsableReading(entry.Defs) ||
			(hasOwnHeadword && entry.Trad != ch) {
			continue
		}
		reading := strings.ToLower(entry.Pinyin)
		if _, exists := readings[reading]; !exists {
			readings[reading] = entry
		}
	}
	if gloss == "" {
		if variantPy, variantGloss := d.treeVariantSense(indices); variantGloss != "" {
			return variantPy, variantGloss
		}
	}
	if len(strings.Fields(py)) == 1 {
		if gloss == "" {
			for reading, entry := range readings {
				if PyPretty(reading) == py {
					gloss = treeFirstDefinition(entry.Defs)
					break
				}
			}
		}
		return py, gloss
	}
	if len(readings) == 1 {
		for _, entry := range readings {
			return PyPretty(entry.Pinyin), treeFirstDefinition(entry.Defs)
		}
	}
	if len(readings) > 1 && gloss != "" {
		// The first semicolon group is the source's primary sense. Later
		// groups may belong to other readings of the same character.
		primary, _, _ := strings.Cut(gloss, ";")
		phrases := treeGlossPhrases(primary)
		best, bestCount, tied := "", 0, false
		for reading, entry := range readings {
			defs := treeGlossPhrases(strings.ReplaceAll(entry.Defs, "/", ";"))
			count := 0
			for phrase := range phrases {
				if defs[phrase] {
					count++
				}
			}
			if count > bestCount {
				best, bestCount, tied = reading, count, false
			} else if count == bestCount && count > 0 {
				tied = true
			}
		}
		if bestCount > 0 && !tied {
			return PyPretty(best), treeFirstDefinition(readings[best].Defs)
		}
	}
	if m := d.mmah[ch]; m != nil && len(m.Pinyin) == 1 && m.Definition != "" {
		return m.Pinyin[0], m.Definition
	}
	// Preserve an independently recorded single reading only when there is
	// no conflicting dictionary evidence. A list of readings is never shown.
	return "", gloss
}

func (d *Dict) treeVariantSense(indices []int) (string, string) {
	for _, i := range indices {
		entry := d.entries[i]
		_, after, found := strings.Cut(strings.ToLower(entry.Defs), "variant of ")
		if !found {
			continue
		}
		target := strings.SplitN(after, "[", 2)[0]
		target = strings.SplitN(target, "/", 2)[0]
		target = strings.TrimSpace(strings.SplitN(target, "|", 2)[0])
		if runeLen(target) != 1 {
			continue
		}
		for _, j := range append(append([]int{}, d.bySimp[target]...), d.byTrad[target]...) {
			base := d.entries[j]
			if !strings.EqualFold(base.Pinyin, entry.Pinyin) || !treeUsableReading(base.Defs) {
				continue
			}
			if definition := treeFirstDefinition(base.Defs); definition != "" {
				return PyPretty(entry.Pinyin), "variant of " + target + ": " + definition
			}
		}
	}
	return "", ""
}

func treeFirstDefinition(definitions string) string {
	for _, definition := range strings.Split(definitions, "/") {
		definition = strings.TrimSpace(definition)
		if definition != "" && !strings.HasPrefix(strings.ToLower(definition), "surname ") &&
			!strings.Contains(strings.ToLower(definition), "variant of ") {
			return definition
		}
	}
	return ""
}

func treeGlossPhrases(gloss string) map[string]bool {
	phrases := map[string]bool{}
	for _, phrase := range strings.FieldsFunc(strings.ToLower(gloss), func(r rune) bool {
		return r == ';' || r == ',' || r == '/'
	}) {
		phrase = strings.TrimSpace(phrase)
		phrase = strings.TrimPrefix(phrase, "to ")
		if len(phrase) >= 4 {
			phrases[phrase] = true
		}
	}
	return phrases
}

func treeUsableReading(definitions string) bool {
	for _, definition := range strings.Split(definitions, "/") {
		lower := strings.ToLower(strings.TrimSpace(definition))
		if lower == "" || strings.HasPrefix(lower, "surname ") ||
			strings.HasPrefix(lower, "abbr. for ") ||
			strings.HasPrefix(lower, "used in ") ||
			strings.Contains(lower, "given names and as a surname") ||
			strings.Contains(lower, "variant of ") {
			continue
		}
		return true
	}
	return false
}

// ---- thesaurus ----

var cjkRE = regexp.MustCompile(`[\x{3400}-\x{9FFF}\x{F900}-\x{FAFF}]+`)

var crossRefPrefixes = []string{
	"variant of", "see ", "same as", "abbr. for", "old variant of", "used in",
}

// glossKeys is the keys one gloss field is indexed and looked up under.
//
// A FIELD IS OFTEN SEVERAL GLOSSES AT ONCE. This edition of CEDICT groups
// senses inside a field and separates them with a semicolon, so 会 is written
//
//	can; to have the skill; to know how to/to be likely to; to be sure to/
//	to meet; to get together/meeting; gathering/(suffix) union; group; ...
//
// Keying on the whole field meant a word found a synonym only where some
// other entry had bundled the same senses, in the same order, in the same
// words. That almost never happens: a field carrying a semicolon is shared
// by another entry 3.9% of the time against 15.6% for a field holding one
// gloss, and of words written this way 85% reached nothing at all. 会 found
// exactly one word in the whole dictionary -- 聚头, the only other entry that
// happens to write "to meet; to get together" as one piece.
//
// Each gloss is now keyed on its own, and the field as a whole as well, so
// that wording which does agree end to end still counts for more.
func glossKeys(field string) []string {
	low := strings.ToLower(strings.TrimSpace(field))
	if low == "" || strings.HasPrefix(low, "cl:") {
		return nil
	}
	out := []string{}
	if len(low) > 2 {
		out = append(out, low)
	}
	if !strings.Contains(low, ";") {
		return out
	}
	for _, part := range strings.Split(low, ";") {
		if part = strings.TrimSpace(part); len(part) > 2 {
			out = append(out, part)
		}
	}
	return out
}

// glossWeight says how much agreeing on one key is worth.
//
// AGREEING ON A PHRASE MEANS MORE THAN AGREEING ON A WORD. "can" is the modal
// in 会 and the tin in 罐, and nothing in the dictionary tells the two apart --
// they are the same three letters. Dropping such words would have cost 能, 可以
// and 能够, which reach 会 through that one word and nothing else, to be rid of
// 罐 and 罐头. So the homograph is kept and outranked instead: a whole phrase
// agreeing is stronger evidence than a single word, and the tin falls to where
// nobody reading the first screenful will meet it.
func glossWeight(key string) int {
	if strings.Contains(key, " ") {
		return 3
	}
	return 1
}

// sortFields sorts one entry's definition fields into the three different
// things the thesaurus makes of them: plain glosses, cross-references, and
// measure words. seenRef carries across entries so a cross-reference named
// by two readings is listed once.
func (d *Dict) sortFields(i int, seenRef map[string]bool) (glosses, refs, measures []string) {
	for _, def := range strings.Split(d.entries[i].Defs, "/") {
		ds := strings.TrimSpace(def)
		low := strings.ToLower(ds)
		switch {
		case ds == "":

		case strings.HasPrefix(low, "cl:"):
			/* ONE CLASSIFIER PER CLASSIFIER.

			   CEDICT writes these as "CL:條|条[tiao2],套[tao4]": comma
			   between different measure words, and a pipe between the
			   traditional and simplified spelling of the SAME one. Hunting
			   CJK runs through that finds 條 and 条 separately, because the
			   pipe is not a CJK character -- and since they are different
			   strings nothing deduplicated them, so both were kept and both
			   looked up the one entry they share. 带 listed its measure word
			   as "条 tiáo 条 tiáo".

			   Read as CEDICT writes it instead: split the items apart on the
			   comma, drop the bracketed pinyin, and take one side of the
			   pipe. Which side does not matter -- both spellings find the
			   same entry, and the row is drawn in whichever script the
			   reader has chosen. */
			for _, item := range strings.Split(ds[3:], ",") {
				if k := strings.IndexByte(item, '['); k >= 0 {
					item = item[:k]
				}
				item = strings.TrimSpace(strings.Split(item, "|")[0])
				if item == "" || runeLen(item) > 2 || !cjkRE.MatchString(item) {
					continue
				}
				if !containsString(measures, item) {
					measures = append(measures, item)
				}
			}

		case hasAnyPrefix(low, crossRefPrefixes):
			for _, m := range cjkRE.FindAllString(ds, -1) {
				m = strings.Split(m, "|")[0]
				_, isSimp := d.bySimp[m]
				_, isTrad := d.byTrad[m]
				if !seenRef[m] && (isSimp || isTrad) {
					seenRef[m] = true
					refs = append(refs, m)
				}
			}

		default:
			glosses = append(glosses, ds)
		}
	}
	return glosses, refs, measures
}

// The supplement is keyed by the exact simplified/traditional headword.
// Wiktionary's classifier is attached to a noun sense, while CC-CEDICT may
// split a written word into several pronunciations. Without a matching sense
// ID, do not attach it to a different pronunciation.
func (d *Dict) documentedMeasures(i int) ([]string, string) {
	e := d.entries[i]
	for _, j := range d.bySimp[e.Simp] {
		if PyNorm(d.entries[j].Pinyin) != PyNorm(e.Pinyin) {
			return nil, ""
		}
	}
	supplement := d.classifiers[e.Simp+"\t"+e.Trad]
	if len(supplement.words) == 0 {
		return nil, ""
	}
	return supplement.words, supplement.edition
}

// senseRows ranks the words that share a gloss with the fields given, best
// first, and stops at limit.
func (d *Dict) senseRows(q string, hits []int, fields []string, limit int) []any {
	// Scored in the order words are first met, because the ranking below
	// breaks its ties on that order.
	score := map[int]int{}
	order := []int{}
	counted := map[string]bool{}

	for _, ds := range fields {
		for _, k := range glossKeys(ds) {
			if counted[k] {
				continue // the query saying it twice is still once
			}
			counted[k] = true
			w := glossWeight(k)
			for _, j := range d.byDef[k] {
				if contains(hits, j) {
					continue
				}
				if _, had := score[j]; !had {
					order = append(order, j)
				}
				score[j] += w
			}
		}
	}

	qLen := runeLen(q)
	ranked := append([]int{}, order...)
	// Everyday words first: how common the word is, and only then how near
	// the query's own length it is -- otherwise archaic one-offs win on
	// brevity.
	//
	// COMMONNESS BEFORE LENGTH. Matching the query's length used to be asked
	// first, which for a single character meant every single character
	// answered ahead of every two-character word however rare it was: 会 was
	// answered by 堪 and by 罐, the tin, before 可以 and 能够. Which of two
	// synonyms is worth reading first has much more to do with whether it is
	// a word people use than with whether it happens to be as long as what
	// was typed.
	sort.SliceStable(ranked, func(a, b int) bool {
		x, y := ranked[a], ranked[b]
		if score[x] != score[y] {
			return score[x] > score[y]
		}
		fx, fy := d.leadFrequency(d.entries[x].Simp), d.leadFrequency(d.entries[y].Simp)
		if fx != fy {
			return fx < fy
		}
		xs, ys := runeLen(d.entries[x].Simp), runeLen(d.entries[y].Simp)
		if abs(xs-qLen) != abs(ys-qLen) {
			return abs(xs-qLen) < abs(ys-qLen)
		}
		return xs < ys
	})

	rows := []any{}
	seen := map[string]bool{q: true}
	for _, j := range ranked {
		s := d.entries[j].Simp
		if !seen[s] {
			seen[s] = true
			rows = append(rows, d.entryRow(j))
		}
		if len(rows) >= limit {
			break
		}
	}
	return rows
}

// thesaurus is every reading's synonyms in one list. Kept for the shape the
// API has always answered in; a reader is shown thesaurusByEntry instead.
func (d *Dict) thesaurus(q string, hits []int) map[string]any {
	seenRef := map[string]bool{q: true}
	glosses, refs, measures := []string{}, []string{}, []string{}
	for _, i := range hits {
		g, r, m := d.sortFields(i, seenRef)
		if len(m) == 0 {
			m, _ = d.documentedMeasures(i)
		}
		glosses = append(glosses, g...)
		refs = append(refs, r...)
		for _, x := range m {
			if !containsString(measures, x) {
				measures = append(measures, x)
			}
		}
	}
	return map[string]any{
		"similar": d.senseRows(q, hits, glosses, 30),
		"seealso": head(d.firstRows(refs), 20),
		"measure": head(d.firstRows(measures), 10),
	}
}

// thesaurusByEntry is the thesaurus the reader is actually looking at: ONE
// READING, WITH ITS SENSES KEPT APART.
//
// A CHARACTER IS NOT ONE WORD. 会 is huì -- to know how to, to meet, a
// gathering -- and it is also kuài, to reckon accounts; 行 is háng, a row or a
// trade, and xíng, to walk. Every reading's synonyms were being poured into a
// single list with nothing to say which sense any of them answered, so the
// page offered the accountancy word and the meeting word side by side and
// left the reader to guess which of their own definitions each belonged to.
//
// Senses are kept apart for the same reason. "To meet" and "meeting" are
// different words in English too, and a list that mixes their synonyms is a
// worse answer than two short lists that do not. This is what the Word tab
// already does with related words, where the rule was written down as: they
// belong to one reading, and a results list never mixes readings.
func (d *Dict) thesaurusByEntry(q string, hits []int) []any {
	out := []any{}
	for _, i := range head(hits, 6) {
		seenRef := map[string]bool{q: true}
		glosses, refs, measures := d.sortFields(i, seenRef)
		measureSource := ""
		if len(measures) == 0 {
			measures, measureSource = d.documentedMeasures(i)
		}

		senses := []any{}
		for _, g := range glosses {
			// Fifteen a sense rather than thirty a word: several short lists
			// under the definitions they answer are read more easily than one
			// long one that answers all of them at once.
			if rows := d.senseRows(q, hits, []string{g}, 15); len(rows) > 0 {
				senses = append(senses, map[string]any{"gloss": g, "similar": rows})
			}
		}

		out = append(out, map[string]any{
			"py":             PyPretty(d.entries[i].Pinyin),
			"senses":         senses,
			"seealso":        head(d.firstRows(refs), 20),
			"measure":        head(d.firstRows(measures), 10),
			"measure_source": measureSource,
		})
	}
	return out
}

// rareWord sorts after every character that has a frequency at all.
const rareWord = 1 << 30

// leadFrequency ranks a word by how common its first character is, smaller
// being commoner. It is the tiebreak that keeps everyday words above archaic
// ones where several share a gloss.
//
// IT WAS READING A FIELD THAT IS NOT IN THE FILE. Unihan publishes
// kFrequency, but this unihan.tsv carries no such field on any line -- so the
// lookup failed for every word alike and every one came back the same "not
// common" 6. The tiebreak had never ordered anything in its life, which is
// how 高兴 came to be led by 咍, 哿 and 喜吟吟 instead of 快乐 and 喜悦.
//
// ranks.tsv has the frequency and is already loaded for the character panel:
// 能 is the 35th commonest character, 可 the 30th, 喜 the 668th, 哿 the
// 6050th, and 咍 is not in the list at all.
func (d *Dict) leadFrequency(word string) int {
	runes := []rune(word)
	if len(runes) == 0 {
		return rareWord
	}
	rank := d.ranks[string(runes[0])]
	if len(rank) == 0 {
		return rareWord
	}
	n, err := strconv.Atoi(rank[0])
	if err != nil {
		return rareWord
	}
	return n
}

func (d *Dict) firstRows(words []string) []any {
	out := []any{}
	for _, w := range words {
		source := d.bySimp[w]
		if len(source) == 0 {
			source = d.byTrad[w]
		}
		for _, j := range head(source, 1) {
			out = append(out, d.entryRow(j))
		}
	}
	return out
}

// ---- related words ----

// sylNorm normalises one pinyin syllable. Case survives on purpose:
// CC-CEDICT writes Zhong1 for the proper noun and zhong1 for the common word,
// and they are different pages.
func sylNorm(tok string) string {
	tok = strings.ReplaceAll(tok, "u:", "v")
	tok = strings.ReplaceAll(tok, "U:", "V")
	if tok == "" {
		return "5"
	}
	last := tok[len(tok)-1]
	if last >= '0' && last <= '9' {
		return tok
	}
	return tok + "5"
}

// related is head, tail, derived and similar-sounding words; with a reading,
// only words where q is actually pronounced that way.
func (d *Dict) related(q string, hits []int, reading string) map[string]any {
	var want []string
	if reading != "" {
		for _, t := range strings.Fields(reading) {
			want = append(want, sylNorm(t))
		}
	}

	qRunes := []rune(q)
	first := string(qRunes[0])
	headIdx, tailIdx, midIdx := []int{}, []int{}, []int{}

	for _, i := range d.contains[first] {
		e := d.entries[i]
		if e.Simp == q || e.Trad == q {
			continue
		}
		w := ""
		if strings.Contains(e.Simp, q) {
			w = e.Simp
		} else if strings.Contains(e.Trad, q) {
			w = e.Trad
		} else {
			continue
		}

		if want != nil {
			toks := strings.Fields(e.Pinyin)
			wRunes := []rune(w)
			pos := runeIndex(w, q)
			if len(toks) == len(wRunes) && pos >= 0 {
				if pos+len(want) > len(toks) {
					continue
				}
				same := true
				for n, syl := range want {
					if sylNorm(toks[pos+n]) != syl {
						same = false
						break
					}
				}
				if !same {
					continue
				}
			}
		}

		switch {
		case strings.HasPrefix(w, q):
			headIdx = append(headIdx, i)
		case strings.HasSuffix(w, q):
			tailIdx = append(tailIdx, i)
		default:
			midIdx = append(midIdx, i)
		}
	}

	byShortest := func(list []int) []int {
		out := append([]int{}, list...)
		sort.SliceStable(out, func(a, b int) bool {
			x, y := d.entries[out[a]].Simp, d.entries[out[b]].Simp
			if runeLen(x) != runeLen(y) {
				return runeLen(x) < runeLen(y)
			}
			return x < y
		})
		return out
	}

	// Sound-alikes: from this reading, or from the first few readings the
	// word has.
	sources := []string{}
	if reading != "" {
		sources = append(sources, reading)
	} else {
		for _, i := range head(hits, 3) {
			sources = append(sources, d.entries[i].Pinyin)
		}
	}
	sim := []int{}
	for _, src := range sources {
		for _, j := range d.byPy[PyNorm(src)] {
			if !contains(hits, j) && !contains(sim, j) {
				sim = append(sim, j)
			}
		}
	}

	return map[string]any{
		"head":    d.rowsFor(head(byShortest(headIdx), 20)),
		"tail":    d.rowsFor(head(byShortest(tailIdx), 20)),
		"derived": d.rowsFor(head(byShortest(midIdx), 20)),
		"similar": d.rowsFor(head(sim, 15)),
	}
}

// ---- examples and segmentation ----

func (d *Dict) examples(q, alt string) []any {
	found := [][2]string{}
	for _, pair := range d.sents {
		if strings.Contains(pair[0], q) || (alt != "" && strings.Contains(pair[0], alt)) {
			found = append(found, pair)
			if len(found) >= 120 {
				break
			}
		}
	}
	sort.SliceStable(found, func(a, b int) bool {
		return runeLen(found[a][0]) < runeLen(found[b][0])
	})
	out := []any{}
	for _, pair := range found {
		if len(out) == 30 {
			break
		}
		// Third: how the word is said in THIS sentence, so the page can keep
		// a reading's examples to that reading. See readingIn.
		say := d.readingIn(pair[0], q)
		if say == "" && alt != "" {
			say = d.readingIn(pair[0], alt)
		}
		out = append(out, []string{pair[0], pair[1], say})
	}
	return out
}

// HOW THE WORD IS SAID IN ONE SENTENCE.
//
// The sentences are matched by "this string is in it" and nothing more, which
// is right for finding them and useless for choosing between them: 车 is chē
// the car, Chē the surname and jū the chariot, and open the chariot and you
// were handed thirteen sentences about taxis and trains. They are not that
// character in any sense that matters.
//
// A sentence does not say how it is pronounced, so it is worked out from the
// word the character is standing in. 火车 is one word and the dictionary says
// huǒ chē, so the 车 in it is chē; 舍车保帅 says shě jū bǎo shuài, so that one
// is jū. Longest match first, because the longer the word the surer the
// reading: a bare 车 with no word around it is all three readings at once and
// worth nothing.
//
// It answers "" whenever it is not sure -- the word is not in the dictionary,
// its pinyin does not count out one syllable per character, or it has several
// readings of its own. A sentence with no reading is left out of a filtered
// list rather than guessed at, because a sentence under the wrong meaning is
// the whole of what was being complained about.
func (d *Dict) readingIn(sentence, q string) string {
	if q == "" {
		return ""
	}
	bi := strings.Index(sentence, q)
	if bi < 0 {
		return ""
	}
	sr := []rune(sentence)
	at := utf8.RuneCountInString(sentence[:bi])
	n := runeLen(q)

	// Longest word covering the whole of the query, out to eight characters.
	for size := 8; size >= n; size-- {
		for i := at - (size - n); i <= at; i++ {
			if i < 0 {
				continue
			}
			j := i + size
			if j > len(sr) {
				continue
			}
			w := string(sr[i : i+size])
			ids := d.bySimp[w]
			if len(ids) == 0 {
				ids = d.byTrad[w]
			}
			if len(ids) == 0 {
				continue
			}
			if say := d.sayAt(ids, size, at-i, n); say != "" {
				return say
			}
		}
	}
	return ""
}

// sayAt reads the syllables standing over one stretch of a word, given every
// entry that word has. Silent where the entries disagree: a word that is
// itself two words is no help in telling two readings apart.
func (d *Dict) sayAt(ids []int, wordRunes, off, n int) string {
	got := ""
	for _, id := range ids {
		syl := strings.Fields(d.entries[id].Pinyin)
		// One syllable per character, or there is no saying which is whose.
		if len(syl) != wordRunes || off+n > len(syl) {
			continue
		}
		say := PyPretty(strings.Join(syl[off:off+n], " "))
		if got == "" {
			got = say
		} else if !SameReading(got, say) {
			return ""
		}
	}
	return got
}

// SameReading compares two readings the way a person would: the marks matter,
// the spacing and the capital do not. CC-CEDICT capitalises a proper noun --
// Chē the surname against chē the car -- and that is a different entry, not a
// different sound.
func SameReading(a, b string) bool {
	return strings.EqualFold(strings.ReplaceAll(a, " ", ""), strings.ReplaceAll(b, " ", ""))
}

// segment is longest-match segmentation: a result for each word the string
// contains, falling back to single characters.
func (d *Dict) segment(runes []rune) []any {
	segs := []any{}
	for i := 0; i < len(runes); {
		if runes[i] <= 0x2E7F {
			i++
			continue
		}
		best := ""
		for j := min(len(runes), i+8); j > i; j-- {
			w := string(runes[i:j])
			_, isSimp := d.bySimp[w]
			_, isTrad := d.byTrad[w]
			if isSimp || isTrad {
				best = w
				break
			}
		}
		if best == "" {
			best = string(runes[i])
		}
		source := d.bySimp[best]
		if len(source) == 0 {
			source = d.byTrad[best]
		}
		/* Every reading the word has, not the first three. This is the list
		   you get for searching a sentence, and a word is in it once with all
		   its meanings under it -- so cutting the readings here cuts meanings
		   off a card that is showing them deliberately. 115 headwords have
		   more than three. */
		seg := map[string]any{"w": best, "entries": d.rowsFor(source)}
		// Unihan's reading, on every single character, entries or not.
		//
		// CC-CEDICT's entry order is not frequency: the first entry for 说 is
		// shuì, "to persuade", and anything that reads a segment by taking
		// entries[0] says the wrong word for 他说. kMandarin is the character's
		// primary reading, so it is carried alongside -- the page still shows
		// this only where there are no entries, and the right-click menu's
		// "Play pinyin" prefers it for a one-character segment.
		if u, ok := d.unihan[best]; ok && runeLen(best) == 1 {
			seg["py"] = u["kMandarin"]
		}
		if len(source) == 0 {
			u := d.unihan[best]
			seg["py"] = u["kMandarin"]
			seg["gloss"] = u["kDefinition"]
		}
		segs = append(segs, seg)
		i += runeLen(best)
	}
	return segs
}

// ---- the pinyin chart ----

var audioName = regexp.MustCompile(`^cmn-(_?[a-zü]+)([1-5]?)\.mp3$`)

// PinyinSyllables is syllable -> the tones there is a recording for, read off
// the recordings on disk.
func (d *Dict) PinyinSyllables() map[string][]string {
	d.pinyinOnce.Do(func() {
		syl := map[string][]string{}
		matches, _ := filepath.Glob(filepath.Join(d.dir, "audio", "cmn-*.mp3"))
		for _, path := range matches {
			m := audioName.FindStringSubmatch(filepath.Base(path))
			if m == nil {
				continue
			}
			if !containsString(syl[m[1]], m[2]) {
				syl[m[1]] = append(syl[m[1]], m[2])
			}
		}
		for k := range syl {
			sort.Strings(syl[k])
		}
		d.pinyinSyl = syl
	})
	if d.pinyinSyl == nil {
		return map[string][]string{}
	}
	return d.pinyinSyl
}

// Counts is what the Control page's dictionary card shows.
func (d *Dict) Counts() (entries, sentences int) {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return len(d.entries), len(d.sents)
}

// ---- small helpers ----

func head[T any](list []T, n int) []T {
	if len(list) > n {
		return list[:n]
	}
	return list
}

func contains(list []int, want int) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

func containsRune(list []rune, want rune) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

func containsString(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

func hasAnyPrefix(s string, prefixes []string) bool {
	for _, p := range prefixes {
		if strings.HasPrefix(s, p) {
			return true
		}
	}
	return false
}

// runeIndex is where `sub` starts in `s`, counted in characters rather than
// bytes, which is what Python's str.index gives.
func runeIndex(s, sub string) int {
	at := strings.Index(s, sub)
	if at < 0 {
		return -1
	}
	return runeLen(s[:at])
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func fileThere(p string) bool {
	st, err := os.Stat(p)
	return err == nil && !st.IsDir()
}

func uPlus(ch string) string {
	r := []rune(ch)
	if len(r) == 0 {
		return ""
	}
	return "U+" + strings.ToUpper(pad4(strconv.FormatInt(int64(r[0]), 16)))
}

func pad4(s string) string {
	for len(s) < 4 {
		s = "0" + s
	}
	return s
}

// uplusChars turns Unihan's "U+8B8A U+8B8B" lists into the characters
// themselves.
func uplusChars(value string) string {
	var b strings.Builder
	for _, tok := range strings.Fields(value) {
		tok = strings.Split(tok, "<")[0]
		if !strings.HasPrefix(tok, "U+") {
			continue
		}
		if n, err := strconv.ParseInt(tok[2:], 16, 32); err == nil {
			b.WriteRune(rune(n))
		}
	}
	return b.String()
}
