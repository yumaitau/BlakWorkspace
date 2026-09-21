'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const hashes = require('./native-hashes.json');
const root = process.argv[2] || '/app/packages/server/dist/src';
const sources = {};
for (const [file, expected] of Object.entries(hashes)) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (createHash('sha256').update(source).digest('hex') !== expected) throw new Error('Native source changed: ' + file);
  sources[file] = source;
}
function replace(file, before, after) {
  if (sources[file].split(before).length !== 2) throw new Error('Patch anchor mismatch: ' + file);
  sources[file] = sources[file].replace(before, after);
}
replace('common/guard/auth.guard.js', 'req.user = detail;',
  "require('../../blak/role-bridge.cjs').authorize(detail, context.getHandler().name, ctx.getArgs?.());\n                    req.user = detail;");
replace('controller/upload.controller.js',
  'constructor(authService, endpointService, formService, redisService) {',
  'constructor(authService, endpointService, formService, redisService, userService) {\n        this.userService = userService;');
replace('controller/upload.controller.js', '_service_1.RedisService])',
  '_service_1.RedisService, _service_1.UserService])');
replace('controller/upload.controller.js', 'if (sessionId) {',
  "if (sessionId) {\n            require('../blak/role-bridge.cjs').authorize(await this.userService.findById(sessionId), 'upload');");
replace('service/social-login.service.js', 'if (account) {',
  `if (require('../blak/role-bridge.cjs').enabled()) {
            if (kind !== 'oidc' || !account) throw new common_1.BadRequestException('Blak ID account must be provisioned by its immutable subject');
            require('../blak/role-bridge.cjs').authorize(await this.userService.findById(account.userId), 'userDetail');
        }
        if (account) {`);
sources['model/user.model.js'] += '\nexports.UserSchema.add({ blakRole: { type: String, enum: [null, "reader", "writer", "admin"], default: null } });\n';
sources['controller/index.js'] += '\nexports.BlakRoleController = require("./blak-role-controller.cjs").BlakRoleController;\n';
replace('resolver/user/user-detail.resolver.js', 'id: user.id,', 'id: user.id,\n            blakRole: user.blakRole || null,');
sources['common/graphql/user.graphql.js'] += '\n(0, graphql_1.Field)(() => String, { nullable: true })(UserDetailType.prototype, "blakRole");\n';
replace('main.js', "app.use('/graphql', bodyParser.json({ limit: '1mb' }));",
  "app.use('/graphql', bodyParser.json({ limit: '1mb' }));\n    app.use('/api/blak/roles', bodyParser.json({ limit: '1mb' }));");
for (const [file, source] of Object.entries(sources)) fs.writeFileSync(path.join(root, file), source);
