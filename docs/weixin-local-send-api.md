# WeChat local send API

## Consumers and boundary

This API is for local Kun processes that need to send text to a WeChat conversation already configured in the GUI. It listens only on `127.0.0.1` in the built-in WeChat bridge. It does not change the existing Kun runtime HTTP/SSE API, `/health`, or `/api/v1/admin/rpc`.

Discover the active port from the existing bridge state file:

- macOS: `~/Library/Application Support/Kun/weixin-bridge/config.json`
- Read `gateway.port`; the default search starts at `18790` and may select a later port.

Authentication reuses the configured Connect IM secret (`claw.im.secret`). The endpoint fails closed when the secret is empty. Send either:

```text
Authorization: Bearer <secret>
```

or the compatibility header `x-kun-secret: <secret>`. Existing `x-deepseek-gui-secret` callers remain accepted.

## Request

```http
POST /api/v1/messages/send
Content-Type: application/json
Authorization: Bearer <secret>
```

```json
{
  "channelId": "channel_weixin",
  "conversationId": "conversation_123",
  "text": "hello",
  "idempotencyKey": "daemon:daily-report:2026-08-18"
}
```

All four fields are required, trimmed, non-empty strings. `channelId` must identify an enabled WeChat channel. `conversationId` is a configured conversation ID, not a raw remote chat ID; the server resolves the account and chat target from current settings. Unknown request fields are ignored for additive compatibility.

`idempotencyKey` is process-lifetime scoped. Repeating the same key with the same resolved target and payload returns the same result without another upstream send. Reusing it with a different request returns `409 idempotency_conflict`.

## Responses

A send is `accepted` only after the WeChat upstream HTTP request and its business-level `ret`/`errcode`/`ok` validation succeed. It is not a recipient delivery receipt.

```http
HTTP/1.1 202 Accepted
```

```json
{
  "status": "accepted",
  "messageId": "kun-weixin-...",
  "idempotencyKey": "daemon:daily-report:2026-08-18"
}
```

Every failure has real `rejected` semantics:

```json
{
  "status": "rejected",
  "error": {
    "code": "send_failed",
    "message": "sendMessage business error ret=..."
  },
  "idempotencyKey": "daemon:daily-report:2026-08-18"
}
```

Status codes:

| HTTP | code | Meaning |
| --- | --- | --- |
| 400 | `invalid_request` | JSON or required fields are invalid |
| 401 | `unauthorized` | Secret is wrong or missing |
| 404 | `channel_not_found` / `conversation_not_found` | Configured target is unavailable |
| 409 | `idempotency_conflict` | Key was used with another request |
| 502 | `send_failed` | WeChat transport or business validation rejected the send |
| 503 | `unauthorized` / `channel_not_configured` | Authentication or target resolution is not configured |

## Ordering and context token

Outbound sends are serialized per WeChat account and remote conversation. The latest in-memory context token is read only when a queued message reaches the head of that conversation. Inbound token rolls are persisted through a per-account write chain using temporary-file-plus-rename replacement, preventing overlapping writes from publishing partial or stale JSON.
