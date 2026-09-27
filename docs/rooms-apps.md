# Apps in Rooms

Rooms uses Kun's existing MCP transport and OAuth credential store. The Rooms
header opens an app panel that reads the live, secret-free MCP configuration,
connection diagnostics, and OAuth status. It does not copy provider tokens into
Room messages or renderer state.

The panel adds a remote app through `POST /v1/mcp/remote-apps/:id`. This route
accepts only a new server ID and a credential-free HTTPS URL, then creates a
user-trusted, OAuth-enabled streamable HTTP MCP server. The renderer's runtime
IPC allowlist exposes this narrow route rather than general MCP configuration
writes. `POST /v1/mcp/oauth/:id` explicitly starts browser authorization; Kun
stores and refreshes the resulting tokens. A successful authorization registers
the server's tools in the live runtime without restarting the desktop app.

## Connection cards in a conversation

A private Agent can list app IDs with `list_room_apps` and request one with
`request_app_connection`. The tool accepts a built-in app or an already
configured OAuth MCP server. It checks the active Room, member, turn, run and
Agent MCP deny-list, then publishes one durable `app_connection` message. Model
text supplies only a short reason. The card resolves the server ID against
Kun's configuration or built-in catalog; the model never supplies an OAuth URL.

The user can select **Continue** or **Skip** in the card. Continue installs a
built-in endpoint if needed and opens the provider's browser OAuth flow. The
Room route checks both the persisted OAuth status and live MCP connection
before marking the card connected. Kun then queues one continuation of the
original private request. Skip records the decision and queues a continuation
that proceeds without app access. The continuation service rechecks the
original turn, Room membership, Agent permissions and whether a newer user
turn has superseded the request. When it cannot safely resume, the resolved
card remains visible and the user can continue with a new message.

The suggested Google Workspace endpoints are part of Google's Developer
Preview. Users must complete Google's Cloud/OAuth setup before sign-in can
succeed. The panel links to the
[official setup guide](https://developers.google.com/workspace/guides/configure-mcp-servers).
Other services can be added with a remote HTTPS MCP URL. Existing MCP servers
remain visible in the panel, while detailed configuration stays in Plugins.

Private Agent conversations and permitted execution tasks can use connected
MCP tools. Existing Agent `blockedMcpServers` and tool policy ceilings still
apply. Group discussion and review turns retain their read-only tool boundary,
which excludes arbitrary connected-app tools. The panel shows Kun connection
status; it does not imply that every Room member may use every server.
