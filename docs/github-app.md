# GitHub App connection in Kun

GitHub connects from a card in native Kun Code and private Agent conversations.
Users do not install `gh`, create a personal access token, or enter developer
credentials. This connection is independent of Kun account sign-in.

The user clicks **Connect GitHub**, accepts the browser authorization, and selects
repositories when installing Kun Desktop. If the account is already connected,
another conversation requires **Use GitHub in this conversation**. The card explains
that requested code, issues, PRs and related conversation context can go to the
conversation's configured models, including routing and failover. Credentials
remain inside Runtime and never reach the renderer or model.

After authorization and repository access are verified, the card continues the
original task. Code continuation binds the persisted native `github_connect` result,
thread, source turn and tool call. A stable request ID prevents duplicate turns;
an active source turn is retried, while superseded or aborted tasks are rejected.
Private Agent cards use the existing durable app-connection continuation mechanism.
Cancellation, account switching, grant revocation and shutdown fence pending work.

This connector is read-only, matching the existing built-in GitHub MCP scope.
`github_list_tools` discovers the official read-tool schemas and `github_read`
calls an allowlisted operation through GitHub's `/mcp/readonly` endpoint. There is
no write-tool or token HTTP endpoint. Returned text is untrusted reference data;
remote HTML, MCP App content and images are not executed. The older plugin-page
credential connector remains separate and is not used by this card.

## Registered publisher application

Registered on 2026-10-23 under the **KunAgent** organization:

- Name: **Kun Desktop**
- Public page: <https://github.com/apps/kun-desktop>
- Settings: <https://github.com/organizations/KunAgent/settings/apps/kun-desktop>
- App ID: `5438804`
- Public Client ID: `Iv23li8xc41xacMCT6td`
- Homepage: <https://www.kun-agent.com>
- Logo: the existing official `src/asset/img/kun_mac.png` icon, uploaded and verified.
- Exact callback: `http://127.0.0.1:42813/oauth/github/callback`
- Repository permissions: Contents, Issues and Pull requests **read-only**;
  Metadata is the mandatory read-only permission.
- Organization, account and enterprise permissions: no additional access.
- Expiring user tokens: enabled.
- Wildcard redirects, device flow, OAuth during installation and webhooks: disabled.
- Installable by any account; each owner chooses repositories and approves installation.

The previously existing personal **Kunserve OAuth App** is for unified sign-in and
was not changed. The new GitHub App has not been installed into any repository by
this implementation session.

## Authorization and storage

Runtime binds the registered callback on IPv4 loopback before opening the system
browser. It uses random state, S256 PKCE, a one-use callback and a ten-minute
deadline. An occupied callback port fails with retry guidance; it never selects
an unregistered fallback port. Callback redirects remove the authorization code
from the final browser page. Errors and status responses contain no credentials.

The App uses **user access tokens**, restricted by both the user's access and the
App installation. Runtime requests `offline_access`, validates the user ID, rotates
expiring tokens with a single in-flight refresh and encrypts the token/grant state
using the existing OS-backed encryption service. Service Manager owns writes to
`mcp-oauth/native-github-app.json`. A new account clears old conversation grants;
revocation requires reconnecting and never falls back to `gh` or environment PATs.

**Disconnect locally** removes local credentials and grants. It does not delete
existing conversation history or uninstall the App on GitHub. Users can revoke
GitHub-side authorization or change repository access under GitHub Settings →
Applications. Repository inventory previews show up to 100 names; the count comes
from GitHub and actual access is enforced by GitHub for every tool call.

## Publisher configuration and packaging

The publisher configuration and the private key are stored outside all repositories
in `/Users/zxy/.config/kun-publisher/github-app/` on the publisher's machine.
The directory is mode `0700`; files are mode `0600`. Never commit or paste their
contents into a conversation, environment value, build log or issue.

`client.json` contains `schemaVersion`, the fixed `clientId`, `clientSecret`, the
fixed `slug` and exact `callbackUrl`. No private-key field is accepted. GitHub
requires a key pair before installation is available; its private key is retained
only in the publisher's private directory and is **never shipped to clients**.

GitHub's authorization-code flow currently requires a client secret even for native
public clients. The shared native-client secret is extractable from an installation
and does not prove publisher identity. S256 PKCE binds an authorization code to its
initiating client. Do not use this shared secret as authentication to Kun services.
See GitHub's [native-client credential guidance](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app#client-secrets).

After building Runtime, prepare an explicitly enabled official release:

```sh
KUN_GITHUB_APP_RELEASE_ENABLED=1 \
KUN_GITHUB_APP_CLIENT_CONFIG_FILE=/private/publisher/github-app/client.json \
npm run dist:mac:signed
```

The `before-pack.cjs` hook validates the private source and writes only the native
client configuration to ignored `kun/dist/resources/github-app-client.json`.
Disabled builds remove any stale resource. Missing or malformed configuration
stops an explicitly enabled package. Runtime reads only this fixed packaged
resource; the renderer and model cannot override clients or callback URLs.

For local development after `npm run build:kun`, run the same preparer directly
with the two publisher variables set:

```sh
node scripts/prepare-github-app-resource.cjs
```

## Validation

Tests cover real loopback callbacks, PKCE/state and replay rejection, encrypted
persistence, separate conversation consent, refresh rotation, disconnect races,
host-token enforcement, strict binding schemas, durable Room cards, idempotent Code
continuation, renderer cancellation and delayed responses, and packaging boundaries.
These tests use synthetic tokens and mocked GitHub endpoints. App registration and
logo publication are live; actual user authorization, repository installation and
real GitHub MCP access require a separate account/repository smoke test.

Local verification on 2026-10-23:

- 35 Runtime tests and 14 renderer/IPC tests passed (49 total).
- `npm run typecheck`, `npm run build`, changed-file ESLint, the 700-line gate,
  and `git diff --check` passed. The full build retains existing chunk-size and
  circular-reexport warnings outside this change.
- A browser preview using the real React card verified the disconnected,
  conversation-grant, connected, repository-selection, waiting and cancellation
  states. The preview used synthetic connection status and did not authorize GitHub.
- The publisher preparer successfully loaded the new private configuration.
  A compiled Runtime smoke test reported `configured: true`, `connected: false`,
  `allowModelSharing: false`, with no browser or GitHub network request.
- The generated client resource is Git-ignored; the application private key is
  absent from client resources. Publisher credentials are absent from all changed
  source files. No Git commit, push, release package publication or repository
  installation was performed.
