# Connect a personal Agent to IM

A private Agent can offer `request_app_connection` with `im.feishu` or
`im.weixin`. `list_room_apps` returns these separately from MCP apps. The
result is a durable native proposal in the existing conversation. It does
not register an app, open a browser, request a QR code, or authorize access.

## User flow

1. Read the card and choose **Continue to official QR** in the desktop app.
2. Scan the provider's returned QR in Feishu/Lark or WeChat and review its
   authorization. No QR is fabricated; authorization material is transient
   UI/Main-process state, never a Room message or model tool result.
3. Kun binds only the provider-verified scanning account to this Agent.
   Feishu requires `user_info.open_id`; WeChat requires `ilink_user_id`.
   Missing identity fails closed. An incoming stranger cannot claim ownership.
4. Send a private message from that account. The message enters the same
   private Room, persistent Agent identity, memory, model, sandbox and task
   queue. It does not create a second personal assistant.
5. Keep the desktop open. Progress and completed answers return to IM.
   Approvals, structured input, files and task cards remain in Kun; IM displays
   a notice for pending approval/input. A text reply in IM is never approval.
6. Disconnect from the card to close local admission and transports. Revoke
   provider-side authorization in the provider's settings if required. A new
   connection requires a fresh Agent proposal and explicit authorization.

## Official provider boundary (verified 2026-10-01)

- **Feishu / Lark:** official PersonalAgent registration QR plus the official
  Lark Node SDK's outgoing WebSocket connection. No public inbound server is
  needed. [Official SDK](https://github.com/larksuite/node-sdk) and
  [official CLI](https://github.com/larksuite/cli)
- **WeChat:** Tencent's official channel and documented iLink QR flow, already
  bundled by Kun. This is an authorized bot conversation; it is not access to
  a user's personal message history or a reverse-engineered session.
  [Tencent repository](https://github.com/Tencent/openclaw-weixin) and
  [backend protocol](https://github.com/Tencent/openclaw-weixin/blob/main/docs/protocol.md)
- **WeCom / enterprise WeChat:** a separate official API and identity model.
  Its WebSocket SDK exists, but this slice does not advertise or connect it.
  [Official WeCom SDK](https://github.com/WecomTeam/aibot-node-sdk)

Platform availability, tenant permissions and provider verification steps
still apply. A provider requesting additional verification is surfaced as a
setup failure requiring the user's action, never silently bypassed.

## Security, persistence and compatibility

New personal-Agent connections use Electron `safeStorage` with no plaintext
fallback. Linux `basic_text` is rejected. The entire desktop connection
record is stored in an atomic encrypted envelope; new WeChat bot tokens are
also OS-protected, including persisted reply-context tickets. Credentials are not exposed by the native IPC results,
model tools, room cards, ordinary settings, or service diagnostic logs. Unlock
failure blocks connection and can be retried after the OS store is unlocked.

The Main-process IPC handler checks the current trusted workbench sender.
Registration/polling occurs only in that explicit setup flow. Cancellation,
expiry and stale results cannot enable a transport. Feishu accepts only
`p2p` messages from its bound owner; WeChat uses authenticated in-process
provider delivery and checks the exact account and owner. Protected WeChat
accounts cannot fall back into the older open loopback webhook path.

Inbound command IDs include connection, sender, chat and provider message
identity. The runtime's durable request store rejects altered replays and
admits exact retries once. IM requests cannot steer a GUI turn; accepted turns
and continuations retain `clientSurface: im`.

A single durable delivery cursor per connection follows later background
results as well as initial replies. Each exported message must belong to a
root request from that exact connection. Other IM connections and GUI-only
topics do not receive it. Recent outbound reservations/attention receipts are
bounded to 1,000 entries. A send interrupted after its reservation is marked
uncertain and never automatically replayed: its answer remains in Kun and the
native card reports the uncertainty. This is an explicit at-most-once retry
policy, not a claim of exactly-once network delivery.

Existing **Connect phone** channels retain their original behavior and are
not automatically migrated, paired, or made owner-only by this change. They
are separate from the new private-Agent consent flow.

## Verification

Automated coverage uses isolated temporary stores and mocked official-provider
responses. Tests cover owner/room binding, unknown senders/groups, duplicate
commands, cancellation during authorization, locked storage, restart cursors,
late background answers, two connections on one Room, GUI-only topic privacy,
pagination, disconnect races, expired QR and explicit UI consent.

`personal-agent-im-smoke.yml` builds the real Electron app on macOS, runs an
offline model that invokes the real connection-card tool, captures native
wide/narrow screenshots, verifies durable Skip, and checks safeStorage with a
disposable string. It never clicks authorization or connects a real account.
Live platform authorization and real-message round trips require a user's
explicit scan and were not performed as part of implementation.
