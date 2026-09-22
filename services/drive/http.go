package blakroles

import (
	"net/http"
	pathpkg "path"
	"strings"

	ctxpkg "github.com/opencloud-eu/reva/v2/pkg/ctx"
)

func Controller(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if Enabled() && r.URL.Path == "/blak/roles/reconcile" {
			Directory().Reconcile(w, r)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func HTTPAllowed(role, method, path string) bool {
	switch role {
	case "reader", "writer", "admin", "system":
	default:
		return false
	}
	if clean := pathpkg.Clean(path); clean != path && clean+"/" != path {
		return false
	}
	if role == "system" {
		return true
	}
	if method == http.MethodGet || method == http.MethodHead || method == http.MethodOptions {
		for _, prefix := range []string{"/graph/v1.0/", "/ocs/", "/dav/", "/remote.php/dav/", "/data/", "/api/v0/settings/", "/search", "/app/", "/thumbnails/", "/avatars/"} {
			if strings.HasPrefix(path, prefix) {
				return true
			}
		}
	}
	dav := strings.HasPrefix(path, "/dav/") || strings.HasPrefix(path, "/remote.php/dav/")
	if dav && (method == "PROPFIND" || method == "REPORT" || method == "SEARCH") {
		return true
	}
	if method == http.MethodPost && (path == "/app/open" || path == "/graph/v1.0/search/query") {
		return true
	}
	if method == http.MethodPost {
		switch path {
		case "/api/v0/settings/bundle-get", "/api/v0/settings/bundles-list",
			"/api/v0/settings/values-list", "/api/v0/settings/values-get-by-unique-identifiers",
			"/api/v0/settings/roles-list":
			return true // Read RPCs; native filters and current-user checks still apply.
		}
	}
	if role == "reader" {
		return false
	}
	switch method {
	case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete, "MKCOL", "MOVE", "COPY", "PROPPATCH", "LOCK", "UNLOCK":
	default:
		return false
	}
	if path == "/graph/v1.0/drives" || path == "/graph/v1.0/drives/" {
		return role == "admin" && method == http.MethodPost
	}
	if strings.HasPrefix(path, "/graph/v1.0/drives/") {
		parts := strings.Split(strings.Trim(path[len("/graph/v1.0/drives/"):], "/"), "/")
		if len(parts) == 1 {
			return role == "admin" && (method == http.MethodPatch || method == http.MethodDelete)
		}
		return true // Native item ACLs and storage caps still apply.
	}
	return dav || strings.HasPrefix(path, "/data/") || strings.HasPrefix(path, "/graph/v1.0/me/drive/") ||
		strings.HasPrefix(path, "/ocs/v1.php/apps/files_sharing/") || strings.HasPrefix(path, "/ocs/v2.php/apps/files_sharing/") ||
		method == http.MethodPost && path == "/app/new"
}

// This runs inside the native proxy after authentication and account resolution.
// The storage and JWT hooks independently enforce current authority downstream.
func GateHTTP(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !Enabled() {
			next.ServeHTTP(w, r)
			return
		}
		user, _ := ctxpkg.ContextGetUser(r.Context())
		if user == nil { // Public assets retain the native router's authentication rules.
			next.ServeHTTP(w, r)
			return
		}
		if !HTTPAllowed(UserRole(user), r.Method, r.URL.Path) {
			http.Error(w, "Blak ID does not grant this Drive operation", http.StatusForbidden)
			return
		}
		ctx, err := Normalize(r.Context())
		if err != nil {
			http.Error(w, "Blak ID does not grant Drive access", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
