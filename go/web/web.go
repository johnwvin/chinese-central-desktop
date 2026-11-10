// Package web serves the built desktop interface and its assets.
package web

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// dist is the built app. The .keep file inside it is committed so this
// compiles from a checkout where nobody has run a build yet.
//
//go:embed all:dist
var dist embed.FS

// The addresses the React app has pages for. Add one here as its page lands.
var owned = map[string]bool{
	"/": true, // the tab strip: the app itself

	"/home":   true,
	"/pinyin": true,

	"/books": true,
	"/notes": true,

	"/games":      true,
	"/hsk":        true,
	"/dictionary": true,
	// The reader. A book is named in the query, which is the browser's to
	// read, so the address itself is all this has to own.
	"/books/read": true,
	"/control":    true,
	"/source":     true,
	// The frequency list, which is a page of its own rather than a tab: it is
	// about the language rather than about one word, and nothing on it needs
	// whatever the dictionary happens to be showing.
	"/dictionary/ranks": true,
	// The favourites, a page of their own for the same reason.
	"/dictionary/favorites": true,
}

// Built says whether there is a real app in here, or only the placeholder.
func Built() bool {
	_, err := fs.Stat(dist, "dist/index.html")
	return err == nil
}

// Owns says whether the React app answers for this address.
func Owns(urlPath string) bool {
	if owned[urlPath] {
		return true
	}
	// Its own files: /assets/..., the favicon, anything the build wrote.
	root, err := fs.Sub(dist, "dist")
	if err != nil {
		return false
	}
	name := strings.TrimPrefix(path.Clean(urlPath), "/")
	if name == "" || name == "." {
		return true
	}
	info, err := fs.Stat(root, name)
	return err == nil && !info.IsDir()
}

// Handler serves the app: its own files, and index.html for the addresses it
// owns, because which page that is gets decided in the browser.
func Handler() http.Handler {
	root, err := fs.Sub(dist, "dist")
	if err != nil {
		return http.NotFoundHandler()
	}
	files := http.FileServer(http.FS(root))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" || name == "." {
			name = "index.html"
		}
		if info, err := fs.Stat(root, name); err != nil || info.IsDir() {
			index, err := fs.ReadFile(root, "index.html")
			if err != nil {
				http.NotFound(w, r)
				return
			}
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(index)
			return
		}
		files.ServeHTTP(w, r)
	})
}
