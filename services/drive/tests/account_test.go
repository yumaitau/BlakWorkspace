package middleware

import (
 "net/http"
 "path/filepath"
 "testing"

 "github.com/opencloud-eu/opencloud/pkg/log"
 "github.com/opencloud-eu/opencloud/pkg/oidc"
 "github.com/opencloud-eu/reva/v2/pkg/blakroles"
)

func TestRevokedOIDCSubjectDeniedBeforeTokenCreation(t *testing.T) {
 store := blakroles.Store{Path: filepath.Join(t.TempDir(), "roles.json")}
 t.Setenv("BLAK_DRIVE_ROLES", "true")
 t.Setenv("BLAK_DRIVE_ROLES_FILE", store.Path)
 for _, member := range []blakroles.Member{
  {Subject: "immutable", Role: "writer", Active: false},
  {Subject: "immutable", Role: "", Active: true},
 } {
  if err := store.Write([]blakroles.Member{member}); err != nil { t.Fatal(err) }
  // No backend is installed: touching it would panic. Revocation must be
  // resolved before native token minting or JIT provisioning.
  handler := AccountResolver(Logger(log.NewLogger()), UserOIDCClaim("sub"), UserCS3Claim("username"))(mockHandler{})
  req, response := mockRequest(map[string]any{oidc.Iss: testIdP, "sub": "immutable"})
  handler.ServeHTTP(response, req)
  if response.Code != http.StatusForbidden { t.Fatalf("revoked subject: got %d", response.Code) }
 }
}
