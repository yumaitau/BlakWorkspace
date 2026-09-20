'use strict';
// Only public origins use this proxy. Cluster service fixtures stay on the node.
const publicNetworkOptions = process.env.BLAK_E2E_PROXY
  ? { proxy: { server: process.env.BLAK_E2E_PROXY } }
  : {};
module.exports = { publicNetworkOptions };
