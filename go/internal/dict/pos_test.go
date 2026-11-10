package dict

import (
	"strings"
	"testing"
)

func TestEntryCluesReadWhatTheEntrySays(t *testing.T) {
	cases := []struct {
		defs    string
		want    string
		pointer bool
	}{
		{"(bound form) to walk; to go/(literary) trip", "verb", false},
		{"table; desk/CL:張|张[zhang1],套[tao4]", "noun", false},
		{"row; line/classifier for rows", "measure", false},
		{"surname Zhong", "surname", false},
		{"(idiom) to kill two birds with one stone", "idiom,verb", false},
		{"see 道行[dao4 heng2]", "", true},
		{"erhua variant of 一下[yi1 xia4]", "", true},
		{"abbr. for 北京大学[Bei3 jing1 Da4 xue2]", "", false},
		{"aspect particle indicating action in progress or ongoing state", "particle", false},
		{`(question particle for "yes-no" questions)`, "particle", false},
		{"(experienced action marker)", "particle", false},
		{"(modal particle indicating suggestion or surmise)/...right?", "modal", false},
		{"interjection of surprise/Ah!/Oh!", "interjection", false},
		// A particle in physics is not a grammatical one.
		{"elementary particle", "", false},
	}
	for _, c := range cases {
		keys, pointer := entryClues(c.defs)
		if got := strings.Join(keys, ","); got != c.want || pointer != c.pointer {
			t.Errorf("%q: got %q pointer=%v, want %q pointer=%v", c.defs, got, pointer, c.want, c.pointer)
		}
	}
}

// Each reading gets its own part of speech, from the real dictionary and the
// real word lists.
