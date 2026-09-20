# Continuous dedicated workspace sync

The `hermes-workspace-sync` CronJob runs every five minutes in `blak-micro`.
It reads the configured account's accessible Drive/Docs files, published Knowledge
pages, joined Chat channels, private groups and direct conversations, Projects
boards/tasks, CRM records and activities, Forms questions/responses, Draw boards,
Flow definitions/run status and Cloud files. Archived pages/tasks, unsupported
file formats and files over 20 MiB are excluded. Images/audio/video are not
transcribed; embedded drawing images and infrastructure secrets are not indexed. This is a per-account replica, not a public organisation-wide index.

Each source has a private Hermes knowledge collection. The **Blak Workspace**
model attaches those collections to local `qwen2.5:1.5b` inference. Select that
model in Hermes to ask questions about workspace content. New/changed/deleted
content normally appears within five minutes plus processing time. Source access
is evaluated during each run; this is eventual sync, not request-time source ACL
checking. Do not share these private collections or the model: the worker refuses
shared collections and models. Disabled/revoked source credentials fail the job
while other sources continue. Failed sources are detached from the private
workspace model until repaired; their previous private collection snapshot is
retained for recovery.

## Credentials and ownership

Secret `blak-hermes-sync`, key `accounts.json`, contains an `accounts` array.
Each mapping has `name`, `owner_id`, `hermes`, and `sources`. `owner_id` must be the
Hermes user ID returned by `/api/v1/auths/` for that account's API key.

```json
{
  "accounts": [{
    "name": "workspace-owner",
    "owner_id": "HERMES_USER_ID",
    "hermes": {"base": "http://hermes:8080", "token": "SECRET"},
    "sources": {
      "drive": {"base": "http://drive:9200", "public_base": "https://drive.workspace.example.com", "username": "SOURCE_USER", "password": "APP_TOKEN"},
      "outline": {"base": "http://sites:3000", "public_base": "https://sites.workspace.example.com", "token": "API_KEY"},
      "chat": {"base": "http://chat:3000", "public_base": "https://chat.workspace.example.com", "headers": {"X-Auth-Token": "USER_TOKEN", "X-User-Id": "SOURCE_USER_ID"}},
      "projects": {"base": "http://projects:5173", "public_base": "https://projects.workspace.example.com", "headers": {"x-api-key": "API_KEY"}}
    }
  }]
}
```

Store real values only in the cluster Secret or a mode-600 temporary file; never
commit them. Use credentials belonging to the same person as the Hermes owner.
The reference mapping uses the bootstrap `akadmin` account. Other users require their
own mapping and credentials; their private documents are not copied by this one.

- Drive uses an app token, not the user's SSO password. The current token expires
  after one year; rotate before expiry using the supported OpenCloud app-token
  API or `opencloud auth-app create` operator command.
- Outline API key scopes: `documents.list`, `documents.info`, `collections.list`.
- Chat uses the owning user's authenticated session token. Rotate when revoked
  or expired; a 401 makes the job fail visibly. The worker performs only reads.
- Projects uses the owner's API key (one-year expiry). This upstream API does not
  let clients set read-only key permissions; the connector performs only reads.
- CRM uses the verified owner's Frappe API key and native record permissions.
- Forms uses that owner's authenticated session; regular reads renew it. Re-enrol
  if revoked or expired after an outage.
- Draw/Flow exports use a separate read-only bearer token bound to the portal
  owner. Requests cannot select another owner. Cloud files use the shared deployment
  storage service; this is shared workspace storage, not per-user private storage.
- `node scripts/deploy/connect-hermes-apps.js` enrols these five new sources after
  matching Hermes, portal and Forms identities. Deployment runs it automatically.
  Additional people need their own account mapping and source credentials.
- Hermes API keys must be enabled. Its `WEBUI_SECRET_KEY` comes from
  `blak-hermes/session-secret`, so sessions survive deployment replacement.

## Reliability

Source listings paginate completely before removal. Revisions/checksums avoid
repeat uploads. Updates persist replacement and pending-cleanup IDs before
removing old files. Removed source items are removed from knowledge and file
storage. State lives on `hermes-sync-state`; atomic writes and a file lock prevent
corruption from crashes or overlapping manual and scheduled jobs. Failed jobs
exit nonzero and retry twice; credentials and document bodies are never logged.

```bash
kubectl -n blak-micro get cronjob hermes-workspace-sync
kubectl -n blak-micro get jobs --sort-by=.metadata.creationTimestamp
kubectl -n blak-micro logs job/JOB_NAME
kubectl -n blak-micro create job hermes-manual-$(date +%s) --from=cronjob/hermes-workspace-sync
```

A successful log reports uploaded/unchanged/deleted counts per source. A missing
source must not be described as synced. The CronJob prevents scheduled overlap;
the file lock also covers manual jobs. Run history and nonzero jobs are the
operator-visible failure signal; no external alert destination is configured.

## Verification

On the deployment host, `scripts/deploy/test-e2e.sh hermes.spec.js` tests authentication,
private collections, real Drive create/update/delete, idempotence, vector retrieval,
local grounded responses, browser chat, and scoped Chat/Projects test data.
Fixtures use dedicated test documents, a self-only private channel, and a private
test workspace, then remove their own data and reconcile deletions.

`hermes-apps.spec.js` exercises CRM, Draw, Flow and Cloud create/update/delete,
private board isolation, read-only exports and a grounded CRM answer.
`forms.spec.js` verifies published questions and submitted answers reach Hermes
and disappear after deletion. Run the complete Playwright suite after deployment.
