package dict

import (
	"sort"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

type SearchOptions struct {
	Mode, Match, Strokes string
	Page                 int
}

const resultsPerPage = 40

// Search lists matches for a specific search mode. The automatic lookup
// still opens a word or breaks a pasted passage into words via Query.
func (d *Dict) Search(q string, options SearchOptions) map[string]any {
	q = strings.TrimSpace(q)
	switch options.Mode {
	case "english", "pinyin", "chinese", "radical":
	default:
		return d.Query(q)
	}
	if q == "" && (options.Mode != "radical" || options.Strokes == "") {
		return d.Query("")
	}
	if !d.Load() {
		return d.Query(q)
	}
	d.mu.RLock()
	defer d.mu.RUnlock()

	if options.Mode == "radical" {
		matches := d.findCharacters(q, options.Strokes)
		start, end, info := pageBounds(len(matches), options.Page)
		rows := make([]any, 0, end-start)
		for _, match := range matches[start:end] {
			rows = append(rows, d.characterSearchRow(match.char))
		}
		return map[string]any{"q": q, "entries": rows, "search": info}
	}

	var hits []searchHit
	switch options.Mode {
	case "english":
		hits = d.findEnglish(q, options.Match)
	case "pinyin":
		hits = d.findPinyin(q, options.Match == "starts")
	case "chinese":
		hits = d.findChinese(q, options.Match)
	}
	sort.SliceStable(hits, func(i, j int) bool {
		a, b := hits[i], hits[j]
		if a.priority != b.priority {
			return a.priority < b.priority
		}
		if a.length != b.length {
			return a.length < b.length
		}
		return a.index < b.index
	})
	start, end, info := pageBounds(len(hits), options.Page)
	rows := make([]any, 0, end-start)
	for _, hit := range hits[start:end] {
		rows = append(rows, d.entryRow(hit.index))
	}
	return map[string]any{"q": q, "entries": rows, "search": info}
}

func pageBounds(total, requested int) (int, int, map[string]int) {
	pages := max(1, (total+resultsPerPage-1)/resultsPerPage)
	page := max(1, min(requested, pages))
	start := (page - 1) * resultsPerPage
	return start, min(start+resultsPerPage, total), map[string]int{"page": page, "pages": pages, "total": total}
}

type searchHit struct {
	index, priority, length int
}

func (d *Dict) findChinese(q, match string) []searchHit {
	priority := func(word string) int {
		switch {
		case word == q:
			return 0
		case match == "exact":
			return -1
		case match == "ends":
			if strings.HasSuffix(word, q) {
				return 1
			}
		case strings.HasPrefix(word, q):
			return 1
		case match != "starts" && strings.Contains(word, q):
			return 2
		}
		return -1
	}

	var hits []searchHit
	check := func(i int) {
		e := d.entries[i]
		best := priority(e.Simp)
		if alt := priority(e.Trad); alt >= 0 && (best < 0 || alt < best) {
			best = alt
		}
		if best >= 0 {
			hits = append(hits, searchHit{i, best, runeLen(e.Simp)})
		}
	}
	for _, ch := range q {
		if unicode.Is(unicode.Han, ch) {
			for _, i := range d.contains[string(ch)] {
				check(i)
			}
			return hits
		}
	}
	for i := range d.entries {
		check(i)
	}
	return hits
}

func (d *Dict) findEnglish(q, match string) []searchHit {
	q = strings.ToLower(strings.Join(strings.Fields(q), " "))
	var hits []searchHit
	for i, e := range d.entries {
		glosses := strings.ToLower(e.Defs)
		if !strings.Contains(glosses, q) {
			continue
		}
		best := 3
		for _, sense := range strings.FieldsFunc(glosses, func(r rune) bool { return r == '/' || r == ';' }) {
			sense = strings.TrimSpace(sense)
			if strings.HasPrefix(sense, "cl:") {
				continue
			}
			switch {
			case sense == q, match != "exact" && sense == "to "+q:
				best = 0
			case match != "exact" && best > 1 && includesEnglishPhrase(sense, q):
				best = 1
			case match == "contains" && best > 2 && strings.Contains(sense, q):
				best = 2
			}
			if best == 0 {
				break
			}
		}
		if best < 3 {
			hits = append(hits, searchHit{i, best, runeLen(e.Simp)})
		}
	}
	return hits
}

func includesEnglishPhrase(s, phrase string) bool {
	wordChar := func(ch rune) bool { return unicode.IsLetter(ch) || unicode.IsDigit(ch) }
	for from := 0; from < len(s); {
		offset := strings.Index(s[from:], phrase)
		if offset < 0 {
			break
		}
		start := from + offset
		before, _ := utf8.DecodeLastRuneInString(s[:start])
		after, _ := utf8.DecodeRuneInString(s[start+len(phrase):])
		if !wordChar(before) && !wordChar(after) {
			return true
		}
		_, size := utf8.DecodeRuneInString(s[start:])
		from = start + size
	}
	return false
}

type pinyinTone struct {
	at   int
	tone rune
}

type pinyinQuery struct {
	letters         string
	marked, endings []pinyinTone
}

func parsePinyin(s string) pinyinQuery {
	var q pinyinQuery
	var letters strings.Builder
	for _, ch := range strings.ReplaceAll(strings.ToLower(s), "u:", "ü") {
		switch {
		case ch >= '0' && ch <= '5':
			if ch == '0' {
				ch = '5'
			}
			q.endings = append(q.endings, pinyinTone{letters.Len(), ch})
		default:
			letter, tone := pinyinLetter(ch)
			if letter != 0 {
				if tone != 0 {
					q.marked = append(q.marked, pinyinTone{letters.Len(), tone})
				}
				letters.WriteByte(letter)
			}
		}
	}
	q.letters = letters.String()
	return q
}

func pinyinLetter(ch rune) (byte, rune) {
	if ch >= 'a' && ch <= 'z' {
		return byte(ch), 0
	}
	if ch == 'ü' {
		return 'v', 0
	}
	for base, marks := range toneMarks {
		for i, mark := range marks {
			if ch == mark {
				if base == 'ü' {
					base = 'v'
				}
				return byte(base), rune('1' + i)
			}
		}
	}
	return 0, 0
}

func containsTones(actual, wanted []pinyinTone) bool {
	for _, tone := range wanted {
		found := false
		for _, candidate := range actual {
			if candidate == tone {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func (d *Dict) findPinyin(q string, starts bool) []searchHit {
	want := parsePinyin(q)
	if want.letters == "" {
		return nil
	}
	var hits []searchHit
	add := func(key string, rank int) {
		for _, i := range d.byPy[key] {
			entry := d.entries[i]
			if len(want.endings) > 0 && !containsTones(parsePinyin(entry.Pinyin).endings, want.endings) {
				continue
			}
			if len(want.marked) > 0 && !containsTones(parsePinyin(PyPretty(entry.Pinyin)).marked, want.marked) {
				continue
			}
			hits = append(hits, searchHit{i, rank, runeLen(entry.Simp)})
		}
	}
	add(want.letters, 0)
	if starts {
		for _, key := range d.byPyKeys {
			if key != want.letters && strings.HasPrefix(key, want.letters) {
				add(key, 1)
			}
		}
	}
	return hits
}

const kangxiRadicals = "一丨丶丿乙亅二亠人儿入八冂冖冫几凵刀力勹匕匚匸十卜卩厂厶又口囗土士夂夊夕大女子宀寸小尢尸屮山巛工己巾干幺广廴廾弋弓彐彡彳心戈戶手支攴文斗斤方无日曰月木欠止歹殳毋比毛氏气水火爪父爻爿片牙牛犬玄玉瓜瓦甘生用田疋疒癶白皮皿目矛矢石示禸禾穴立竹米糸缶网羊羽老而耒耳聿肉臣自至臼舌舛舟艮色艸虍虫血行衣襾見角言谷豆豕豸貝赤走足身車辛辰辵邑酉釆里金長門阜隶隹雨靑非面革韋韭音頁風飛食首香馬骨高髟鬥鬯鬲鬼魚鳥鹵鹿麥麻黃黍黑黹黽鼎鼓鼠鼻齊齒龍龜龠"

var radicalVariants = map[rune]rune{
	'亻': '人', '刂': '刀', '忄': '心', '扌': '手', '氵': '水', '灬': '火',
	'犭': '犬', '王': '玉', '礻': '示', '糹': '糸', '纟': '糸', '艹': '艸',
	'衤': '衣', '讠': '言', '贝': '貝', '车': '車', '辶': '辵', '钅': '金',
	'长': '長', '门': '門', '风': '風', '饣': '食', '马': '馬', '鱼': '魚',
	'鸟': '鳥', '页': '頁', '见': '見', '龙': '龍', '龟': '龜',
}

func radicalNumbers(q string) (int, int) {
	if q == "" {
		return 0, 0
	}
	if n, err := strconv.Atoi(q); err == nil && n >= 1 && n <= 214 {
		return n, 0
	}
	ch, size := utf8.DecodeRuneInString(q)
	if size != len(q) {
		return -1, 0
	}
	if ch >= 0x2F00 && ch <= 0x2FD5 {
		return int(ch-0x2F00) + 1, 0
	}
	if ch == '阝' {
		return 163, 170
	}
	if equivalent, ok := radicalVariants[ch]; ok {
		ch = equivalent
	}
	for i, radical := range []rune(kangxiRadicals) {
		if ch == radical {
			return i + 1, 0
		}
	}
	return -1, 0
}

type characterSearchHit struct {
	char string
	rank int
}

func (d *Dict) findCharacters(q, strokes string) []characterSearchHit {
	radical, alternative := radicalNumbers(q)
	count, err := strconv.Atoi(strokes)
	if radical < 0 || (strokes != "" && (err != nil || count <= 0)) {
		return nil
	}
	var hits []characterSearchHit
	for ch, fields := range d.unihan {
		if radical > 0 && !hasRadical(fields["kRSUnicode"], radical, alternative) {
			continue
		}
		if count > 0 && !hasStrokeCount(fields["kTotalStrokes"], count) {
			continue
		}
		rank := 0
		if values := d.ranks[ch]; len(values) > 0 {
			rank, _ = strconv.Atoi(values[0])
		}
		hits = append(hits, characterSearchHit{ch, rank})
	}
	sort.Slice(hits, func(i, j int) bool {
		a, b := hits[i], hits[j]
		if a.rank != b.rank {
			return a.rank > 0 && (b.rank == 0 || a.rank < b.rank)
		}
		return a.char < b.char
	})
	return hits
}

func hasRadical(field string, radical, alternative int) bool {
	for _, value := range strings.Fields(field) {
		number, _, _ := strings.Cut(value, ".")
		n, err := strconv.Atoi(strings.TrimRight(number, "'"))
		if err == nil && (n == radical || n == alternative) {
			return true
		}
	}
	return false
}

func hasStrokeCount(field string, count int) bool {
	for _, value := range strings.Fields(field) {
		if n, err := strconv.Atoi(value); err == nil && n == count {
			return true
		}
	}
	return false
}

func (d *Dict) characterSearchRow(ch string) map[string]any {
	ids := d.bySimp[ch]
	if len(ids) == 0 {
		ids = d.byTrad[ch]
	}
	for _, i := range ids {
		if !variantOnly(d.entries[i]) {
			// Use the matched character even when the reading has two spellings.
			return map[string]any{"s": ch, "t": ch, "p": PyPretty(d.entries[i].Pinyin), "d": d.defsOf(i)}
		}
	}
	fields := d.unihan[ch]
	definitions := []string{}
	if definition := fields["kDefinition"]; definition != "" {
		definitions = append(definitions, definition)
	}
	return map[string]any{"s": ch, "t": ch, "p": PyPretty(fields["kMandarin"]), "d": definitions}
}
