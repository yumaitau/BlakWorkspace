'use strict';

// Resolver method names, not GraphQL aliases, operation labels or HTTP verbs.
const READ = new Set([
  'userDetail', 'teams', 'teamOverview', 'teamMembers', 'teamRecentForms', 'searchTeam',
  'projects', 'projectMembers', 'forms', 'searchForms', 'formDetail', 'formAnalytic',
  'formArchive', 'formReport', 'submissions', 'submissionAnswers', 'exportSubmissions',
  'templates', 'templateDetail', 'unsplashSearch',
]);
const WRITE = new Set([
  'createForm', 'deleteForm', 'duplicateForm', 'moveFormToTrash', 'moveForm', 'publishForm',
  'restoreForm', 'updateFormArchive', 'updateFormHiddenFields', 'updateFormLogics',
  'updateFormSchemas', 'updateFormTheme', 'updateFormVariables', 'updateForm',
  'createFormWithAI', 'createFieldsWithAI', 'createFormLogicsWithAI', 'createFormThemeWithAI',
  'createProject', 'renameProject', 'deleteProjectCode', 'deleteProject', 'emptyProjectTrash',
  'deleteSubmissions', 'updateSubmissionAnswer', 'updateSubmissionsCategory',
  'createTeam', 'createBrandKit', 'updateBrandKit', 'useTemplate', 'unsplashTrackDownload',
  'upload',
]);
const ADMIN = new Set([
  'formIntegrations', 'deleteIntegrationSettings', 'updateIntegrationSettings',
  'updateIntegrationStatus', 'connectStripe', 'revokeStripeAccount', 'stripeAuthorizeUrl',
  'addProjectMember', 'deleteProjectMember', 'leaveProject', 'inviteMember', 'joinTeam',
  'leaveTeam', 'removeTeamMember', 'resetTeamInviteCode', 'transferTeam', 'updateTeam',
  'dissolveTeamCode', 'dissolveTeam',
]);

function allows(user, operation, args) {
  const role = user?.blakRole;
  if (user?.isBlocked || !['reader', 'writer', 'admin'].includes(role)) return false;
  if (operation === 'createProject' && role !== 'admin' && args?.input?.memberIds?.length) return false;
  if (READ.has(operation) || operation === 'updateUser') return true;
  if (WRITE.has(operation)) return role !== 'reader';
  return role === 'admin' && ADMIN.has(operation);
}

function directoryMembers(value) {
  if (!Array.isArray(value) || !value.length) throw new Error('Complete directory snapshot required');
  const members = new Map();
  for (const member of value) {
    if (!member || typeof member.subject !== 'string' || !member.subject.trim()
        || typeof member.active !== 'boolean' || typeof member.email !== 'string'
        || ![null, 'reader', 'writer', 'admin'].includes(member.role)
        || members.has(member.subject)) throw new Error('Invalid directory member');
    members.set(member.subject, member);
  }
  return members;
}

module.exports = { allows, directoryMembers };
