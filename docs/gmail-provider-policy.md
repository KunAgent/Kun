# Gmail model processing

Updated 2026-10-13 for the requested model-neutral workflow.

Gmail uses the models and routes the user has configured for the conversation.
There is no Gmail-only provider allowlist, host account-review prerequisite,
training opt-out proof, fixed model requirement, or automatic local-model setup.
Changing models does not disable Gmail or require another provider review.
Normal provider availability, credentials and routing settings still apply.

## Conversation permission

The Gmail card has one default-off permission to process requested mail using the
configured models. It is given by the card's single action (**Connect Google
account**, or **Use Gmail in this conversation** when the account is already
connected), with the permission stated beside that button. The permission covers
the requested headers, addresses, snippets, plain-text bodies, related
conversation context, summaries and drafts. It applies only to the selected
private conversation. Other conversations require their own permission. A Google
account connected from another conversation does not grant it, and **Manage ›
Stop using Gmail in this conversation** withdraws it.

Model selection, automatic routing, provider/account failover and configured
model gateways can change which provider receives the data. The card explains
that processing follows those configured routes. It does not claim that all
providers avoid training, that processing is always local, or that any provider
has zero retention. Data policies and account options belong to the selected
providers; this release does not attest to them on the user's behalf.

The current permission is stored as `configured-models-v1`. Previous local-only
or exact-DeepSeek grants do not silently expand to the new policy: the user must
check the generic conversation permission once. Changing providers afterward
keeps that conversation-wide permission. Disabling it or disconnecting must stop
subsequent Gmail operations; pending physical requests retain permission fences.

## Controls that remain

- Google OAuth still requires explicit human authorization, S256 PKCE, one-time
  state, a local callback and the required Gmail scopes.
- The local runtime owns encrypted OAuth credentials. Neither the renderer nor
  model prompts receive Gmail OAuth tokens.
- Email search/read returns bounded plain text, not executable HTML or remote
  tracking images. Message instructions are untrusted input.
- Every send still needs the full sender, recipients, subject and body approved
  by a human; a model instruction or general full-access mode cannot replace it.
- Connecting, switching an account, cancellation, retry, disconnect and Google
  revocation remain independent actions. Revocation can affect other OAuth
  clients in the same Google project and requires its own warning/confirmation.

This changes the earlier fixed-recipient policy. Historical provider research in
[gmail-deepseek-review.md](gmail-deepseek-review.md) is background, not an active
feature gate or a guarantee about a user's present provider configuration.

Google brand verification does not approve Gmail restricted/sensitive scopes.
The earlier public policy and demonstration represented the fixed-model flow.
They must be updated and reviewed before claiming the broader model-neutral
flow is ready for submission. No Google verification or security-assessment
approval is claimed by this document.
