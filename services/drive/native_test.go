package blakroles

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	userpb "github.com/cs3org/go-cs3apis/cs3/identity/user/v1beta1"
	provider "github.com/cs3org/go-cs3apis/cs3/storage/provider/v1beta1"
	typespb "github.com/cs3org/go-cs3apis/cs3/types/v1beta1"
	ctxpkg "github.com/opencloud-eu/reva/v2/pkg/ctx"
)

func TestNativeOwnerPermissionsFollowDirectoryDowngrade(t *testing.T) {
	store := Store{Path: filepath.Join(t.TempDir(), "roles.json")}
	t.Setenv("BLAK_DRIVE_ROLES", "true")
	t.Setenv("BLAK_DRIVE_ROLES_FILE", store.Path)
	oldIDs := NativeRoleIDs
	NativeRoleIDs = map[string]string{"reader": "native-reader", "writer": "native-user", "admin": "native-space-admin"}
	defer func() { NativeRoleIDs = oldIDs }()
	user := &userpb.User{
		Id: &userpb.UserId{OpaqueId: "native-id", Type: userpb.UserType_USER_TYPE_PRIMARY}, Username: "immutable",
		Opaque: &typespb.Opaque{Map: map[string]*typespb.OpaqueEntry{"roles": {Decoder: "json", Value: []byte(`["old-server-admin"]`)}}},
	}
	ctx := ctxpkg.ContextSetUser(context.Background(), user)
	owner := &provider.ResourcePermissions{Stat: true, GetPath: true, InitiateFileDownload: true,
		InitiateFileUpload: true, Delete: true, AddGrant: true, UpdateGrant: true, Move: true}
	member := Member{Subject: user.Username, Role: "reader", Active: true}
	if err := store.Write([]Member{member}); err != nil {
		t.Fatal(err)
	}
	current, err := Normalize(ctx)
	if err != nil {
		t.Fatal(err)
	}
	normalized, _ := ctxpkg.ContextGetUser(current)
	var roles []string
	if err := json.Unmarshal(normalized.Opaque.Map["roles"].Value, &roles); err != nil || len(roles) != 1 || roles[0] != "native-reader" {
		t.Fatal("stale global authority survived normalization")
	}
	if string(user.Opaque.Map["roles"].Value) != `["old-server-admin"]` {
		t.Fatal("normalization mutated the shared user cache")
	}
	capped, err := CapPermissions(ctx, owner)
	if err != nil || !capped.Stat || !capped.InitiateFileDownload || capped.InitiateFileUpload || capped.Delete || capped.AddGrant || capped.UpdateGrant || capped.Move {
		t.Fatal("reader did not retain only native reads")
	}
	if !owner.InitiateFileUpload || !owner.Delete {
		t.Fatal("permission cap mutated a shared ACL")
	}
	if RequireWrite(ctx) == nil {
		t.Fatal("old writer context bypassed the downgrade")
	}
	member.Role = "writer"
	if err := store.Write([]Member{member}); err != nil {
		t.Fatal(err)
	}
	if RequireWrite(ctx) != nil {
		t.Fatal("restored writer cannot write")
	}
	denied, err := CapPermissions(ctx, &provider.ResourcePermissions{})
	if err != nil || denied.Stat || denied.InitiateFileUpload {
		t.Fatal("app role expanded the native object ACL")
	}
	member.Active = false
	if err := store.Write([]Member{member}); err != nil {
		t.Fatal(err)
	}
	if RequireRead(ctx) == nil || RequireWrite(ctx) == nil {
		t.Fatal("disabled identity retained native authority")
	}
	if _, err := CapPermissions(ctx, owner); err == nil {
		t.Fatal("disabled owner retained file permissions")
	}
}

func TestHTTPRoleCapsCannotReachDirectoryOrServerMutations(t *testing.T) {
	for _, role := range []string{"reader", "writer", "admin"} {
		for _, target := range []string{"/graph/v1.0/users", "/graph/v1.0/users/owner", "/graph/v1.0/groups", "/api/v0/settings/roles-assign", "/graph/v1.0/drives/../../users"} {
			for _, method := range []string{"POST", "PATCH", "DELETE"} {
				if HTTPAllowed(role, method, target) {
					t.Fatalf("%s can %s %s", role, method, target)
				}
			}
		}
		if !HTTPAllowed(role, "PROPFIND", "/dav/spaces/owned/file") {
			t.Fatal("native DAV reads denied")
		}
		if !HTTPAllowed(role, "POST", "/api/v0/settings/values-list") {
			t.Fatal("native current-user preference reads denied")
		}
	}
	if HTTPAllowed("reader", "PUT", "/dav/spaces/owned/file") {
		t.Fatal("reader retains owned-file writes")
	}
	if !HTTPAllowed("writer", "PUT", "/dav/spaces/owned/file") {
		t.Fatal("writer cannot write content")
	}
	if HTTPAllowed("writer", "DELETE", "/graph/v1.0/drives/space") {
		t.Fatal("writer can delete managed space")
	}
	if !HTTPAllowed("admin", "DELETE", "/graph/v1.0/drives/space") {
		t.Fatal("admin cannot manage native space")
	}
	if HTTPAllowed("owner", "PUT", "/dav/spaces/owned/file") || HTTPAllowed("writer", "CONNECT", "/dav/spaces/owned/file") {
		t.Fatal("unknown roles or methods accepted")
	}
}
