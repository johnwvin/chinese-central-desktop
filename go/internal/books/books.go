// Package books reads the PDFs and EPUBs in your books folder.
//
// A PDF is handed to the browser whole -- it already has a reader. An EPUB is
// a zip of XHTML, so it is opened here: the package file gives the reading
// order, and one chapter at a time comes back as markup the reader can put
// straight into the page.
//
// A book is something to read, not somewhere to be taken. Whatever the
// publisher put in a chapter -- a footnote link, a shop, a redirect on a timer
// -- comes out before the chapter is ever sent. The pictures and stylesheets
// keep a rewritten src that points back at this server; only the ways out go.
//
// This is a port of the epub_* and book_* functions in server.py.
package books

import (
	"archive/zip"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// Kinds are the two file types the books folder is read for.
var Kinds = map[string]string{".pdf": "pdf", ".epub": "epub"}

// At is the file a request names, and its path under the books folder, or an
// error. Resolved and checked against the folder, so a name full of dot-dots
// cannot walk out of it.
func At(root, rel string) (string, string, error) {
	if root == "" {
		return "", "", errors.New("no books folder")
	}
	name, err := url.QueryUnescape(rel)
	if err != nil {
		name = rel
	}
	here, err := filepath.Abs(filepath.Join(root, filepath.FromSlash(name)))
	if err != nil {
		return "", "", err
	}
	top, err := filepath.Abs(root)
	if err != nil {
		return "", "", err
	}
	here, top = resolve(here), resolve(top)
	if here != top && !strings.HasPrefix(here, top+string(filepath.Separator)) {
		return "", "", errors.New("outside the books folder")
	}
	st, err := os.Stat(here)
	if err != nil || st.IsDir() {
		return "", "", errors.New("no such book")
	}
	if _, ok := Kinds[strings.ToLower(filepath.Ext(here))]; !ok {
		return "", "", errors.New("not a book")
	}
	// The name to call it by afterwards is worked out from the file, not taken
	// from the request: two spellings of the same book must rewrite a
	// chapter's pictures to one address, not two.
	under, err := filepath.Rel(top, here)
	if err != nil {
		return "", "", err
	}
	return here, filepath.ToSlash(under), nil
}

// resolve follows symlinks where it can, and keeps the plain path where it
// cannot -- a folder that is not there yet still has a name worth comparing.
func resolve(p string) string {
	if real, err := filepath.EvalSymlinks(p); err == nil {
		return real
	}
	return p
}

// ---- the package file ----

// Chapter is one entry in the reading order.
type Chapter struct {
	I     int    `json:"i"`
	Label string `json:"label"`
	File  string `json:"file"`
}

// Spine is the book's reading order, as the reader asks for it.
type Spine struct {
	Title    string    `json:"title"`
	Chapters []Chapter `json:"chapters"`
}

// Fail is what a book that cannot be read answers with: the reason, and
// nothing else, because there is nothing else to say.
type Fail struct {
	Error string `json:"error"`
}

// ReadSpine is the book's reading order, straight out of the package file.
//
// container.xml names the OPF; the OPF's manifest maps ids to files and its
// spine lists the ids in order. The table of contents is a nicety -- where it
// is missing the files' own names do.
//
// It answers with a Spine, or a Fail saying what is wrong with the book. The
// error return is kept for the one thing that is not the book's fault: a file
// that could not be opened at all.
func ReadSpine(path string) (any, error) {
	z, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer z.Close()
	return spineIn(&z.Reader, path), nil
}

func spineIn(z *zip.Reader, path string) any {
	opfName, opf, fail := packageFile(z)
	if fail != "" {
		return Fail{fail}
	}
	base := ""
	if at := strings.LastIndex(opfName, "/"); at >= 0 {
		base = opfName[:at]
	}

	stem := strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	title := stem
	type item struct{ href, mime string }
	items := map[string]item{}
	var order []string
	for _, el := range opf.walk() {
		switch el.name {
		case "item":
			if id := el.attr["id"]; id != "" {
				items[id] = item{el.attr["href"], el.attr["media-type"]}
			}
		case "itemref":
			if id := el.attr["idref"]; id != "" {
				order = append(order, id)
			}
		case "title":
			if strings.TrimSpace(el.text) != "" && title == stem {
				title = strings.TrimSpace(el.text)
			}
		}
	}

	labels := chapterLabels(z)

	chapters := []Chapter{}
	for _, idref := range order {
		it, ok := items[idref]
		if !ok {
			continue
		}
		low := strings.ToLower(it.href)
		if !strings.Contains(it.mime, "html") &&
			!strings.HasSuffix(low, ".xhtml") &&
			!strings.HasSuffix(low, ".html") &&
			!strings.HasSuffix(low, ".htm") {
			continue
		}
		full := it.href
		if base != "" {
			full = base + "/" + it.href
		}
		label := labels[it.href]
		if label == "" {
			label = labels[full]
		}
		if label == "" {
			label = it.href
			if at := strings.LastIndex(label, "/"); at >= 0 {
				label = label[at+1:]
			}
		}
		chapters = append(chapters, Chapter{I: len(chapters), Label: label, File: full})
	}
	if len(chapters) == 0 {
		return Fail{"The book lists no readable chapters."}
	}
	return Spine{Title: title, Chapters: chapters}
}

// packageFile finds and parses the OPF the container names.
func packageFile(z *zip.Reader) (string, *node, string) {
	raw, err := entry(z, "META-INF/container.xml")
	if err != nil {
		return "", nil, "No container.xml -- not an EPUB?"
	}
	cont, err := parseXML(raw)
	if err != nil {
		return "", nil, "No container.xml -- not an EPUB?"
	}
	opfName := ""
	if rootfile := cont.find("rootfile"); rootfile != nil {
		opfName = rootfile.attr["full-path"]
	}
	if opfName == "" {
		return "", nil, "The container names no package file."
	}
	raw, err = entry(z, opfName)
	if err != nil {
		return "", nil, "The package file could not be read."
	}
	opf, err := parseXML(raw)
	if err != nil {
		return "", nil, "The package file could not be read."
	}
	return opfName, opf, ""
}

// chapterLabels are the titles for the chapters, from the navigation document
// if there is one. Keyed by file, since that is what the spine gives us.
func chapterLabels(z *zip.Reader) map[string]string {
	labels := map[string]string{}
	for _, f := range z.File {
		low := strings.ToLower(f.Name)
		if !strings.HasSuffix(low, ".ncx") && !strings.HasSuffix(low, "nav.xhtml") &&
			!strings.HasSuffix(low, "toc.xhtml") {
			continue
		}
		raw, err := entry(z, f.Name)
		if err != nil {
			continue
		}
		nav, err := parseXML(raw)
		if err != nil {
			continue
		}
		for _, el := range nav.walk() {
			switch el.name {
			case "navpoint":
				lbl, con := el.find("text"), el.find("content")
				if lbl != nil && con != nil && con.attr["src"] != "" {
					labels[strings.SplitN(con.attr["src"], "#", 2)[0]] = strings.TrimSpace(lbl.text)
				}
			case "a":
				href := el.attr["href"]
				if href == "" {
					continue
				}
				txt := strings.TrimSpace(el.allText())
				if txt == "" {
					continue
				}
				key := strings.SplitN(href, "#", 2)[0]
				if _, seen := labels[key]; !seen {
					labels[key] = txt
				}
			}
		}
	}
	return labels
}

// ---- one chapter ----

// Part is one chapter, ready for the reader.
type Part struct {
	Title string `json:"title"`
	Label string `json:"label"`
	I     int    `json:"i"`
	Count int    `json:"count"`
	HTML  string `json:"html"`
}

// ReadPart is one chapter's markup, with its links pointed back at this server
// so the pictures and stylesheets inside the zip still resolve.
//
// `rel` is the book's path under the books folder, which is how the rewritten
// addresses name it again on the way back in.
func ReadPart(path, rel string, i int) (any, error) {
	z, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer z.Close()

	read := spineIn(&z.Reader, path)
	spine, ok := read.(Spine)
	if !ok {
		return read, nil // the book's own complaint, as it stands
	}
	if i < 0 || i >= len(spine.Chapters) {
		return Fail{"No such chapter."}, nil
	}
	inner := spine.Chapters[i].File
	raw, err := entry(&z.Reader, inner)
	if err != nil {
		return Fail{"That chapter is missing from the book."}, nil
	}
	html := string(raw)

	// Only the body: a chapter is a whole document, and its <head> would
	// arrive in the middle of ours.
	low := strings.ToLower(html)
	a, b := strings.Index(low, "<body"), strings.LastIndex(low, "</body>")
	if a >= 0 && b > a {
		if shut := strings.Index(html[a:], ">"); shut >= 0 {
			html = html[a+shut+1 : b]
		}
	}
	here := ""
	if at := strings.LastIndex(inner, "/"); at >= 0 {
		here = inner[:at]
	}
	html = pointInward(html, rel, here)
	html = defang(html)

	return Part{Title: spine.Title, Label: spine.Chapters[i].Label,
		I: i, Count: len(spine.Chapters), HTML: html}, nil
}

var (
	reLinkAttr = regexp.MustCompile(`(src|href)="([^"]+)"`)
	reAbsolute = regexp.MustCompile(`^(https?:|data:|mailto:|#|/)`)
)

// pointInward rewrites a chapter's own src and href so the pictures and
// stylesheets in the zip come back through this server.
func pointInward(html, rel, here string) string {
	return replaceGroups(reLinkAttr, html, func(g []string) string {
		attr, raw := g[1], g[2]
		if reAbsolute.MatchString(raw) {
			return g[0]
		}
		parts := raw
		if here != "" {
			parts = here + "/" + raw
		}
		bits := []string{}
		for _, piece := range strings.Split(parts, "/") {
			switch piece {
			case "", ".":
				continue
			case "..":
				if len(bits) > 0 {
					bits = bits[:len(bits)-1]
				}
				continue
			}
			bits = append(bits, piece)
		}
		return attr + `="/api/central/bookres?f=` + Quote(rel) +
			`&p=` + Quote(strings.Join(bits, "/")) + `"`
	})
}

var (
	reAnchor     = regexp.MustCompile(`(?i)<\s*a\b([^>]*)>`)
	reAnchorAttr = regexp.MustCompile(`(?i)\s(href|target|ping|rel|download)\s*=\s*"[^"]*"`)
	reAnchorAtt2 = regexp.MustCompile(`(?i)\s(href|target|ping|rel|download)\s*=\s*'[^']*'`)
	reBase       = regexp.MustCompile(`(?i)<\s*base\b[^>]*>`)
	reRefresh    = regexp.MustCompile(`(?i)<\s*meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>`)
	reOnAttr     = regexp.MustCompile(`(?i)\son[a-z]+\s*=\s*"[^"]*"`)
	reOnAttr2    = regexp.MustCompile(`(?i)\son[a-z]+\s*=\s*'[^']*'`)
)

// The elements that come out whole, and then the ones left as a bare tag. Go's
// regexp has no back-reference, so each name gets its own pattern rather than
// one pattern closing on itself.
var lively = []string{"script", "iframe", "object", "embed", "form"}

var (
	livelyWhole = map[string]*regexp.Regexp{}
	livelyAlone = map[string]*regexp.Regexp{}
)

func init() {
	for _, name := range lively {
		livelyWhole[name] = regexp.MustCompile(`(?is)<\s*` + name + `\b.*?</\s*` + name + `\s*>`)
		livelyAlone[name] = regexp.MustCompile(`(?i)<\s*` + name + `\b[^>]*>`)
	}
}

// defang takes the ways out of a chapter. Its text and pictures stay.
func defang(html string) string {
	// An <a> with nothing to click. Its text stays; the destination goes.
	html = replaceGroups(reAnchor, html, func(g []string) string {
		attrs := reAnchorAttr.ReplaceAllString(g[1], "")
		attrs = reAnchorAtt2.ReplaceAllString(attrs, "")
		return "<a" + attrs + ">"
	})
	html = reBase.ReplaceAllString(html, "")
	html = reRefresh.ReplaceAllString(html, "")
	for _, name := range lively {
		html = livelyWhole[name].ReplaceAllString(html, "")
		html = livelyAlone[name].ReplaceAllString(html, "")
	}
	html = reOnAttr.ReplaceAllString(html, "")
	html = reOnAttr2.ReplaceAllString(html, "")
	return html
}

// replaceGroups is ReplaceAllStringFunc with the submatches to hand.
func replaceGroups(re *regexp.Regexp, s string, with func([]string) string) string {
	return re.ReplaceAllStringFunc(s, func(m string) string {
		return with(re.FindStringSubmatch(m))
	})
}

// Quote percent-encodes for a URL the way Python's urllib.parse.quote does:
// letters, digits, "_.-~" and "/" go through untouched and everything else
// becomes %XX of its UTF-8 bytes.
//
// Go's own QueryEscape is not the same function -- it writes a space as "+"
// and escapes the slashes -- and these addresses are read back by a page that
// was written against Python's. A book whose name has a space in it is the
// common case, not the corner one.
func Quote(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
			b.WriteByte(c)
		case c == '_' || c == '.' || c == '-' || c == '~' || c == '/':
			b.WriteByte(c)
		default:
			b.WriteString(fmt.Sprintf("%%%02X", c))
		}
	}
	return b.String()
}

