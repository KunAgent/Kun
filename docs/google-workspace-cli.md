# Experimental Google Workspace integration

Kun includes a curated integration backed by the pinned Google Workspace CLI
(`gws`) **0.22.5**. It is an experimental, user-managed OAuth integration, not a
general-purpose Google API command runner or a zero-setup Google sign-in.

The runtime exposes three agent tools:

- `google_workspace_search`: search the local supported-method catalog
- `google_workspace_describe`: return one method's strict input schema
- `google_workspace_call`: validate and execute one curated operation

Search does not search a Google account. Account reads and changes happen only
through a described call. Raw CLI commands, arbitrary service discovery, batch
operations, authentication commands, environment overrides, and output paths
are not agent-tool inputs.

## Feature matrix

| Product | Supported reads | Supported changes | Excluded |
| --- | --- | --- | --- |
| Gmail | Search/read messages and threads, list/read labels and unread counts, list/read drafts | Create/replace plain-text drafts; send/reply/forward; explicit labels/archive; delete a draft | Attachments, raw MIME/HTML inputs, send-as, settings/admin, batch, permanent message/thread deletion |
| Calendar | Agenda/day queries and individual events | Create, patch, and delete events with explicit notification choice | Recurrence, attachments, calendar administration, ACLs |
| Drive | Metadata search/read, bounded non-JSON media download and export | None | Upload, edit, move, delete, share, or permission changes |
| Docs / Sheets | Read via Drive export where supported | None | Direct Docs/Sheets API calls and edits |

Every Gmail or Calendar mutation, including draft creation, requires human
approval. Drive is read-only. Unsupported upstream `gws` capabilities do not
become available merely because the binary contains them.

### Input and output limits

- List operations return one page, usually 25 items by default and at most 100.
  Continue only with an explicit returned page token. There is no `--page-all`.
- Gmail uses `userId=me`. A message has at most 12 recipients across To/Cc/Bcc,
  a 512-character subject, and a 16,384-character plain-text body.
- The host constructs MIME only after validating structured email fields. Raw
  MIME, attachments, hidden recipients, arbitrary headers, and CR/LF injection
  are not accepted.
- Reply requires both `threadId` and `inReplyTo`; forward supplies its complete
  text explicitly. Draft send includes the exact replacement message, not just
  an ID whose current contents the user cannot inspect in approval.
- Calendar list requires a positive time range of at most 93 days. Event times
  are dates or offset-bearing timestamps; start/end must match and end must be
  later. A patch changes start and end together. Attendees are bounded to 12.
- Calendar writes always specify `sendUpdates=all|externalOnly|none`. Review
  the host-fetched existing attendees before a patch/delete: Google may notify
  them even if the patch does not include attendees. The runtime fetches the
  event before approval, then rechecks its version and recipients before the
  write. Incomplete/hidden attendee lists, missing versions, or more than 100 existing
  attendees fail closed. This is best-effort concurrency protection: the pinned
  CLI cannot attach atomic `If-Match`, so a change after the final check remains
  possible. `none` does not guarantee zero emails or revoke attendee access.
- Drive exports allow `text/plain`, `text/csv`, `application/pdf`, DOCX, and XLSX.
  Format compatibility depends on the Google file type.
- Process output and downloaded/exported content are bounded to 2 MiB. Text/CSV
  exports are decoded as UTF-8; other media is represented as complete base64.
  Wrapped results up to 128 KiB are inline. Larger results are preserved in a
  complete JSON artifact with `artifactId`, size, and encoding metadata, read
  using `artifact_read`. Without an artifact store, an oversized result fails
  explicitly. An artifact is not a file saved to a user-selected local path.
- Ordinary downloads work only when upstream classifies the response as
  non-JSON media. Files served as `application/json`, `text/json`, or without a
  Content-Type are not supported by this download path: upstream emits stdout
  instead of the requested media file. They fail rather than pretending to
  preserve original file bytes.
- A call normally has a 30-second process timeout; login allows five minutes.
  Output overflow, abort, timeout, or process failure stops the owned process.
  A cancelled or uncertain write may already have reached Google.

## First-time setup

Open **Settings -> Integrations -> Google Workspace** in the desktop workbench.

1. Create or select a Google Cloud project that you control.
2. Enable Gmail API, Google Calendar API, and Google Drive API.
3. Configure the OAuth consent screen. If using an External app in testing,
   add your Google account as a test user.
4. Create an OAuth client with application type **Desktop app**.
5. Download its JSON yourself and save it to
   `~/.config/gws/client_secret.json` on your computer. This is the upstream
   default on every platform; pre-existing legacy locations may be recognized
   by `gws`. Do not paste the JSON, client secret, or tokens into Kun chat.
6. Refresh the integration status and choose **Connect Google**. Review the
   requested permissions and finish consent in your browser.
7. Choose **Test connection**. It makes small read-only Gmail, Calendar, and
   Drive requests; a successful sign-in alone does not prove API access.

