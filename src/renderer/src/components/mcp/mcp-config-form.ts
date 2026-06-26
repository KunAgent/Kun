// Structured model + (de)serialization for the MCP server config edited in
// settings. The on-disk file (`~/.kun/mcp.json`) is the single source of
// truth; this module is the lossless-ish bridge between that JSON text and a
// form the user can fill in without knowing the schema.
//
// The canonical shape written back is always:
//   { ...preservedTopLevel, servers: { [name]: { transport, ... } } }
//
// On the way IN we are deliberately lenient so the common Claude Desktop /
// Cursor copy-paste format works too: we accept `mcpServers` (not just
// `servers`) and `type` (not just `transport`) with `http` aliased to
// `streamable-http`. This mirrors the leniency in the GUI importer
// (src/main/kun-process.ts normalizeGuiManagedMcpServer) so what the form
// accepts is what the runtime will actually load.

export type McpTransport = 'stdio' | 'streamable-http' | 'sse'

export type McpKeyValue = { key: string; value: string }

export type McpFormServer = {
  /** Stable React key; NOT persisted. Lets the name field be edited freely. */
  rowId: string
  /** The server id (record key) written to mcp.json. */
  name: string
  enabled: boolean
  transport: McpTransport
  command: string
  /** Working directory for stdio servers. Blank = runtime default/fallback. */
  cwd: string
  /** One CLI argument per entry; edited as a multiline textarea (one/line). */
  args: string[]
  env: McpKeyValue[]
  url: string
  headers: McpKeyValue[]
  /** Visibility roots. Empty = visible in every workspace. */
  workspaceRoots: string[]
  trustScope: 'user' | 'workspace'
  trustedWorkspaceRoots: string[]
  /** null = use the runtime default (30s). */
  timeoutMs: number | null
}

export type McpFormModel = {
  servers: McpFormServer[]
  /** Top-level keys other than servers/mcpServers, preserved on round-trip. */
  preserved: Record<string, unknown>
}

export type McpParseResult =
  | { ok: true; model: McpFormModel }
  | { ok: false; error: string }

const TRANSPORTS: readonly McpTransport[] = ['stdio', 'streamable-http', 'sse']