// ---- pictures out of the zip ----

var mimes = map[string]string{
	"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png",
	"gif": "image/gif", "svg": "image/svg+xml", "webp": "image/webp",
	"css": "text/css", "otf": "font/otf", "ttf": "font/ttf",
	"woff": "font/woff", "woff2": "font/woff2",
}

// Res is a picture or stylesheet from inside the book.
func Res(path, inner string) ([]byte, string) {
	z, err := zip.OpenReader(path)
	if err != nil {
		return nil, ""
	}
	defer z.Close()
	raw, err := entry(&z.Reader, inner)
	if err != nil {
		return nil, ""
	}
	mime := mimes[extension(inner)]
	if mime == "" {
		mime = "application/octet-stream"
	}
	return raw, mime
}

// Cover is the cover image an EPUB names for itself, and its type.
//
// The package file marks it, either with properties="cover-image" on the item
// or with a <meta name="cover"> pointing at one. Failing both, the first image
// in the manifest is nearly always it.
func Cover(path string) ([]byte, string) {
	z, err := zip.OpenReader(path)
	if err != nil {
		return nil, ""
	}
	defer z.Close()

	opfName, opf, fail := packageFile(&z.Reader)
	if fail != "" {
		return nil, ""
	}
	base := ""
	if at := strings.LastIndex(opfName, "/"); at >= 0 {
		base = opfName[:at]
	}

	// The <meta name="cover"> case cannot be resolved against items in the
	// same pass that collects them: a package file's <metadata> -- where that
	// meta sits -- always comes before its <manifest> in document order, so
	// items was still empty every time this ran inside the walk. The lookup
	// failed silently and fell through to "first image in the manifest",
	// which is nearly always something else -- a 1-pixel spacer, in at least
	// one real book -- so the marked cover was never used at all.
	items := map[string][2]string{}
	propMarked, metaCoverID, first := "", "", ""
	for _, el := range opf.walk() {
		switch el.name {
		case "item":
			id, href, mime := el.attr["id"], el.attr["href"], el.attr["media-type"]
			if id != "" {
				items[id] = [2]string{href, mime}
			}
			if strings.Contains(mime, "image") {
				if first == "" {
					first = href
				}
				if strings.Contains(el.attr["properties"], "cover-image") {
					propMarked = href
				}
			}
		case "meta":
			if el.attr["name"] == "cover" {
				metaCoverID = el.attr["content"]
			}
		}
	}
	href := propMarked
	if href == "" && metaCoverID != "" {
		if got, ok := items[metaCoverID]; ok && strings.Contains(got[1], "image") {
			href = got[0]
		}
	}
	if href == "" {
		href = first
	}
	if href == "" {
		return nil, ""
	}
	inner := href
	if base != "" {
		inner = base + "/" + href
	}
	raw, err := entry(&z.Reader, inner)
	if err != nil {
		return nil, ""
	}
	// The type comes off the file's own name, and anything unrecognised is
	// called a JPEG -- which is what it nearly always is.
	mime := mimes[extension(inner)]
	if mime == "" || !strings.HasPrefix(mime, "image/") {
		mime = "image/jpeg"
	}
	return raw, mime
}

