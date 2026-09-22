package blakroles

import (
	"context"
	"encoding/json"
	"errors"
	"os"

	userpb "github.com/cs3org/go-cs3apis/cs3/identity/user/v1beta1"
	provider "github.com/cs3org/go-cs3apis/cs3/storage/provider/v1beta1"
	typespb "github.com/cs3org/go-cs3apis/cs3/types/v1beta1"
	ctxpkg "github.com/opencloud-eu/reva/v2/pkg/ctx"
	"github.com/opencloud-eu/reva/v2/pkg/errtypes"
	"google.golang.org/protobuf/proto"
)

// The build generates these IDs from the pinned native role definitions.
var NativeRoleIDs map[string]string

func Enabled() bool { return os.Getenv("BLAK_DRIVE_ROLES") == "true" }

func Directory() Store {
	return Store{Path: os.Getenv("BLAK_DRIVE_ROLES_FILE"), Token: os.Getenv("BLAK_DRIVE_ROLE_TOKEN")}
}

func UserRole(user *userpb.User) string {
	if user == nil || user.GetId() == nil {
		return ""
	}
	// Only native service tokens can carry this type; OIDC creates primary users.
	if user.GetId().GetType() == userpb.UserType_USER_TYPE_SERVICE {
		return "system"
	}
	return Directory().Role(user.GetUsername())
}

func CurrentRole(ctx context.Context) string {
	user, _ := ctxpkg.ContextGetUser(ctx)
	return UserRole(user)
}

func RequireRead(ctx context.Context) error {
	if Enabled() && CurrentRole(ctx) == "" {
		return errtypes.PermissionDenied("Blak ID does not grant Drive access")
	}
	return nil
}

func RequireWrite(ctx context.Context) error {
	if Enabled() {
		switch CurrentRole(ctx) {
		case "writer", "admin", "system":
		default:
			return errtypes.PermissionDenied("Blak ID does not grant Drive writes")
		}
	}
	return nil
}

// Normalize replaces stale global roles before native ACL evaluation. It never
// mutates a user object shared by another request or the native account cache.
func NormalizeUser(user *userpb.User) (*userpb.User, error) {
	if !Enabled() || UserRole(user) == "system" {
		return user, nil
	}
	id := NativeRoleIDs[UserRole(user)]
	if id == "" {
		return nil, errtypes.PermissionDenied("Blak ID does not grant Drive access")
	}
	copy := proto.Clone(user).(*userpb.User)
	if copy.Opaque == nil {
		copy.Opaque = &typespb.Opaque{}
	}
	if copy.Opaque.Map == nil {
		copy.Opaque.Map = make(map[string]*typespb.OpaqueEntry)
	}
	value, err := json.Marshal([]string{id})
	if err != nil {
		return nil, err
	}
	copy.Opaque.Map["roles"] = &typespb.OpaqueEntry{Decoder: "json", Value: value}
	return copy, nil
}

func Normalize(ctx context.Context) (context.Context, error) {
	if !Enabled() {
		return ctx, nil
	}
	user, _ := ctxpkg.ContextGetUser(ctx)
	normalized, err := NormalizeUser(user)
	if err != nil {
		return ctx, err
	}
	return ctxpkg.ContextSetUser(ctx, normalized), nil
}

// PermissionRoleIDs caps native named-permission checks for the current human.
func PermissionRoleIDs(ctx context.Context, accountID string, existing []string) ([]string, error) {
	if !Enabled() {
		return existing, nil
	}
	user, _ := ctxpkg.ContextGetUser(ctx)
	if UserRole(user) == "system" {
		return existing, nil
	}
	if user == nil || user.GetId().GetOpaqueId() != accountID {
		return nil, errtypes.PermissionDenied("Drive permission subject mismatch")
	}
	id := NativeRoleIDs[UserRole(user)]
	if id == "" {
		return nil, errtypes.PermissionDenied("Blak ID does not grant Drive access")
	}
	return []string{id}, nil
}

// CapPermissions intersects the native object ACL with current app authority.
// Constructing a read allowlist also keeps future upstream write flags disabled.
func CapPermissions(ctx context.Context, permissions *provider.ResourcePermissions) (*provider.ResourcePermissions, error) {
	if !Enabled() {
		return permissions, nil
	}
	role := CurrentRole(ctx)
	if role == "" {
		return nil, errtypes.PermissionDenied("Blak ID does not grant Drive access")
	}
	if permissions == nil {
		return nil, errors.New("native resource permissions missing")
	}
	if role != "reader" {
		return permissions, nil
	}
	return &provider.ResourcePermissions{
		GetPath: permissions.GetPath, GetQuota: permissions.GetQuota,
		InitiateFileDownload: permissions.InitiateFileDownload,
		ListGrants:           permissions.ListGrants, ListContainer: permissions.ListContainer,
		ListFileVersions: permissions.ListFileVersions, ListRecycle: permissions.ListRecycle,
		Stat: permissions.Stat,
	}, nil
}