let rowIdCounter = 0
function nextRowId(): string {
  rowIdCounter += 1
  return `mcp-row-${rowIdCounter}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(asString).filter((entry) => entry.length > 0)
}

function asKeyValues(value: unknown): McpKeyValue[] {
  if (!isRecord(value)) return []
  return Object.entries(value).map(([key, raw]) => ({ key, value: asString(raw) }))
}

function normalizeTransport(
  rawTransport: unknown,
  command: string,
  url: string
): McpTransport {
  const candidate = asString(rawTransport).trim().toLowerCase()
  if (candidate === 'stdio') return 'stdio'
  if (candidate === 'streamable-http' || candidate === 'streamablehttp' || candidate === 'http') {
    return 'streamable-http'
  }
  if (candidate === 'sse') return 'sse'
  // No (recognized) transport given — infer from which fields are present.
  if (command) return 'stdio'
  if (url) return 'streamable-http'
  return 'stdio'
}

function parseServerEntry(name: string, raw: unknown): McpFormServer {
  const record = isRecord(raw) ? raw : {}
  const command = asString(record.command).trim()
  const url = asString(record.url).trim()
  // Accept both `transport` (kun) and `type` (Claude Desktop) field names.
  const transport = normalizeTransport(record.transport ?? record.type, command, url)
  const workspaceRoots = asStringArray(record.workspaceRoots)
  const trustedWorkspaceRoots = asStringArray(record.trustedWorkspaceRoots)
  const rawScope = asString(record.trustScope).trim().toLowerCase()
  const trustScope: 'user' | 'workspace' =
    rawScope === 'workspace' || rawScope === 'user'
      ? rawScope
      : trustedWorkspaceRoots.length > 0
        ? 'workspace'
        : 'user'
  const enabled = record.enabled === false || record.disabled === true ? false : true
  const timeoutRaw = record.timeoutMs
  const timeoutMs =
    typeof timeoutRaw === 'number' && Number.isFinite(timeoutRaw) && timeoutRaw > 0
      ? Math.floor(timeoutRaw)
      : null

  return {
    rowId: nextRowId(),
    name,
    enabled,
    transport,
    command,
    cwd: asString(record.cwd).trim(),
    args: asStringArray(record.args),
    env: asKeyValues(record.env),
    url,
    headers: asKeyValues(record.headers),
    workspaceRoots,
    trustScope,
    trustedWorkspaceRoots,
    timeoutMs
  }
}

/** Build a blank server row for the "add server" action. */
export function createBlankMcpServer(transport: McpTransport = 'stdio'): McpFormServer {
  return {
    rowId: nextRowId(),
    name: '',
    enabled: true,
    transport,
    command: '',
    cwd: '',
    args: [],
    env: [],
    url: '',
    headers: [],
    workspaceRoots: [],
    trustScope: 'user',
    trustedWorkspaceRoots: [],
    timeoutMs: null
  }
}

/**
 * Parse the raw mcp.json text into the form model. An empty / whitespace-only
 * string is valid and yields an empty model. Invalid JSON or a non-object
 * root returns `{ ok: false }` so the caller can fall back to the raw editor.
 */
export function parseMcpConfigText(text: string): McpParseResult {
  const trimmed = text.trim()
  if (!trimmed) {
    return { ok: true, model: { servers: [], preserved: {} } }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: 'Config root must be a JSON object.' }
  }

  // Servers can live at the top level under `servers` (kun) or `mcpServers`
  // (Claude Desktop / Cursor). Everything else at the top level is preserved.
  const serversSource = isRecord(parsed.servers)
    ? parsed.servers
    : isRecord(parsed.mcpServers)
      ? parsed.mcpServers
      : {}
  const preserved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'servers' || key === 'mcpServers') continue
    preserved[key] = value
  }

  const servers = Object.entries(serversSource).map(([name, raw]) => parseServerEntry(name, raw))
  return { ok: true, model: { servers, preserved } }
}

function keyValuesToRecord(entries: McpKeyValue[]): Record<string, string> {
  const record: Record<string, string> = {}
  for (const { key, value } of entries) {
    const trimmedKey = key.trim()
    if (!trimmedKey) continue
    record[trimmedKey] = value
  }
  return record
}

/** Serialize one form server into its canonical mcp.json object form. */
export function serializeMcpServer(server: McpFormServer): Record<string, unknown> {
  const out: Record<string, unknown> = { transport: server.transport }
  if (!server.enabled) out.enabled = false

  if (server.transport === 'stdio') {
    if (server.command.trim()) out.command = server.command.trim()
    if (server.cwd.trim()) out.cwd = server.cwd.trim()
    const args = server.args.map((arg) => arg).filter((arg) => arg.length > 0)
    if (args.length > 0) out.args = args
    const env = keyValuesToRecord(server.env)
    if (Object.keys(env).length > 0) out.env = env
  } else {
    if (server.url.trim()) out.url = server.url.trim()
    const headers = keyValuesToRecord(server.headers)
    if (Object.keys(headers).length > 0) out.headers = headers
  }

  out.trustScope = server.trustScope
  const workspaceRoots = server.workspaceRoots.map((r) => r.trim()).filter(Boolean)
  if (workspaceRoots.length > 0) out.workspaceRoots = workspaceRoots
  if (server.trustScope === 'workspace') {
    const roots = server.trustedWorkspaceRoots.map((r) => r.trim()).filter(Boolean)
    if (roots.length > 0) out.trustedWorkspaceRoots = roots
  }
  if (server.timeoutMs && server.timeoutMs > 0) out.timeoutMs = server.timeoutMs
  return out
}

/**
 * Serialize the full form model back to pretty-printed mcp.json text. Servers
 * with a blank name are dropped (they can't be keyed); later duplicates of a
 * name win, matching JSON object semantics.
 */
export function serializeMcpConfig(model: McpFormModel): string {
  const servers: Record<string, unknown> = {}
  for (const server of model.servers) {
    const name = server.name.trim()
    if (!name) continue
    servers[name] = serializeMcpServer(server)
  }
  const out: Record<string, unknown> = { ...model.preserved, servers }
  return `${JSON.stringify(out, null, 2)}\n`
}

export type McpServerFieldError = {
  rowId: string
  field: 'name' | 'command' | 'url' | 'trustedWorkspaceRoots'
  message: string
}

/**
 * Validate the form model. Returns a flat list of field-level errors. Empty
 * list = safe to save. Messages are i18n keys' fallbacks resolved by the
 * caller via the `messages` map so this stays UI-framework free.
 */
export function validateMcpServers(
  servers: McpFormServer[],
  messages: {
    nameRequired: string
    nameDuplicate: string
    commandRequired: string
    urlRequired: string
    urlInvalid: string
    workspaceRootsRequired: string
  }
): McpServerFieldError[] {
  const errors: McpServerFieldError[] = []
  const seenNames = new Map<string, number>()

  for (const server of servers) {
    const name = server.name.trim()
    if (!name) {
      errors.push({ rowId: server.rowId, field: 'name', message: messages.nameRequired })
    } else {
      seenNames.set(name, (seenNames.get(name) ?? 0) + 1)
    }

    if (server.transport === 'stdio') {
      if (!server.command.trim()) {
        errors.push({ rowId: server.rowId, field: 'command', message: messages.commandRequired })
      }
    } else {
      const url = server.url.trim()
      if (!url) {
        errors.push({ rowId: server.rowId, field: 'url', message: messages.urlRequired })
      } else if (!isValidHttpUrl(url)) {
        errors.push({ rowId: server.rowId, field: 'url', message: messages.urlInvalid })
      }
    }

    if (server.trustScope === 'workspace') {
      const roots = server.trustedWorkspaceRoots.map((r) => r.trim()).filter(Boolean)
      if (roots.length === 0) {
        errors.push({
          rowId: server.rowId,
          field: 'trustedWorkspaceRoots',
          message: messages.workspaceRootsRequired
        })
      }
    }
  }

  // Flag every row sharing a duplicated name.
  for (const server of servers) {
    const name = server.name.trim()
    if (name && (seenNames.get(name) ?? 0) > 1) {
      errors.push({ rowId: server.rowId, field: 'name', message: messages.nameDuplicate })
    }
  }

  return errors
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export function isMcpTransport(value: string): value is McpTransport {
  return (TRANSPORTS as readonly string[]).includes(value)
}
