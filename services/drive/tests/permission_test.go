package svc

import (
	"context"
	"path/filepath"
	"testing"

	users "github.com/cs3org/go-cs3apis/cs3/identity/user/v1beta1"
	permissions "github.com/cs3org/go-cs3apis/cs3/permissions/v1beta1"
	rpc "github.com/cs3org/go-cs3apis/cs3/rpc/v1beta1"
	settingsmsg "github.com/opencloud-eu/opencloud/protogen/gen/opencloud/messages/settings/v0"
	"github.com/opencloud-eu/opencloud/services/settings/pkg/config"
	"github.com/opencloud-eu/opencloud/services/settings/pkg/settings/mocks"
	"github.com/opencloud-eu/reva/v2/pkg/blakroles"
	ctxpkg "github.com/opencloud-eu/reva/v2/pkg/ctx"
	jwt "github.com/opencloud-eu/reva/v2/pkg/token/manager/jwt"
	"go-micro.dev/v4/metadata"
)

func TestBlakPermissionRPCValidatesTokenAndCurrentRole(t *testing.T) {
	t.Setenv("BLAK_DRIVE_ROLES", "true")
	store := blakroles.Store{Path: filepath.Join(t.TempDir(), "roles.json")}
	t.Setenv("BLAK_DRIVE_ROLES_FILE", store.Path)
	member := blakroles.Member{Subject: "immutable", Role: "writer", Active: true}
	if err := store.Write([]blakroles.Member{member}); err != nil {
		t.Fatal(err)
	}
	user := &users.User{Id: &users.UserId{OpaqueId: "native-id", Type: users.UserType_USER_TYPE_PRIMARY}, Username: member.Subject}
	manager, err := jwt.New(map[string]any{"secret": "test-secret", "expires": int64(3600)})
	if err != nil {
		t.Fatal(err)
	}
	token, err := manager.MintToken(context.Background(), user, nil)
	if err != nil {
		t.Fatal(err)
	}
	request := &permissions.CheckPermissionRequest{Permission: "Drives.CreatePersonal", SubjectRef: &permissions.SubjectReference{
		Spec: &permissions.SubjectReference_UserId{UserId: user.Id},
	}}
	member.Role = "reader"
	if err := store.Write([]blakroles.Member{member}); err != nil {
		t.Fatal(err)
	}
	storage := &mocks.Manager{}
	storage.On("ListRoleAssignments", user.Id.OpaqueId).Return([]*settingsmsg.UserRoleAssignment{{RoleId: "stale-server-admin"}}, nil).Once()
	storage.On("ReadPermissionByName", request.Permission, []string{blakroles.NativeRoleIDs["reader"]}).Return((*settingsmsg.Permission)(nil), nil).Once()
	service := Service{manager: storage, config: &config.Config{TokenManager: &config.TokenManager{JWTSecret: "test-secret"}}}
	ctx := metadata.Set(context.Background(), ctxpkg.TokenHeader, token)
	response, err := service.CheckPermission(ctx, request)
	if err != nil || response.Status.Code != rpc.Code_CODE_PERMISSION_DENIED {
		t.Fatal("old token or stored role bypassed downgrade")
	}
	storage.AssertExpectations(t)
	for _, raw := range []string{"", "invalid"} {
		response, err := service.CheckPermission(metadata.Set(context.Background(), ctxpkg.TokenHeader, raw), request)
		if err != nil || response.Status.Code != rpc.Code_CODE_PERMISSION_DENIED {
			t.Fatal("unsigned permission RPC accepted")
		}
	}
}
