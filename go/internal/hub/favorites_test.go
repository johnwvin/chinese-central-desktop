package hub

import (
	"errors"
	"os"
	"testing"
)

func TestStarringAWordPutsItFirst(t *testing.T) {
	h := newHub(t)

	if _, err := h.SetFavorite(Favorite{S: "行", P: "xíng", D: "to walk"}, true); err != nil {
		t.Fatalf("SetFavorite: %v", err)
	}
	list, err := h.SetFavorite(Favorite{S: "好", P: "hǎo", D: "good"}, true)
	if err != nil {
		t.Fatalf("SetFavorite: %v", err)
	}
	if len(list) != 2 || list[0].S != "好" || list[1].S != "行" {
		t.Fatalf("want 好 then 行, got %+v", list)
	}
	if list[0].At == "" {
		t.Error("a favourite with no date on it cannot be sorted by date")
	}
	if again := h.Favorites(); len(again) != 2 {
		t.Errorf("the file holds %d favourites, want 2", len(again))
	}
}

func TestStarringAgainKeepsTheFirstDate(t *testing.T) {
	h := newHub(t)
	seeded, _ := marshalPlain([]Favorite{{S: "行", P: "xíng", At: "2020-01-02T03:04:05"}})
	if err := os.WriteFile(h.favoritesPath(), seeded, 0o644); err != nil {
		t.Fatal(err)
	}

	list, err := h.SetFavorite(Favorite{S: "行", P: "xíng"}, true)
	if err != nil {
		t.Fatalf("SetFavorite: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("got %d favourites, want 1 -- a starred word starred again is still one", len(list))
	}
	if list[0].At != "2020-01-02T03:04:05" {
		t.Errorf("date became %q; starring it again added nothing", list[0].At)
	}
}

func TestAReadingIsItsOwnFavorite(t *testing.T) {
	h := newHub(t)
	h.SetFavorite(Favorite{S: "行", P: "háng"}, true)
	h.SetFavorite(Favorite{S: "行", P: "xíng"}, true)

	list, err := h.SetFavorite(Favorite{S: "行", P: "háng"}, false)
	if err != nil {
		t.Fatalf("SetFavorite: %v", err)
	}
	if len(list) != 1 || list[0].P != "xíng" {
		t.Fatalf("taking háng off should leave xíng, got %+v", list)
	}

	// The same reading written with different spacing is the same favourite.
	h.SetFavorite(Favorite{S: "一样", P: "yī yàng"}, true)
	list, _ = h.SetFavorite(Favorite{S: "一样", P: "yīyàng"}, false)
	if len(list) != 1 {
		t.Errorf("yī yàng and yīyàng are one reading, got %+v", list)
	}
}

func TestNothingToStarIsRefused(t *testing.T) {
	h := newHub(t)
	if _, err := h.SetFavorite(Favorite{S: "  "}, true); !errors.Is(err, ErrNoWord) {
		t.Fatalf("err = %v, want ErrNoWord", err)
	}
	if n := len(h.Favorites()); n != 0 {
		t.Errorf("a refused star wrote %d favourites", n)
	}
}
