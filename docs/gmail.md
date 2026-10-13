# Gmail in Kun

Gmail is an optional connection for private Agent and Code conversations. Kun
Google sign-in and Gmail authorization are separate. Connecting Gmail requests
`gmail.readonly` and `gmail.send` in the system browser.

Email processing follows the conversation's configured models and routes. The
Gmail card does not require a specific provider, a reviewed API account, a
training-opt-out record, or a dedicated local model. Model changes, automatic
routing and configured failover remain available under the user's normal
settings. These choices can change which service receives requested email data.
Kun makes no universal training, retention, location or local-only guarantee for
those providers. See [model processing](gmail-provider-policy.md).

Google OAuth token exchange and Gmail API requests use the application's explicit
global network proxy first. When none is configured on macOS, they use the system's
enabled global HTTPS proxy; settings are read with the fixed `scutil --proxy`
utility and cached for ten seconds. Disabled, missing, malformed or unsupported
settings use direct networking. PAC scripts, scoped proxy routes and system proxy
authentication are unsupported. This fallback changes no system or application
preferences and never applies to managed local inference or model provider requests.
When the Agent needs email access, it presents a compact Gmail connection card.
Connect your Google account and enable the one default-off permission to process
requested mail with the currently configured models. The card explains that
requested mail headers, addresses, snippets, plain-text bodies and related chat
context can be provided to those models. Longer data-use and connection-management
information is collapsed. The card has no model preparation or provider-review
instructions, and loading never displays a guessed local-model recipient.

Each private conversation needs its own permission. Google authorization alone
does not let the Agent read mail. Existing local-only or exact-DeepSeek grants
need a fresh generic conversation confirmation; they are not automatically
expanded to all configured models. After that confirmation, provider changes do
not require another account review or permission checkbox. Turning permission
off stops further Gmail use for that conversation.

After authorization, return to Kun, then choose **Continue this task**. Kun checks
the current Google scopes and conversation grant before resuming the recorded task.
Cancelling or skipping leaves email unavailable. A failed or expired authorization
can be retried from the card. **Switch Google account** opens a new Google account
selection; it does not choose an account silently.

Searching and reading return plain text. Email HTML is not executed and embedded
remote images are not loaded. Mail content is untrusted evidence; instructions in
an email do not authorize actions. Sending requires a separate host approval that
shows the complete recipients, subject, and body. Connecting Gmail does not approve
any future send.

OAuth exchanges and Gmail requests run on the local Kun runtime. OAuth credentials
are encrypted locally and are not written to conversations. Requested mail data,
generated summaries, and replies may remain in local chat history and operational
records. Gmail HTTP model requests are excluded from optional model-debug capture.
There is no separate full-inbox cache.

If you enable paired-device remote access, your authenticated paired device can
view canonical conversation history and live SSE messages, including Gmail
content, summaries, and replies. The data uses your selected direct connection or
tunnel and its transport service. Model processing follows the configured providers and routes covered by the
conversation permission; Gmail OAuth tokens and model credentials are not sent to remote clients. IM bridges are
blocked for Gmail conversations. Use the existing pairing and connection controls
to manage remote viewing. Using the local model does not mean all email-derived
content is confined to the desktop, and does not establish a security-assessment exemption.

**Disconnect locally** deletes local Gmail credentials and all conversation Gmail
grants. Existing conversations and debug records remain until separately deleted.
**Also revoke Kun's Google access** first shows a warning: Google's project-wide
revocation may affect other Kun OAuth clients, including Google sign-in. Confirming
that action also deletes the local credentials and grants.

The runtime derives scope identity from verified room/card or thread references.
Private Room controls use `roomId` and `messageId`; Code controls use `threadId`.
The renderer never handles OAuth tokens. Code continuation additionally binds the
original turn and tool call, so a stale card cannot resume an unrelated task.

Gmail OAuth requires a configured desktop OAuth client in the existing Kun Google
project, Gmail API enabled, and the two declared scopes. Production distribution
requires Google's sensitive/restricted-scope review and any applicable security
assessment; the existing Google brand verification covers branding only.

Public data-use disclosure: <https://www.kun-agent.com/privacy>.

## Local review configuration

The current Google Desktop client requires its Client Secret during token exchange.
For the local review build, close Kun and install the operator's fixed-client
configuration using a hidden terminal prompt:

```sh
node kun/dist/cli/gmail-oauth-client-entry.js --data-dir ~/.kun/data
```

Only the registered Kun Desktop client is accepted. The installer reserves the
normal Service Manager owner, encrypts the configuration, and never prints the
secret. Google client credentials belong outside Git, URLs and chat messages.

The earlier `gmail-deepseek-evidence-entry` operator record is not a prerequisite
for this model-neutral flow. The generic conversation permission is the current
model-processing control; it does not attest to any provider's training policy.

## Publisher-configured macOS packages

Ordinary users connect Gmail by granting Google permissions; they do not install
developer credentials or run terminal commands. For an explicitly Gmail-enabled
official macOS package, the publisher supplies Google's downloaded credentials
for the fixed Kun Desktop client from a private file outside this repository:

```sh
KUN_GMAIL_RELEASE_ENABLED=1 \
KUN_GMAIL_CLIENT_CONFIG_FILE=/private/publisher/kun-desktop-client.json \
npm run dist:mac:signed
```

The build hook accepts only the reviewed Desktop client ID and Google's expected
credentials structure, and writes the Git-ignored
`kun/dist/resources/gmail-native-client.json`. The flag must be `1`, the package
target must be macOS, and missing or invalid configuration stops packaging. A
build with the flag absent or `0` removes any stale generated configuration, so
unrelated CI packages remain Gmail-disabled without needing publisher credentials.
The environment contains a file path only, never the Client Secret itself.

Runtime reads only that fixed resource next to its own modules. On first startup,
the application-owned Manager stores it in the existing encrypted local store
after storage-protection validation. A changed fixed-client configuration in an
official package updates the encrypted copy; identical configurations cause no
write. Invalid package data or damaged encrypted local state fails closed. Local
review installations can still use the operator command when no resource exists.

Google treats native applications as public clients. The shared Desktop Client
Secret is extractable from an installation and does not prove client identity;
package signing protects distribution integrity, not credential confidentiality.
OAuth tokens remain user-specific and encrypted, with S256 PKCE, state validation
and explicit Gmail consent. Do not commit publisher credentials or publish them
as source artifacts. See [Google's native app flow](https://developers.google.com/identity/protocols/oauth2/native-app)
and [OAuth credential handling policy](https://developers.google.com/identity/protocols/oauth2/policies).

This bootstrap currently supports macOS with verified FileVault-protected storage.
It does not enable unsupported Windows/Linux Gmail storage or bypass Google
account authorization, conversation permission or exact-message send approval.
Packaged configuration does not establish Google Gmail scope approval or
security-assessment completion. The previous fixed-model public disclosure and
review video do not validate this broader model-neutral flow; privacy publication
and verification submission remain separate pending steps.
