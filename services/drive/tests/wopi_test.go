package middleware_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"

	app "github.com/cs3org/go-cs3apis/cs3/app/provider/v1beta1"
	users "github.com/cs3org/go-cs3apis/cs3/identity/user/v1beta1"
	storage "github.com/cs3org/go-cs3apis/cs3/storage/provider/v1beta1"
	"github.com/opencloud-eu/opencloud/services/collaboration/pkg/config"
	"github.com/opencloud-eu/opencloud/services/collaboration/pkg/helpers"
	"github.com/opencloud-eu/opencloud/services/collaboration/pkg/middleware"
	"github.com/opencloud-eu/reva/v2/pkg/blakroles"
	jwt "github.com/opencloud-eu/reva/v2/pkg/token/manager/jwt"
)

// Exercise actual signed WOPI and native JWT validation with an already-issued
// editor token; helper-only tests cannot prove the middleware consumes live roles.
func TestBlakActiveDocsSessionFollowsCurrentDirectory(t *testing.T) {
	t.Setenv("BLAK_DRIVE_ROLES", "true")
	store := blakroles.Store{Path: filepath.Join(t.TempDir(), "roles.json")}
	t.Setenv("BLAK_DRIVE_ROLES_FILE", store.Path)
	member := blakroles.Member{Subject: "frozen-owner", Role: "writer", Active: true}
	write := func() {
		t.Helper()
		if err := store.Write([]blakroles.Member{member}); err != nil {
			t.Fatal(err)
		}
	}
	write()
	cfg := &config.Config{TokenManager: &config.TokenManager{JWTSecret: "test-native-secret"},
		Wopi: config.Wopi{Secret: "test-wopi-secret", WopiSrc: "https://docs.invalid"}}
	manager, err := jwt.New(map[string]any{"secret": cfg.TokenManager.JWTSecret, "expires": int64(3600)})
	if err != nil {
		t.Fatal(err)
	}
	user := &users.User{Id: &users.UserId{OpaqueId: "native-owner", Type: users.UserType_USER_TYPE_PRIMARY}, Username: member.Subject}
	nativeToken, err := manager.MintToken(context.Background(), user, nil)
	if err != nil {
		t.Fatal(err)
	}
	rid := &storage.ResourceId{StorageId: "storage", SpaceId: "space", OpaqueId: "file"}
	wopiToken, _, err := middleware.GenerateWopiToken(middleware.WopiContext{
		AccessToken: nativeToken, ViewMode: app.ViewMode_VIEW_MODE_READ_WRITE,
		FileReference: &storage.Reference{ResourceId: rid, Path: "."},
	}, cfg, nil)
	if err != nil {
		t.Fatal(err)
	}
	mode := app.ViewMode_VIEW_MODE_INVALID
	handler := middleware.WopiContextAuthMiddleware(cfg, nil, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		current, err := middleware.WopiContextFromCtx(r.Context())
		if err != nil {
			t.Fatal(err)
		}
		mode = current.ViewMode
		w.WriteHeader(http.StatusNoContent)
	}))
	request := func(method, override string) int {
		t.Helper()
		r := httptest.NewRequest(method, "https://docs.invalid/wopi/files/"+helpers.HashResourceId(rid)+"?access_token="+url.QueryEscape(wopiToken), nil)
		r.Header.Set("X-WOPI-Override", override)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, r)
		return response.Code
	}
	if request("POST", "PUT") != http.StatusNoContent {
		t.Fatal("writer cannot use native editor token")
	}
	member.Role = "reader"
	write()
	for _, override := range []string{"PUT", "LOCK", "REFRESH_LOCK", "RENAME_FILE", "PUT_RELATIVE"} {
		if got := request("POST", override); got != http.StatusForbidden {
			t.Fatalf("downgraded writer retained %s: %d", override, got)
		}
	}
	if request("GET", "") != http.StatusNoContent || mode != app.ViewMode_VIEW_MODE_READ_ONLY {
		t.Fatal("existing editor token did not become read-only")
	}
	if request("POST", "GET_LOCK") != http.StatusNoContent {
		t.Fatal("reader lock inspection denied")
	}
	member.Role = "writer"
	write()
	if request("POST", "PUT") != http.StatusNoContent {
		t.Fatal("restored writer cannot save")
	}
	member.Active = false
	write()
	if request("GET", "") != http.StatusUnauthorized {
		t.Fatal("disabled account retained signed WOPI access")
	}
}
