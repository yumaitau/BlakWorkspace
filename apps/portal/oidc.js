'use strict';
const { textRequest } = require('./http-client');

function createOIDC({ issuer, clientId }) {
  let configuration, keys;
  async function discovery() {
    if (configuration) return configuration;
    const result = await textRequest(new URL('.well-known/openid-configuration', issuer).href);
    if (result.status !== 200) throw new Error('Blak ID discovery unavailable');
    const value = JSON.parse(result.body);
    if (value.issuer !== issuer) throw new Error('Unexpected OIDC issuer');
    for (const name of ['jwks_uri', 'authorization_endpoint', 'token_endpoint', 'userinfo_endpoint', 'end_session_endpoint']) {
      if (new URL(value[name]).origin !== new URL(issuer).origin) throw new Error('Unexpected OIDC endpoint');
    }
    configuration = value;
    return value;
  }
  async function verify(token, options = {}) {
    const jose = await import('jose');
    const config = await discovery();
    keys ||= jose.createRemoteJWKSet(new URL(config.jwks_uri));
    return (await jose.jwtVerify(token, keys, { issuer, audience: clientId, algorithms: ['RS256', 'ES256'], ...options })).payload;
  }
  return {
    discovery,
    async identity(token, nonce) {
      const claims = await verify(token, { requiredClaims: ['exp', 'iat', 'sub', 'nonce'] });
      if (claims.nonce !== nonce) throw new Error('OIDC nonce mismatch');
      return claims;
    },
    async refreshedIdentity(token, sub) {
      const claims = await verify(token, { requiredClaims: ['exp', 'iat', 'sub'] });
      if (claims.sub !== sub) throw new Error('Refresh changed identity');
      return claims;
    },
    async logout(token) {
      const claims = await verify(token, { requiredClaims: ['iat', 'jti', 'events'], maxTokenAge: '5 minutes' });
      const event = claims.events?.['http://schemas.openid.net/event/backchannel-logout'];
      if (!event || typeof event !== 'object' || Array.isArray(event) || 'nonce' in claims || (!claims.sid && !claims.sub) || typeof claims.jti !== 'string' || (claims.sid !== undefined && typeof claims.sid !== 'string') || (claims.sub !== undefined && typeof claims.sub !== 'string')) throw new Error('Invalid logout token');
      return claims;
    },
  };
}
module.exports = { createOIDC };
