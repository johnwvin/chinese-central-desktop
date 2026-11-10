package books

import (
	"archive/zip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// makeEPUB writes a small but real EPUB and answers with its path.
//
// The package file deliberately carries `<meta ...>text</meta>` before the
// manifest. That is not decoration: an XML reader that closes <meta> as it
// opens gets a second end tag from the real one, pops a level it never pushed,
// and by the manifest is no longer inside anything -- which is how a book with
// chapters came to read as a book with none.
func makeEPUB(t *testing.T, name string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	z := zip.NewWriter(f)
	write := func(name, body string) {
		w, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}

	write("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)

	write("OEBPS/content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>A Small Book</dc:title>
    <dc:creator id="creator">Nobody</dc:creator>
    <meta property="file-as" refines="#creator">Nobody</meta>
    <meta property="role" refines="#creator">aut</meta>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="one" href="Text/one.xhtml" media-type="application/xhtml+xml"/>
    <item id="two" href="Text/two.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-img" href="Images/cover.png" media-type="image/png"/>
    <item id="css" href="Styles/book.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="one"/>
    <itemref idref="two"/>
    <itemref idref="cover-img"/>
  </spine>
</package>`)

	write("OEBPS/nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><nav>
  <ol><li><a href="Text/one.xhtml">The Beginning</a></li></ol>
</nav></body></html>`)

	write("OEBPS/Text/one.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body>
<p>Hello <a href="two.xhtml" target="_blank">there</a> and <a href="https://example.com">away</a>.</p>
<img src="../Images/cover.png"/>
<link href="../Styles/book.css" rel="stylesheet"/>
<script>alert(1)</script>
<iframe src="https://example.com"></iframe>
<p onclick="steal()">Careful.</p>
<base href="https://example.com/"/>
<meta http-equiv="refresh" content="0; url=https://example.com"/>
</body></html>`)

	write("OEBPS/Text/two.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>The end.</p></body></html>`)

	write("OEBPS/Images/cover.png", "not really a png, but it is what the manifest names")
	write("OEBPS/Styles/book.css", "p { color: red }")

	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestSpineReadsTheManifestPastTheMetadata(t *testing.T) {
	read, err := ReadSpine(makeEPUB(t, "small.epub"))
	if err != nil {
		t.Fatalf("ReadSpine: %v", err)
	}
	spine, ok := read.(Spine)
	if !ok {
		t.Fatalf("got %+v, want a reading order", read)
	}
	if spine.Title != "A Small Book" {
		t.Errorf("title = %q, want the one in the package file", spine.Title)
	}
	// The cover image is in the spine and is not a chapter.
	if len(spine.Chapters) != 2 {
		t.Fatalf("got %d chapters, want 2: %+v", len(spine.Chapters), spine.Chapters)
	}
	if spine.Chapters[0].Label != "The Beginning" {
		t.Errorf("label = %q, want the one the navigation gives", spine.Chapters[0].Label)
	}
	if spine.Chapters[0].File != "OEBPS/Text/one.xhtml" {
		t.Errorf("file = %q, want it under the package file's own folder", spine.Chapters[0].File)
	}
	// No title in the navigation for the second, so its own file name does.
	if spine.Chapters[1].Label != "two.xhtml" {
		t.Errorf("label = %q, want the file name", spine.Chapters[1].Label)
	}
}

func TestPartRewritesItsPicturesAndTakesTheWaysOut(t *testing.T) {
	path := makeEPUB(t, "small.epub")
	read, err := ReadPart(path, "a folder/small.epub", 0)
	if err != nil {
		t.Fatalf("ReadPart: %v", err)
	}
	part, ok := read.(Part)
	if !ok {
		t.Fatalf("got %+v, want a chapter", read)
	}
	if part.Count != 2 || part.I != 0 {
		t.Errorf("part %d of %d, want 0 of 2", part.I, part.Count)
	}
	if strings.Contains(part.HTML, "<head") || strings.Contains(part.HTML, "<title>") {
		t.Error("only the body of a chapter is sent; its head would land in the middle of ours")
	}

	// The picture and the stylesheet come back through this server, with the
	// ".." in their addresses already worked out.
	want := `src="/api/central/bookres?f=a%20folder/small.epub&p=OEBPS/Images/cover.png"`
	if !strings.Contains(part.HTML, want) {
		t.Errorf("wanted %s in:\n%s", want, part.HTML)
	}
	if !strings.Contains(part.HTML, "p=OEBPS/Styles/book.css") {
		t.Errorf("the stylesheet was not pointed inward:\n%s", part.HTML)
	}
	// A space is %20 and a slash is a slash, because that is what the address
	// the page reads back has always looked like.
	if strings.Contains(part.HTML, "a+folder") || strings.Contains(part.HTML, "%2F") {
		t.Errorf("the address is quoted the wrong way:\n%s", part.HTML)
	}

	for _, gone := range []string{
		"href=\"two.xhtml\"", "https://example.com", "target=", "<script", "<iframe",
		"onclick=", "<base", "http-equiv",
	} {
		if strings.Contains(part.HTML, gone) {
			t.Errorf("%q should have come out of the chapter:\n%s", gone, part.HTML)
		}
	}
	// The words stay. Only the destinations go.
	for _, kept := range []string{"Hello", "there", "away", "Careful."} {
		if !strings.Contains(part.HTML, kept) {
			t.Errorf("%q should still be readable:\n%s", kept, part.HTML)
		}
	}
}

func TestPartPastTheEnd(t *testing.T) {
	path := makeEPUB(t, "small.epub")
	for _, i := range []int{-1, 2, 999} {
		read, err := ReadPart(path, "small.epub", i)
		if err != nil {
			t.Fatalf("ReadPart(%d): %v", i, err)
		}
		fail, ok := read.(Fail)
		if !ok || fail.Error != "No such chapter." {
			t.Errorf("ReadPart(%d) = %+v, want no such chapter", i, read)
		}
	}
}

func TestCoverIsTheOneTheBookNames(t *testing.T) {
	raw, mime := Cover(makeEPUB(t, "small.epub"))
	if len(raw) == 0 {
		t.Fatal("no cover came back")
	}
	if mime != "image/png" {
		t.Errorf("type = %q, want image/png", mime)
	}
	if !strings.Contains(string(raw), "what the manifest names") {
		t.Errorf("that is not the cover: %q", raw)
	}
}

// The bug this catches: a package file's <meta name="cover"> sits in
// <metadata>, which always comes before <manifest> in a real EPUB, so a
// single pass that tries to look the id up in the manifest as it goes finds
// nothing there yet -- and silently falls back to the first image in the
// manifest instead, real cover or not. Real books from at least one common
// source list a one-pixel spacer before the actual cover, which is how this
// was found: every cover on the shelf was that spacer, not the book.
func TestCoverIsTheMarkedOneNotJustTheFirstImage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "decoy.epub")
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	z := zip.NewWriter(f)
	write := func(name, body string) {
		w, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	write("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)
	write("content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Decoy</dc:title>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="spacer" href="spacer.jpg" media-type="image/jpeg"/>
    <item id="one" href="one.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-img" href="cover.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine><itemref idref="one"/></spine>
</package>`)
	write("one.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hi.</p></body></html>`)
	write("spacer.jpg", "one pixel, not the cover")
	write("cover.jpg", "the actual cover")
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	f.Close()

	raw, mime := Cover(path)
	if len(raw) == 0 {
		t.Fatal("no cover came back")
	}
	if mime != "image/jpeg" {
		t.Errorf("type = %q, want image/jpeg", mime)
	}
	if string(raw) != "the actual cover" {
		t.Errorf("got %q, want the book's marked cover, not the first image in the manifest", raw)
	}
}

func TestNotAnEPUB(t *testing.T) {
	path := filepath.Join(t.TempDir(), "notabook.epub")
	if err := os.WriteFile(path, []byte("this is not a zip"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadSpine(path); err == nil {
		t.Error("a file that will not open at all is this server's problem to report")
	}
	if raw, _ := Cover(path); raw != nil {
		t.Error("there is no cover in a file that is not a book")
	}
}

func TestAtStaysInsideTheBooksFolder(t *testing.T) {
	root := t.TempDir()
	inner := filepath.Join(root, "sub")
	if err := os.MkdirAll(inner, 0o755); err != nil {
		t.Fatal(err)
	}
	book := filepath.Join(inner, "one.pdf")
	if err := os.WriteFile(book, []byte("%PDF-1.4"), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(filepath.Dir(root), "secret.pdf")
	if err := os.WriteFile(outside, []byte("%PDF-1.4"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.Remove(outside) })

	path, rel, err := At(root, "sub/one.pdf")
	if err != nil {
		t.Fatalf("At: %v", err)
	}
	if rel != "sub/one.pdf" {
		t.Errorf("rel = %q, want the path under the folder with forward slashes", rel)
	}
	if filepath.Base(path) != "one.pdf" {
		t.Errorf("path = %q", path)
	}

	for _, name := range []string{"../secret.pdf", "sub/../../secret.pdf", "sub", "nope.pdf"} {
		if _, _, err := At(root, name); err == nil {
			t.Errorf("At(%q) should have been refused", name)
		}
	}
	// A .txt in the books folder is not a book, however real the file is.
	notabook := filepath.Join(root, "notes.txt")
	if err := os.WriteFile(notabook, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, _, err := At(root, "notes.txt"); err == nil {
		t.Error("only PDFs and EPUBs are books")
	}
}

func TestQuoteIsPythons(t *testing.T) {
	for _, at := range []struct{ in, want string }{
		{"a folder/one.pdf", "a%20folder/one.pdf"},
		{"(x), y", "%28x%29%2C%20y"},
		{"keep_me-.~", "keep_me-.~"},
		{"生词.epub", "%E7%94%9F%E8%AF%8D.epub"},
	} {
		if got := Quote(at.in); got != at.want {
			t.Errorf("Quote(%q) = %q, want %q", at.in, got, at.want)
		}
	}
}
