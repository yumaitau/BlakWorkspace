"""Patch only the pinned OpenCloud native authorization boundaries."""
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys

root = Path(sys.argv[1])
here = Path(__file__).resolve().parent
hashes = json.loads((here / 'source-hashes.json').read_text())
sources = {}
for name, expected in hashes.items():
    data = (root / name).read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError('Pinned OpenCloud source changed: ' + name)
    sources[name] = data.decode()


def replace(name, before, after):
    if sources[name].count(before) != 1:
        raise RuntimeError('Native patch anchor mismatch: ' + name)
    sources[name] = sources[name].replace(before, after)


def native_import(name):
    replace(name, 'import (\n', 'import (\n\t"github.com/opencloud-eu/reva/v2/pkg/blakroles"\n')


reva = 'vendor/github.com/opencloud-eu/reva/v2/'
replace('vendor/modules.txt', 'github.com/opencloud-eu/reva/v2/pkg/ctx\n',
        'github.com/opencloud-eu/reva/v2/pkg/ctx\ngithub.com/opencloud-eu/reva/v2/pkg/blakroles\n')

name = reva + 'pkg/token/manager/jwt/jwt.go'
native_import(name)
replace(name, 'ttl := time.Duration(m.conf.Expires) * time.Second', '''var err error
 u, err = blakroles.NormalizeUser(u)
 if err != nil { return "", err }
 ttl := time.Duration(m.conf.Expires) * time.Second''')
replace(name, 'return claims.User, claims.Scope, nil', '''normalized, err := blakroles.NormalizeUser(claims.User)
 if err != nil { return nil, nil, err }
 return normalized, claims.Scope, nil''')

for backend in ['pkg', 'utils']:
    name = reva + f'pkg/storage/{backend}/decomposedfs/permissions/spacepermissions.go'
    native_import(name)
    for method in ['AssemblePermissions', 'AssembleTrashPermissions']:
        replace(name, f'return p.item.{method}(ctx, n)', f'''current, err := blakroles.Normalize(ctx)
     if err != nil {{ return nil, err }}
     permissions, err := p.item.{method}(current, n)
     if err != nil {{ return nil, err }}
     return blakroles.CapPermissions(current, permissions)''')

    name = reva + f'pkg/storage/{backend}/decomposedfs/upload/upload.go'
    native_import(name)
    for operation, result in [('WriteChunk', '0, err'), ('FinishUpload', 'err')]:
        anchor = f'ctx, span := tracer.Start(session.Context(ctx), "{operation}")\n\tdefer span.End()'
        replace(name, anchor, anchor + f'\n if err := blakroles.RequireWrite(ctx); err != nil {{ return {result} }}')

    # Native upload metadata stores human-readable types ("service"), not
    # protobuf enum names. Restore them using the matching upstream decoder.
    name = reva + f'pkg/storage/{backend}/decomposedfs/upload/session.go'
    receiver = 'session' if backend == 'pkg' else 's'
    before = f'userpb.UserType(userpb.UserType_value[{receiver}.info.Storage["UserType"]])'
    if sources[name].count(before) != 2:
        raise RuntimeError('Native upload type restoration changed: ' + name)
    sources[name] = sources[name].replace(before, f'utils.UserTypeMap({receiver}.info.Storage["UserType"])')

name = 'services/settings/pkg/service/v0/service.go'
native_import(name)
replace(name, 'import (\n', 'import (\n rjwt "github.com/opencloud-eu/reva/v2/pkg/token/manager/jwt"\n')
anchor = 'spec := req.GetSubjectRef().GetSpec()'
replace(name, anchor, '''if blakroles.Enabled() {
  if _, present := ctxpkg.ContextGetUser(ctx); !present {
   raw, present := metadata.Get(ctx, ctxpkg.TokenHeader)
   if !present || raw == "" {
    return &cs3permissions.CheckPermissionResponse{Status: &rpcv1beta1.Status{Code: rpcv1beta1.Code_CODE_PERMISSION_DENIED}}, nil
   }
   manager, err := rjwt.New(map[string]any{"secret": g.config.TokenManager.JWTSecret, "expires": int64(86400)})
   if err != nil { return nil, err }
   user, _, err := manager.DismantleToken(ctx, raw)
   if err != nil {
    return &cs3permissions.CheckPermissionResponse{Status: &rpcv1beta1.Status{Code: rpcv1beta1.Code_CODE_PERMISSION_DENIED}}, nil
   }
   ctx = ctxpkg.ContextSetUser(ctx, user)
  }
 }
 ''' + anchor)
anchor = 'permission, err := g.manager.ReadPermissionByName(req.GetPermission(), roleIDs)'
replace(name, anchor, '''roleIDs, err = blakroles.PermissionRoleIDs(ctx, accountID, roleIDs)
 if err != nil {
  return &cs3permissions.CheckPermissionResponse{Status: &rpcv1beta1.Status{Code: rpcv1beta1.Code_CODE_PERMISSION_DENIED}}, nil
 }
 ''' + anchor)

