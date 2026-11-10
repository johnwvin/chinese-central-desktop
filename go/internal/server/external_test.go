package server

import "testing"

func TestGoogleSearchURL(t *testing.T) {
	got, ok := googleSearchURL("https://www.google.com/search?q=%E6%B1%89%E5%AD%97")
	if !ok || got != "https://www.google.com/search?q=%E6%B1%89%E5%AD%97" {
		t.Fatalf("Google search: %q, %v", got, ok)
	}
	for _, bad := range []string{
		"http://www.google.com/search?q=test",
		"https://evil.example/search?q=test",
		"https://www.google.com.evil.example/search?q=test",
		"https://www.google.com/other?q=test",
		"https://www.google.com/search",
	} {
		if got, ok := googleSearchURL(bad); ok {
			t.Errorf("accepted %q as %q", bad, got)
		}
	}
}
