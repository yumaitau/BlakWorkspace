'use strict';
// An upper bound on native policies, never a replacement for object ownership.
const READ_ACTIONS = new Set(['read', 'readDetails', 'readDocument', 'readEmail', 'readReaction', 'readTemplate',
  'listUsers', 'listGroups', 'listRevisions', 'listShares', 'listViews', 'listApiKeys', 'listOAuthAuthentications',
  'download', 'export', 'createExport', 'star', 'unstar', 'subscribe', 'unsubscribe', 'createApiKey']);
const DIRECTORY_ACTIONS = new Set(['promote', 'demote', 'suspend', 'activate', 'inviteUser', 'resendInvite', 'createAuthenticationProvider', 'createTeam']);

function allows(actor, action, target, controller = process.env.BLAK_ROLE_CONTROLLER_ID) {
  if (!controller || !actor?.role || actor.id === controller) return true;
  const kind = target?.constructor?.name?.replaceAll('_', '').toLowerCase();
  if (DIRECTORY_ACTIONS.has(action)) return false;
  if (kind === 'authenticationprovider' && !READ_ACTIONS.has(action)) return false;
  if (kind === 'user' && target.id === controller && (!READ_ACTIONS.has(action) || action === 'listApiKeys')) return false;
  if (kind === 'apikey' && target.userId === controller && !READ_ACTIONS.has(action)) return false;
  if (kind === 'team' && action === 'delete') return false;
  if (actor.role !== 'viewer') return true;
  if (kind === 'user' && target.id === actor.id && action === 'update') return true;
  if (kind === 'apikey' && target.userId === actor.id && ['delete', 'revoke'].includes(action)) return true;
  return READ_ACTIONS.has(action);
}

async function identities(ctx, models, controller = process.env.BLAK_ROLE_CONTROLLER_ID) {
  const actor = ctx.state.auth.user;
  if (!controller || actor.id !== controller || actor.role !== 'admin') ctx.throw(403, 'Blak ID controller required');
  const providers = await models.AuthenticationProvider.findAll({ where: { teamId: actor.teamId, name: 'oidc' }, attributes: ['id'] });
  if (providers.length !== 1) throw Error('Ambiguous native Knowledge identity provider');
  const users = await models.User.findAll({ where: { teamId: actor.teamId }, attributes: ['id', 'role', 'suspendedAt'] });
  const links = await models.UserAuthentication.findAll({ where: { authenticationProviderId: providers[0].id }, attributes: ['userId', 'providerId'] });
  const byUser = new Map(), subjects = new Set();
  for (const link of links) {
    if (!link.providerId || byUser.has(link.userId) || subjects.has(link.providerId)) throw Error('Ambiguous native Knowledge subject');
    byUser.set(link.userId, link.providerId); subjects.add(link.providerId);
  }
  ctx.body = { data: users.map(user => ({ id: user.id, role: user.role, suspended: !!user.suspendedAt, subject: byUser.get(user.id) || null })) };
}

module.exports = { allows, identities };