These prerequisites and the default client location follow the
[pinned manual setup guide](https://github.com/googleworkspace/cli/blob/v0.22.5/README.md#manual-oauth-setup-google-cloud-console).
Kun's **Set up OAuth** action shows guidance; it does not run project creation,
create credentials, or provision a client on your behalf. The upstream
interactive `gws auth setup` wizard is an optional external, user-driven route
and needs an independently installed/authenticated `gcloud` CLI. Kun does not
bundle `gcloud`.

### Requested permissions

The integration requests these application scopes:

- `https://www.googleapis.com/auth/gmail.modify`: Gmail read, compose, send, and
  label changes. Google classifies this as restricted; it does not permit
  immediate permanent deletion of messages/threads. See
  [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).
- `https://www.googleapis.com/auth/calendar.events`: event read and management.
  See [Calendar authorization](https://developers.google.com/workspace/calendar/api/auth).
- `https://www.googleapis.com/auth/drive.readonly`: Drive read/download, including
  supported Google-native exports. See
  [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).

The pinned `gws` login additionally requests `openid`, `userinfo.email`, and
`userinfo.profile` for account identification. OAuth access is broader than the
curated tool surface: Kun still enforces its catalog and human-approval boundary.
Google/Workspace organization policy and OAuth testing/verification requirements
can restrict consent independently of Kun.

### Credential ownership and disconnect

The separate `gws` process owns OAuth, credential files, token caches, and
encryption-key handling. Kun does not open or import those credential files.
`gws` uses encrypted credential storage with an OS keyring or local key-file
fallback; do not promise that every platform stores its key only in the OS
keyring. Existing plaintext credentials are an upstream compatibility behavior,
not a credential format Kun reads or creates itself.

The UI receives an allowlisted status projection: connection state, supported
granted scopes, binary version, operation status, and coarse per-service health.
It does not receive raw auth output, credential locations, masked identifiers,
email addresses, or tokens. The OAuth browser URL stays in the host control
plane and is opened only for the matching active login.

Privacy here distinguishes authentication data from requested content. The
integration does not log raw `gws` stdout/stderr, OAuth URLs, or credential
paths. Agent observability exports fixed tool metadata and timing, not tool
arguments, results, or approval content. Normal conversation history, approval
records, and result artifacts intentionally contain the mail/event/file content
needed for the task. If optional per-thread model-request capture is enabled,
that diagnostic capture can also retain conversation content; this integration
does not promise that message bodies are absent from all local history or
explicitly enabled diagnostics. Do not put real credentials in test fixtures.

**Cancel** stops the active setup/login/test operation. Leaving the settings
page cancels work started from that page and revokes pending browser-opening
authority. An already opened Google page is not closed automatically. Refresh
after an interrupted flow if its final account state is unclear.

**Disconnect** removes local `gws` credentials and token caches. It can also
disconnect other programs sharing that `gws` profile. It does not revoke OAuth
consent at Google; remove that access separately in Google Account settings if
needed. Client setup and encryption-key lifecycle remain upstream-owned.

## Approval and execution boundary

The runtime owns a fixed allowlist with strict per-method Zod schemas. It rejects
unknown fields, methods, unsafe identifiers, prototype properties, non-JSON
values, and excessive nesting. Host-authored command segments are passed with
`shell: false`; user fields occupy individual JSON argv values.

After argument normalization and hooks, the tool host classifies the actual
method and labels. Read calls stay read-only; writes participate in the runtime's
side-effect, Plan/read-only, lease, approval, and operation-journal checks.
Gmail/Calendar writes require an explicit human decision even with Full access
or an automatic reviewer. Request-bound one-use grants use host object identity;
JSON-shaped grants and `approved=true` do not confer authority.

The approval payload contains the complete bounded structured message/event,
target identifiers, recipient fields, and Calendar notification choice. Changing
the method or payload invalidates the grant. A draft approval does not authorize
a later send. Patch/delete approval also includes the host-fetched existing
Calendar event version, attendees, organizer, summary, and times. A changed or
expired preview requires a fresh approval; it is not an atomic compare-and-write
guarantee. Email, event, and file data are returned as untrusted external content
and must never be interpreted as approval or instructions.

Do not automatically retry uncertain sends or other writes. Inspect state
read-only before a newly approved retry. A transport or parse error is not proof
that Google rejected the mutation.

### Process isolation

- Only the bundled binary is resolved. Runtime `PATH`, user configuration, or
  environment variables cannot select another executable.
- Each process has a private temporary working directory with an empty `.env`,
  preventing the pinned upstream dotenv search from loading ancestor files.
- The environment is a positive allowlist. Proxy variables, gws credential or
  discovery overrides, loader hooks, and logging overrides do not inherit.
  Application Default Credentials fallback is disabled using a nonexistent
  host-owned path. Corporate environments that require a proxy may therefore
  need a future supported configuration; arbitrary proxy inheritance is not a
  workaround.
- The runtime uses the application's owned-process launcher. Cancellation and
  shutdown stop that owned work rather than killing unrelated `gws` processes.
- Media output is written only to a host-selected temporary file. Size,
  regular-file, symlink, and hardlink checks precede reading; cleanup removes
  the temporary directory. No caller-selected output path is accepted.
- Non-JSON content is handled only by the curated media path. Upstream sends
  non-JSON response bodies to a file, so this path is necessary for text, CSV,
  PDF, and office exports as well as ordinary binary downloads.

Settings control follows Renderer -> constrained preload IPC -> Electron main
controller -> authenticated Kun HTTP routes -> `GoogleWorkspaceService`.
The routes are a host control plane, not an arbitrary Google call endpoint.
They reject supplied bodies/query arguments and require runtime authentication
even in insecure development mode. Account controls are not agent tools.

## Pinned binary and packaging

The source of truth is `resources/google-workspace/manifest.json`:

- Release: [v0.22.5](https://github.com/googleworkspace/cli/releases/tag/v0.22.5)
- Source commit: `705fb0ecac6f4249679958f6325b809b63fdde17`
- Targets: macOS arm64/x64, Linux arm64/x64, Windows x64
- Per-target exact archive URL, archive/executable size, and SHA-256
- Upstream license: Apache-2.0, with bundled notices

`npm run prepare:google-workspace` prepares the current development target.
Explicit cross-target packaging uses:

```sh
node scripts/prepare-google-workspace.cjs --platform darwin --arch arm64
```

Preparation occurs at development/build/packaging time, never as a runtime
installer. It checks the pinned archive and executable hashes and sizes, rejects
unsafe archive entries, and retains only the target executable plus selection
metadata. `resources/google-workspace/current` is generated output.

Electron packaging copies the selected executable, manifest, and legal notices
to its Google Workspace resources. After-pack validation checks target selection
and provenance. Windows signing records the shipped executable digest; macOS
records the nested signed digest before sealing the outer application. The
runtime verifies the corresponding shipped bytes, including signing-induced
changes, rather than silently skipping integrity checks for signed binaries.

The Kun-authored bundled skill has its own MIT license. That does not relicense
the upstream CLI; upstream license/notice files are shipped separately under
`resources/google-workspace/legal`.

## Verification and troubleshooting

Automated tests should cover fake process output and synthetic credentials only;
they must not inspect a developer's real `gws` files, sign in to Google, send
mail, change events, or use real OAuth secrets.

Relevant checks from the repository root:

```sh
npm run typecheck
(cd kun && npx vitest run src/google-workspace)
npm exec -- vitest run src/main/google-workspace-controller.test.ts src/main/google-workspace-ipc.test.ts src/preload/google-workspace.test.ts src/renderer/src/components/settings-section-integrations.test.ts
npm run test:packaging
npm run build
npm run check:bundled-skills
npm run check:file-lines
git diff --check
```

These are verification commands, not a claim that every platform, signing
identity, or real-account flow has been tested. Native signed macOS/Windows
packages and real-user OAuth require their own manual validation.

- Missing/integrity-failed binary: prepare the pinned development bundle or
  reinstall a correctly packaged app; do not run an arbitrary `gws` from PATH.
- Setup required: finish the project/client/test-user steps, then Refresh.
- Connection needs attention: check Google consent, scopes, API enablement, and
  organization policy, then reconnect if needed.
- Service test failure: sign-in and individual API permissions are separate;
  the test results identify the affected service without forwarding raw output.
- Output too large: narrow the query, use metadata or smaller pages, or export a
  smaller file. Never assume omitted/truncated data is absent.
- An uncertain mutation: read back its state before any new approval or retry.

## Pinned upstream behavior references

These links deliberately target the reviewed version rather than `main`:

- [Auth commands](https://github.com/googleworkspace/cli/blob/v0.22.5/crates/google-workspace-cli/src/auth_commands.rs): custom scopes, identity scopes, default config location, status fields, login/logout
- [CLI entry point](https://github.com/googleworkspace/cli/blob/v0.22.5/crates/google-workspace-cli/src/main.rs): dotenv initialization and command dispatch
- [API executor](https://github.com/googleworkspace/cli/blob/v0.22.5/crates/google-workspace-cli/src/executor.rs): JSON output, non-JSON media files, and successful empty responses
- [Error contract](https://github.com/googleworkspace/cli/blob/v0.22.5/crates/google-workspace/src/error.rs): API=1, auth=2, validation=3, discovery=4, internal=5
- [Credential store](https://github.com/googleworkspace/cli/blob/v0.22.5/crates/google-workspace-cli/src/credential_store.rs): encryption and platform-specific keyring/file fallback

When upgrading, review those behaviors, rederive the complete target manifest,
and rerun safety, packaging, and platform-signing checks together. A version-only
string change is not an integration upgrade.
