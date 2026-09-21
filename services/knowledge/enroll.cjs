'use strict';
// Operator-only enrollment. Native model hooks retain validation and audit events.
require('../scripts/bootstrap');
const { randomBytes } = require('node:crypto');
const { User, UserAuthentication, AuthenticationProvider, ApiKey } = require('../models');
const { sequelize } = require('../storage/database');
const { UserRole } = require('../../shared/types');
const { AuthenticationType } = require('../types');
const SCOPE = ['/api/users.blak_identities', '/api/users.update_role', '/api/users.suspend', '/api/users.activate', '/api/users.info', '/api/auth.info'];

async function nativeCreate(Model, actor, values) {
  return sequelize.transaction(transaction => Model.createWithCtx({ context: { transaction, ip: '127.0.0.1', auth: { user: actor, type: AuthenticationType.API } } }, values));
}

(async () => {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const data = JSON.parse(input);
  if (!data.userId) {
    if (typeof data.bootstrapSubject !== 'string' || !data.bootstrapSubject) throw Error('Immutable bootstrap subject required');
    const links = await UserAuthentication.findAll({ where: { providerId: data.bootstrapSubject },
      include: [{ model: AuthenticationProvider, as: 'authenticationProvider', where: { name: 'oidc' }, required: true }] });
    if (links.length !== 1) throw Error('Ambiguous native bootstrap identity');
    const owner = await User.scope('withTeam').findByPk(links[0].userId);
    if (!owner || !owner.isAdmin || owner.isSuspended || owner.teamId !== links[0].authenticationProvider.teamId) throw Error('Bootstrap subject is not the native team administrator');
    const controller = await nativeCreate(User, owner, { name: 'Blak ID role controller', email: 'blak-knowledge-role-' + randomBytes(12).toString('hex') + '@example.invalid',
      teamId: owner.teamId, role: UserRole.Admin, language: owner.language, lastActiveAt: new Date(), lastActiveIp: '127.0.0.1' });
    console.log('BLAK_ENROLLED=' + JSON.stringify({ userId: controller.id }));
  } else {
    const controller = await User.scope('withTeam').findByPk(data.userId);
    if (!controller || !controller.isAdmin || controller.isSuspended) throw Error('Native controller is missing or inactive');
    let token = data.token;
    if (token) {
      const key = await ApiKey.findByToken(token);
      if (!key || key.userId !== controller.id || key.expiresAt && key.expiresAt <= new Date() || JSON.stringify([...(key.scope || [])].sort()) !== JSON.stringify([...SCOPE].sort())) throw Error('Native controller key or scope mismatch');
    } else {
      const key = await nativeCreate(ApiKey, controller, { name: 'Blak ID role controller', userId: controller.id, scope: SCOPE });
      token = key.value;
      if (!token) throw Error('Native key generation did not return a credential');
    }
    console.log('BLAK_ENROLLED=' + JSON.stringify({ userId: controller.id, token }));
  }
  process.exit(0);
})().catch(error => { console.error('Native Knowledge enrollment failed: ' + error.constructor.name); process.exit(1); });
