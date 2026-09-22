package blakroles

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// The directory controller owns this snapshot. OIDC tokens never grant a role.
type Member struct {
	Subject string `json:"subject"`
	Role    string `json:"role"`
	Active  bool   `json:"active"`
}

type Snapshot struct {
	UpdatedAt time.Time `json:"updated_at"`
	Members   []Member  `json:"members"`
}

type Store struct {
	Path  string
	Token string
	Now   func() time.Time
}

const maxSnapshotAge = 3 * time.Minute

func validate(members []Member) error {
	if len(members) == 0 {
		return errors.New("complete directory snapshot required")
	}
	seen := make(map[string]bool, len(members))
	for _, member := range members {
		if member.Subject == "" || strings.TrimSpace(member.Subject) != member.Subject || len(member.Subject) > 256 || seen[member.Subject] {
			return errors.New("invalid or duplicate immutable subject")
		}
		seen[member.Subject] = true
		switch member.Role {
		case "", "reader", "writer", "admin":
		default:
			return errors.New("unknown Drive role")
		}
	}
	return nil
}

func (s Store) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s Store) Read() (Snapshot, error) {
	var snapshot Snapshot
	data, err := os.ReadFile(s.Path)
	if err != nil {
		return snapshot, err
	}
	if err = json.Unmarshal(data, &snapshot); err != nil {
		return snapshot, err
	}
	if err = validate(snapshot.Members); err != nil {
		return snapshot, err
	}
	age := s.now().Sub(snapshot.UpdatedAt)
	if age < 0 || age > maxSnapshotAge {
		return snapshot, errors.New("Drive directory snapshot is not current")
	}
	return snapshot, nil
}

// Role uses the native immutable username, which OpenCloud provisions from sub.
// Missing, disabled, expired and malformed authority all deny access.
func (s Store) Role(subject string) string {
	snapshot, err := s.Read()
	if err != nil {
		return ""
	}
	for _, member := range snapshot.Members {
		if member.Subject == subject && member.Active {
			return member.Role
		}
	}
	return ""
}

func (s Store) Write(members []Member) error {
	if err := validate(members); err != nil {
		return err
	}
	data, err := json.Marshal(Snapshot{UpdatedAt: s.now().UTC(), Members: members})
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(s.Path), ".blak-roles-*")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if _, err = file.Write(data); err != nil {
		return err
	}
	if err = file.Sync(); err != nil {
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), s.Path)
}

// Reconcile is mounted inside the native server, before human authentication.
// Its bearer credential is separate from every human session and app role.
func (s Store) Reconcile(w http.ResponseWriter, r *http.Request) {
	expected := "Bearer " + s.Token
	if len(s.Token) < 32 || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte(expected)) != 1 {
		http.Error(w, "Directory controller required", http.StatusForbidden)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	var request struct {
		Members []Member `json:"members"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		http.Error(w, "Invalid directory snapshot", http.StatusBadRequest)
		return
	}
	var extra any
	if decoder.Decode(&extra) != io.EOF || validate(request.Members) != nil {
		http.Error(w, "Invalid directory snapshot", http.StatusBadRequest)
		return
	}
	if err := s.Write(request.Members); err != nil {
		http.Error(w, "Directory reconciliation unavailable", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "members": len(request.Members)})
}
