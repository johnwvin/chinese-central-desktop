package server

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"sync"

	"chinese-central/internal/prefs"
)

type hskReview struct {
	Due    float64 `json:"due"`
	Streak int     `json:"streak"`
	Seen   int     `json:"seen"`
	Known  bool    `json:"known"`
}

type hskStudy struct {
	Statuses map[string]string    `json:"statuses"`
	Progress map[string]hskReview `json:"progress"`
}

var hskStudyMu sync.Mutex

func (s *Server) apiHSKStudy(w http.ResponseWriter, r *http.Request) {
	hskStudyMu.Lock()
	defer hskStudyMu.Unlock()

	file := prefs.File{Path: filepath.Join(s.layout.Data, "hsk-study.json")}
	state := hskStudy{Statuses: map[string]string{}, Progress: map[string]hskReview{}}
	if err := json.Unmarshal(file.Read(), &state); err != nil || state.Statuses == nil || state.Progress == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not read HSK study data."})
		return
	}
	if r.Method == http.MethodPost {
		var patch struct {
			hskStudy
			FillMissing bool `json:"fillMissing"`
		}
		if err := decode(r, &patch); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid HSK study data."})
			return
		}
		for id, status := range patch.Statuses {
			if id == "" || (status != "review" && status != "unlearned" && status != "memorized") {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid HSK study status."})
				return
			}
			if _, exists := state.Statuses[id]; !patch.FillMissing || !exists {
				state.Statuses[id] = status
			}
		}
		for id, review := range patch.Progress {
			if id == "" || review.Due < 0 || review.Streak < 0 || review.Seen < 0 {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invalid HSK review history."})
				return
			}
			if _, exists := state.Progress[id]; !patch.FillMissing || !exists {
				state.Progress[id] = review
			}
		}
		raw, err := json.Marshal(state)
		if err != nil || file.Merge(raw) != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "Could not save HSK study data."})
			return
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, state)
}