func extension(name string) string {
	at := strings.LastIndex(name, ".")
	if at < 0 {
		return ""
	}
	return strings.ToLower(name[at+1:])
}

// entry reads one file out of the zip by name.
func entry(z *zip.Reader, name string) ([]byte, error) {
	f, err := z.Open(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return io.ReadAll(f)
}

// ---- just enough XML ----

// node is one element: its local name lowercased, its attributes by local
// name, its own text and its children.
//
// The package and navigation files are read by walking every element and
// looking at the ones we know, exactly as ElementTree's iter() does, because
// EPUBs put these in several namespaces and none of them matter here.
type node struct {
	name string
	attr map[string]string
	text string
	kids []*node
}

func parseXML(raw []byte) (*node, error) {
	dec := xml.NewDecoder(strings.NewReader(string(raw)))
	// A navigation document is often XHTML with entities the parser has never
	// been told about, and half a table of contents beats none.
	//
	// AutoClose is deliberately NOT set. It would close <meta> the moment it
	// opened, and a package file is full of `<meta ...>text</meta>`: every one
	// of those would then arrive with an end tag of its own, popping a level
	// that was never pushed. Six of them into the file the manifest is no
	// longer inside anything, and a book with twenty-five chapters reads as a
	// book with none.
	dec.Strict = false
	dec.Entity = xml.HTMLEntity

	var root *node
	stack := []*node{}
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			if root != nil {
				break // as much of the file as could be read
			}
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			el := &node{name: strings.ToLower(t.Name.Local), attr: map[string]string{}}
			for _, a := range t.Attr {
				el.attr[a.Name.Local] = a.Value
			}
			switch {
			case len(stack) > 0:
				parent := stack[len(stack)-1]
				parent.kids = append(parent.kids, el)
			case root == nil:
				root = el
			default:
				// Past the end of the root element. Malformed, and keeping it
				// beats dropping it: what we are looking for may be in there.
				root.kids = append(root.kids, el)
			}
			stack = append(stack, el)
		case xml.EndElement:
			// Closed by name, not by count. A stray end tag closes nothing
			// rather than closing whatever happens to be open.
			name := strings.ToLower(t.Name.Local)
			for at := len(stack) - 1; at >= 0; at-- {
				if stack[at].name == name {
					stack = stack[:at]
					break
				}
			}
		case xml.CharData:
			if len(stack) > 0 {
				stack[len(stack)-1].text += string(t)
			}
		}
	}
	if root == nil {
		return nil, errors.New("no elements")
	}
	return root, nil
}

// walk is every element from here down, in document order, this one first --
// ElementTree's iter().
func (n *node) walk() []*node {
	out := []*node{n}
	for _, kid := range n.kids {
		out = append(out, kid.walk()...)
	}
	return out
}

// find is the first element with that name, this one included.
func (n *node) find(name string) *node {
	for _, el := range n.walk() {
		if el.name == name {
			return el
		}
	}
	return nil
}

// allText is this element's text and all its children's, joined -- itertext().
func (n *node) allText() string {
	var b strings.Builder
	for _, el := range n.walk() {
		b.WriteString(el.text)
	}
	return b.String()
}
