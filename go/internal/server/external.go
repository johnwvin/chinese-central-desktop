package server

import (
	"net/http"
	"net/url"
	"os/exec"
	"runtime"
)

// A Tauri webview is not the user's browser. Explicit external searches go
// through the OS instead of relying on window.open/pop-up handling.
func (s *Server) apiOpenExternal(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("X-CC-Desktop") != "1" {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Desktop request required"})
		return
	}
	var request struct {
		URL string `json:"url"`
	}
	if decode(r, &request) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid URL request"})
		return
	}
	address, ok := googleSearchURL(request.URL)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Only Google searches can be opened here"})
		return
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", address)
	case "darwin":
		cmd = exec.Command("open", address)
	default:
		cmd = exec.Command("xdg-open", address)
	}
	if err := cmd.Start(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not open your browser"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func googleSearchURL(raw string) (string, bool) {
	if len(raw) > 4000 {
		return "", false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Host != "www.google.com" || u.Path != "/search" || u.User != nil {
		return "", false
	}
	query := u.Query().Get("q")
	if query == "" || len(query) > 2000 {
		return "", false
	}
	return "https://www.google.com/search?q=" + url.QueryEscape(query), true
}