# HTTP settings middleware supplies a verified user. Preserve internal role
# provisioning reads, while human metadata RPCs can inspect only their account.
anchor = 'func (g Service) ListRoleAssignments(ctx context.Context, req *settingssvc.ListRoleAssignmentsRequest, res *settingssvc.ListRoleAssignmentsResponse) error {\n\treq.AccountUuid = getValidatedAccountUUID(ctx, req.GetAccountUuid())'
replace(name, anchor, anchor + '''
 if blakroles.Enabled() {
  if user, present := ctxpkg.ContextGetUser(ctx); present && blakroles.UserRole(user) != "system" && !g.isCurrentUser(ctx, req.GetAccountUuid()) {
   return merrors.Forbidden(g.id, "cannot read another user's role assignments")
  }
 }
''')

name = 'services/proxy/pkg/userroles/oidcroles.go'
native_import(name)
start = sources[name].index('\troleNamesToRoleIDs, err := ra.roleNamesToRoleIDs()')
end = sources[name].index('\tassignedRoles, err := loadRolesIDs(', start)
legacy = sources[name][start:end].replace('\troleIDFromClaim := ""', '\troleIDFromClaim = ""')
sources[name] = sources[name][:start] + '''\troleIDFromClaim := ""
 if blakroles.Enabled() {
  roleIDFromClaim = blakroles.NativeRoleIDs[blakroles.UserRole(user)]
  if roleIDFromClaim == "" { return nil, errors.New("Blak ID does not grant Drive access") }
 } else {
''' + legacy + '\n }\n\n' + sources[name][end:]

name = 'services/collaboration/pkg/middleware/wopicontext.go'
native_import(name)
anchor = 'ctx = ctxpkg.ContextSetScopes(ctx, scopes)'
replace(name, anchor, anchor + '''
 if blakroles.Enabled() {
  if err := blakroles.RequireRead(ctx); err != nil {
   http.Error(w, "Blak ID does not grant Docs access", http.StatusForbidden)
   return
  }
  readRequest := r.Method == http.MethodGet || r.Method == http.MethodHead ||
   r.Method == http.MethodPost && r.Header.Get("X-WOPI-Override") == "GET_LOCK"
  if !readRequest && blakroles.RequireWrite(ctx) != nil {
   http.Error(w, "Blak ID does not grant Docs writes", http.StatusForbidden)
   return
  }
  if blakroles.CurrentRole(ctx) == "reader" && claims.WopiContext.ViewMode == appproviderv1beta1.ViewMode_VIEW_MODE_READ_WRITE {
   claims.WopiContext.ViewMode = appproviderv1beta1.ViewMode_VIEW_MODE_READ_ONLY
   ctx = context.WithValue(ctx, wopiContextKey, claims.WopiContext)
  }
 }
''')

name = 'services/proxy/pkg/middleware/account_resolver.go'
native_import(name)
anchor = "// resolve the user's roles"
replace(name, anchor, '''if blakroles.Enabled() && blakroles.UserRole(user) == "" {
   http.Error(w, "Blak ID does not grant Drive access", http.StatusForbidden)
   return
  }
  ''' + anchor)

name = 'services/proxy/pkg/command/server.go'
native_import(name)
replace(name, 'middleware.Security(cspConfig),', 'middleware.Security(cspConfig),\n\t\tblakroles.Controller,')
replace(name, 'middleware.SelectorCookie(', 'blakroles.GateHTTP,\n\t\tmiddleware.SelectorCookie(')

# Obtain native role identifiers from the pinned definitions, never OIDC claims.
definitions = sources['services/settings/pkg/store/defaults/defaults.go']
role_ids = {}
for role, constant in [('reader', 'BundleUUIDRoleUserLight'), ('writer', 'BundleUUIDRoleUser'), ('admin', 'BundleUUIDRoleSpaceAdmin')]:
    found = re.findall(r'\b' + constant + r'\s*=\s*"([^"]+)"', definitions)
    if len(found) != 1:
        raise RuntimeError('Native role definition changed: ' + constant)
    role_ids[role] = found[0]

for name, source in sources.items():
    (root / name).write_text(source)
destination = root / reva / 'pkg/blakroles'
destination.mkdir(parents=True, exist_ok=True)
for source in here.glob('*.go'):
    shutil.copyfile(source, destination / source.name)
shutil.copyfile(here / 'tests/wopi_test.go', root / 'services/collaboration/pkg/middleware/blak_roles_test.go')
shutil.copyfile(here / 'tests/permission_test.go', root / 'services/settings/pkg/service/v0/blak_roles_test.go')
for backend, session_type in [('pkg', 'DecomposedFsSession'), ('utils', 'OcisSession')]:
    target = root / reva / f'pkg/storage/{backend}/decomposedfs/upload/blak_roles_test.go'
    target.write_text((here / 'tests/upload_test.go.in').read_text().replace('SESSION_TYPE', session_type))
(destination / 'role-ids.go').write_text('package blakroles\nfunc init() { NativeRoleIDs = map[string]string{\n' +
    ''.join(json.dumps(role) + ':' + json.dumps(value) + ',\n' for role, value in role_ids.items()) + '} }\n')
print('Pinned native Drive authorization patch applied')
