'use strict';

const common = require('@nestjs/common');
const { UserService, SocialLoginService } = require('../service');
const bridge = require('../blak/role-bridge.cjs');

// Nest registers this alongside its native controllers. Never a browser session authority.
class BlakRoleController {
  constructor(users, social) {
    this.users = users.userModel;
    this.accounts = social.userSocialAccountModel;
    this.running = false;
  }
  async identities(request) {
    bridge.requireController(request);
    return bridge.identities(this.users, this.accounts);
  }
  async reconcile(request, members) {
    bridge.requireController(request);
    if (this.running) throw new common.ConflictException('Role reconciliation already running');
    this.running = true;
    try { return await bridge.reconcile(this.users, this.accounts, members); }
    finally { this.running = false; }
  }
}
common.Inject(UserService)(BlakRoleController, undefined, 0);
common.Inject(SocialLoginService)(BlakRoleController, undefined, 1);
common.Controller('/api/blak/roles')(BlakRoleController);
for (const method of ['identities', 'reconcile']) {
  common.Post('/' + method)(BlakRoleController.prototype, method,
    Object.getOwnPropertyDescriptor(BlakRoleController.prototype, method));
  common.Req()(BlakRoleController.prototype, method, 0);
}
common.Body()(BlakRoleController.prototype, 'reconcile', 1);
module.exports = { BlakRoleController };
