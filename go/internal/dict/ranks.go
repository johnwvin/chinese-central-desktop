package dict

// The characters in the order they are actually used, in bands.
//
// ranks.tsv is 9,999 characters ordered by how common they are, and until now
// the only way to see any of it was one character at a time -- open something
// and read "Frequency Rank #2892", which tells you where that one sits and
// nothing about what is around it. This is the list itself: the first hundred,
// then the next four hundred, and so on out to the tail, so the shape of the
// language is something you can look at rather than a number on a card.
//
// The bands are uneven on purpose, and the first two are the point of it. The
// hundred commonest characters are not a hundredth of the work of the first
// ten thousand -- they are most of what is on a page -- so they get a band to
// themselves, and the bands widen as the characters get rarer and matter less
// one by one.

import "sort"

// Band is one stretch of the list.
type Band struct {
	From, To int
	N        int
}

// Where the bands are cut. The last one runs to the end of whatever the file
// holds, so a shorter or longer ranks.tsv still comes out whole.
var bandEdges = []int{1, 101, 501, 1001, 2001, 3001, 4001, 5001, 6001, 7001, 8001}

// Ranked is every character in rank order, ready to be cut into bands. Built
// once and kept, because it is the same list every time and sorting ten
// thousand strings on each visit is work nobody asked for.
func (d *Dict) ranked() []string {
	d.rankOnce.Do(func() {
		type pair struct {
			ch string
			n  int
		}
		all := make([]pair, 0, len(d.ranks))
		for ch, cols := range d.ranks {
			if len(cols) == 0 {
				continue
			}
			n := atoiSafe(cols[0])
			if n <= 0 {
				continue
			}
			all = append(all, pair{ch, n})
		}
		sort.Slice(all, func(a, b int) bool { return all[a].n < all[b].n })
		// Indexed by rank, so rank 1 is at [0]. A gap in the file leaves a
		// gap here rather than shifting everything after it up one.
		out := make([]string, 0, len(all))
		for _, p := range all {
			for len(out) < p.n-1 {
				out = append(out, "")
			}
			out = append(out, p.ch)
		}
		d.rankList = out
	})
	return d.rankList
}

// Bands is the top of the hierarchy: which stretches there are, and how many
// characters are in each.
func (d *Dict) Bands() []any {
	d.mu.RLock()
	defer d.mu.RUnlock()
	list := d.ranked()
	out := []any{}
	for i, from := range bandEdges {
		to := len(list)
		if i+1 < len(bandEdges) {
			to = bandEdges[i+1] - 1
		}
		if from > len(list) {
			break
		}
		if to > len(list) {
			to = len(list)
		}
		n := 0
		for r := from; r <= to; r++ {
			if list[r-1] != "" {
				n++
			}
		}
		out = append(out, map[string]any{"from": from, "to": to, "n": n})
	}
	return out
}

// InBand is one band's characters, in rank order, each with what it is called
// and what it means -- enough to read the list without opening every one.
func (d *Dict) InBand(from, to int) []any {
	d.mu.RLock()
	defer d.mu.RUnlock()
	list := d.ranked()
	if from < 1 {
		from = 1
	}
	if to > len(list) || to < 1 {
		to = len(list)
	}
	out := []any{}
	for r := from; r <= to; r++ {
		ch := list[r-1]
		if ch == "" {
			continue
		}
		cols := d.ranks[ch]
		hsk := ""
		if len(cols) > 1 {
			hsk = cols[1]
		}
		// The readings and the gloss, from the character's own entries. A
		// character read two ways gets both, because which one you are after
		// is exactly what a list like this is for.
		py, gloss := d.readingAndGloss(ch)
		out = append(out, map[string]any{
			"ch": ch, "rank": r, "hsk": hsk, "py": py, "d": gloss,
		})
	}
	return out
}

// readingAndGloss is a character's readings and a short meaning, taken from
// its own dictionary entries and kept brief: this is a list to run an eye
// down, not a page about one character.
func (d *Dict) readingAndGloss(ch string) (string, string) {
	ids := d.bySimp[ch]
	if len(ids) == 0 {
		ids = d.byTrad[ch]
	}
	readings := []string{}
	gloss := ""
	for _, i := range ids {
		say := PyPretty(d.entries[i].Pinyin)
		known := false
		for _, r := range readings {
			if SameReading(r, say) {
				known = true
			}
		}
		if !known {
			readings = append(readings, say)
		}
		if gloss == "" {
			if defs := d.defsOf(i); len(defs) > 0 {
				gloss = defs[0]
			}
		}
	}
	if len(readings) > 3 {
		readings = readings[:3]
	}
	return joinWith(readings, " · "), gloss
}

func joinWith(list []string, sep string) string {
	out := ""
	for i, s := range list {
		if i > 0 {
			out += sep
		}
		out += s
	}
	return out
}

func atoiSafe(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0
		}
		n = n*10 + int(r-'0')
	}
	return n
}
