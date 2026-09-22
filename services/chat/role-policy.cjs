'use strict';

// These caps supplement native room ACLs; ownership never overrides a downgrade.
const READ_METHODS = new Set(`
  canAccessRoom browseChannels channelsList getChannelHistory getFirstRoomMessage
  getMessages getRoomById getRoomIdByNameOrId getRoomNameById getRoomRoles getS3FileUrl
  getSingleMessage getSupportedLanguages getThreadMessages getThreadsList
  getUserMentionsByChannel getUserRoles getUserStatusText getUsersOfRoom
  loadHistory loadLocale loadMissedMessages loadNextMessages loadSurroundingMessages
  messageSearch readMessages readThreads openRoom closeRoom hideRoom toggleFavorite
  saveNotificationSettings saveUserPreferences userPresence userSetUtcOffset
  getAvatarSuggestion listCustomSounds listCustomUserStatus logoutCleanUp
`.trim().split(/\s+/));
const WRITE_METHODS = new Set(`
  sendMessage updateMessage deleteMessage sendFileMessage createChannel
  createPrivateGroup createDirectMessage createDiscussion joinRoom leaveRoom
  followMessage unfollowMessage setReaction pinMessage unpinMessage starMessage
  unstarMessage
`.trim().split(/\s+/));
const ADMIN_METHODS = new Set(`
  archiveRoom unarchiveRoom removeRoom saveRoomSettings addUserToRoom addUsersToRoom
  removeUserFromRoom addRoomModerator removeRoomModerator addRoomOwner removeRoomOwner
  addRoomLeader removeRoomLeader muteUserInRoom unmuteUserInRoom
`.trim().split(/\s+/));

const READ_ROUTES = new Set(`
  me users.info users.getPresence users.presence users.list users.autocomplete
  subscriptions.get subscriptions.getOne rooms.get rooms.info rooms.getDiscussions
  channels.list channels.list.joined channels.info channels.history channels.messages
  channels.files channels.members channels.roles channels.counters channels.online
  groups.list groups.info groups.history groups.messages groups.files groups.members
  groups.roles groups.counters im.list im.list.everyone im.history im.messages
  im.files im.members im.counters dm.list dm.history dm.messages dm.files dm.members
  chat.getMessage chat.search chat.getThreadMessages chat.getThreadsList
  chat.getMentionedMessages chat.getPinnedMessages chat.getStarredMessages
  emoji-custom.list assets.all sounds.list users.customStatus
`.trim().split(/\s+/));
const WRITE_ROUTES = new Set(`
  chat.sendMessage chat.postMessage chat.update chat.delete chat.react chat.star
  chat.unStar chat.pinMessage chat.unPinMessage chat.followMessage chat.unfollowMessage
  channels.create channels.join channels.leave groups.create groups.leave
  im.create im.close im.open im.leave dm.create dm.close dm.open
  rooms.upload/:rid rooms.media/:rid rooms.mediaConfirm/:rid/:fileId
`.trim().split(/\s+/));
const ADMIN_ROUTES = new Set(`
  channels.archive channels.unarchive channels.delete channels.rename
  channels.setDescription channels.setTopic channels.setAnnouncement channels.setReadOnly
  channels.invite channels.kick channels.addModerator channels.removeModerator
  channels.addOwner channels.removeOwner channels.addLeader channels.removeLeader
  groups.archive groups.unarchive groups.delete groups.rename groups.setDescription
  groups.setTopic groups.setAnnouncement groups.setReadOnly groups.invite groups.kick
  groups.addModerator groups.removeModerator groups.addOwner groups.removeOwner
  groups.addLeader groups.removeLeader rooms.muteUser rooms.unmuteUser
`.trim().split(/\s+/));
const PERSONAL_ROUTES = new Set(`
  subscriptions.read subscriptions.unread rooms.favorite rooms.hide rooms.open
  users.setPreferences users.setStatus
`.trim().split(/\s+/));

function role(user) {
  if (!user || user.active !== true || !['reader', 'writer', 'admin'].includes(user.blakRole)) return null;
  return Array.isArray(user.roles) && user.roles.length === 1 && user.roles[0] === 'blak-chat-' + user.blakRole ? user.blakRole : null;
}

function allowed(user, read, write, admin) {
  const current = role(user);
  return Boolean(current && (read || current !== 'reader' && write || current === 'admin' && admin));
}

function methodAllowed(user, name) {
  return allowed(user, READ_METHODS.has(name), WRITE_METHODS.has(name), ADMIN_METHODS.has(name));
}

function routeAllowed(user, version, route, method, body) {
  if (version !== 'v1') return false;
  // A revoked session may still destroy its own native token.
  if (route === 'logout' && method === 'POST') return Boolean(user?._id);
  if (route === 'method.call/:method' || route === 'method.callAnon/:method') {
    // The method wrapper enforces the actual parsed method as well. Never infer
    // authority from the URL's method parameter or from an HTTP verb alone.
    if (method !== 'POST' || typeof body?.message !== 'string') return false;
    try {
      const invocation = JSON.parse(body.message);
      return invocation.msg === 'method' && methodAllowed(user, invocation.method);
    } catch { return false; }
  }
  return allowed(user,
    method === 'GET' && READ_ROUTES.has(route) || method === 'POST' && PERSONAL_ROUTES.has(route),
    method === 'POST' && WRITE_ROUTES.has(route),
    method === 'POST' && ADMIN_ROUTES.has(route));
}

module.exports = { role, methodAllowed, routeAllowed };
