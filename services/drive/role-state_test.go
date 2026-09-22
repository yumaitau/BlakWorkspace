package blakroles

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func testStore(t *testing.T) (Store, *time.Time) {
	t.Helper()
	now := time.Date(2026, 9, 22, 0, 0, 0, 0, time.UTC)
	return Store{Path: filepath.Join(t.TempDir(), "roles.json"), Token: strings.Repeat("fixture", 8), Now: func() time.Time { return now }}, &now
}

func TestExistingIdentityFollowsCurrentDirectoryAuthority(t *testing.T) {
	store, now := testStore(t)
	member := Member{Subject: "immutable-subject", Role: "writer", Active: true}
	for _, role := range []string{"writer", "reader", "admin", ""} {
		member.Role = role
		if err := store.Write([]Member{member}); err != nil {
			t.Fatal(err)
		}
		if got := store.Role(member.Subject); got != role {
			t.Fatalf("role = %q, want %q", got, role)
		}
	}
	member.Role, member.Active = "admin", false
	if err := store.Write([]Member{member}); err != nil {
		t.Fatal(err)
	}
	if store.Role(member.Subject) != "" {
		t.Fatal("disabled identity retained authority")
	}
	member.Active = true
	if err := store.Write([]Member{member}); err != nil {
		t.Fatal(err)
	}
	if store.Role("renamed-display-name") != "" {
		t.Fatal("mutable identity gained authority")
	}
	*now = now.Add(maxSnapshotAge + time.Second)
	if store.Role(member.Subject) != "" {
		t.Fatal("stale directory retained authority")
	}
	*now = now.Add(-maxSnapshotAge - 2*time.Second)
	if store.Role(member.Subject) != "" {
		t.Fatal("future directory retained authority")
	}
}

func TestInvalidSnapshotDoesNotReplaceCurrentAuthority(t *testing.T) {
	store, _ := testStore(t)
	member := Member{Subject: "immutable", Role: "reader", Active: true}
	if err := store.Write([]Member{member}); err != nil {
		t.Fatal(err)
	}
	for _, members := range [][]Member{nil, {member, member}, {{Subject: "immutable", Role: "owner", Active: true}}, {{Subject: " "}}} {
		if store.Write(members) == nil {
			t.Fatal("invalid snapshot accepted")
		}
		if store.Role(member.Subject) != "reader" {
			t.Fatal("invalid snapshot changed existing grant")
		}
	}
	info, err := os.Stat(store.Path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("snapshot must remain private")
	}
	if err := os.WriteFile(store.Path, []byte("broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if store.Role(member.Subject) != "" {
		t.Fatal("corrupt authority did not fail closed")
	}
}

func TestOnlyControllerCanReplaceCompleteSnapshot(t *testing.T) {
	store, _ := testStore(t)
	valid := `{"members":[{"subject":"immutable","role":"writer","active":true}]}`
	for _, item := range []struct {
		token, body string
		want        int
	}{
		{"human-session", valid, http.StatusForbidden},
		{store.Token, `{"members":[]}`, http.StatusBadRequest},
		{store.Token, valid + `{}`, http.StatusBadRequest},
		{store.Token, `{"members":[],"extra":true}`, http.StatusBadRequest},
		{store.Token, valid, http.StatusOK},
	} {
		r := httptest.NewRequest(http.MethodPost, "/blak/roles/reconcile", strings.NewReader(item.body))
		r.Header.Set("Authorization", "Bearer "+item.token)
		w := httptest.NewRecorder()
		store.Reconcile(w, r)
		if w.Code != item.want {
			t.Fatalf("status %d, want %d", w.Code, item.want)
		}
	}
	if store.Role("immutable") != "writer" {
		t.Fatal("controller grant missing")
	}
}
