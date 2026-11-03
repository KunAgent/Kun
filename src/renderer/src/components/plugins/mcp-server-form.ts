import type { MarketMcpInstallPlan } from '@shared/market/market-types'
import {
  buildRemoteMcpServer,
  buildStdioMcpServer,
  isHttpsUrl,
  isJsonRecord,
  mcpServersFromConfig,
  parseMcpJsonConfig,
  type JsonRecord
} from '../plugin-marketplace-config'

export type McpKeyValue = { key: string; value: string }

/** One MCP server as the configure / edit sheet shows it. */
export type McpServerForm = {
  id: string
  transport: 'stdio' | 'remote'
  /** Transport string written back for remote servers (`streamable-http`, `sse`, ...). */
  remoteTransport: string
  command: string
  args: string[]
  env: McpKeyValue[]
  url: string
  headers: McpKeyValue[]
  timeoutSec: number
  enabled: boolean
}

export type McpFormError =
  | { code: 'command-required' }
  | { code: 'url-https' }
  | { code: 'env-key-invalid'; key: string }
  | { code: 'env-key-duplicate'; key: string }
  | { code: 'header-name-required' }

export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const SECRET_HINT = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|HEADERS|AUTHORIZATION|COOKIE)/i
const DEFAULT_TIMEOUT_SEC = 30
const REMOTE_TRANSPORTS = new Set(['streamable-http', 'http', 'sse'])

/** Names that usually carry a secret; their inputs start masked. */
export function isSecretField(name: string): boolean {
  return SECRET_HINT.test(name)
}

function keyValueRows(value: unknown): McpKeyValue[] {
  if (!isJsonRecord(value)) return []
  return Object.entries(value).map(([key, raw]) => ({ key, value: typeof raw === 'string' ? raw : String(raw ?? '') }))
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function serverToForm(id: string, server: JsonRecord): McpServerForm {
  const transport = typeof server.transport === 'string' ? server.transport : ''
  const remote = typeof server.url === 'string' || REMOTE_TRANSPORTS.has(transport)
  const timeoutMs = typeof server.timeoutMs === 'number' && Number.isFinite(server.timeoutMs) ? server.timeoutMs : 0
  return {
    id,
    transport: remote ? 'remote' : 'stdio',
    remoteTransport: remote && transport ? transport : 'streamable-http',
    command: typeof server.command === 'string' ? server.command : '',
    args: stringList(server.args),
    env: keyValueRows(server.env),
    url: typeof server.url === 'string' ? server.url : '',
    headers: keyValueRows(server.headers),
    timeoutSec: timeoutMs > 0 ? Math.round(timeoutMs / 1000) : DEFAULT_TIMEOUT_SEC,
    enabled: !(server.enabled === false || server.disabled === true)
  }
}

export function readMcpServer(configText: string, id: string): JsonRecord | undefined {
  try {
    const server = mcpServersFromConfig(parseMcpJsonConfig(configText))[id]
    return isJsonRecord(server) ? server : undefined
  } catch {
    return undefined
  }
}

export function readMcpServerForm(configText: string, id: string): McpServerForm | null {
  const server = readMcpServer(configText, id)
  return server ? serverToForm(id, server) : null
}

/** A fresh form for a market install: every declared key starts empty. */
export function formFromPlan(plan: MarketMcpInstallPlan): McpServerForm {
  const env = [...plan.requiredEnvKeys, ...plan.optionalEnvKeys]
    .filter((key, index, all) => all.indexOf(key) === index)
    .map((key) => ({ key, value: '' }))
  return {
    id: plan.id,
    transport: plan.transport,
    remoteTransport: 'streamable-http',
    command: plan.transport === 'stdio' ? plan.command : '',
    args: plan.transport === 'stdio' ? [...plan.args] : [],
    env,
    url: plan.transport === 'remote' ? plan.url : '',
    headers: [],
    timeoutSec: DEFAULT_TIMEOUT_SEC,
    enabled: true
  }
}

/**
 * Keys a server cannot run without: the market's declared required keys plus
 * any key stored as an empty placeholder (how Kun marks "fill this in").
 */
export function requiredEnvKeys(server: JsonRecord | undefined, declared: readonly string[]): string[] {
  const placeholders = keyValueRows(server?.env).filter((row) => row.value === '').map((row) => row.key)
  return [...new Set([...declared, ...placeholders])]
}

export function missingEnvKeys(env: readonly McpKeyValue[], required: readonly string[]): string[] {
  return required.filter((key) => !env.some((row) => row.key === key && row.value.trim() !== ''))
}

/** Missing keys for an installed server (remote servers only track headers, so none). */
export function missingEnvForServer(server: JsonRecord | undefined, declared: readonly string[]): string[] {
  if (!server) return []
  const form = serverToForm('', server)
  if (form.transport === 'remote') return []
  return missingEnvKeys(form.env, requiredEnvKeys(server, declared))
}

export function validateMcpServerForm(form: McpServerForm): McpFormError[] {
  const errors: McpFormError[] = []
  if (form.transport === 'stdio' && !form.command.trim()) errors.push({ code: 'command-required' })
  if (form.transport === 'remote' && !isHttpsUrl(form.url.trim())) errors.push({ code: 'url-https' })
  const seen = new Set<string>()
  for (const row of form.env) {
    const key = row.key.trim()
    if (!key && !row.value.trim()) continue
    if (!ENV_KEY_PATTERN.test(key)) errors.push({ code: 'env-key-invalid', key })
    else if (seen.has(key)) errors.push({ code: 'env-key-duplicate', key })
    seen.add(key)
  }
  if (form.headers.some((row) => !row.key.trim() && row.value.trim())) errors.push({ code: 'header-name-required' })
  return errors
}

function envRecord(rows: readonly McpKeyValue[], keepEmpty: ReadonlySet<string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) continue
    // An empty optional value would override the server's own default, so it
    // is dropped; an empty required value stays as the "fill this in" marker.
    if (row.value === '' && !keepEmpty.has(key)) continue
    env[key] = row.value
  }
  return env
}

function headerRecord(rows: readonly McpKeyValue[]): Record<string, string> {
  return Object.fromEntries(rows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]))
}

type ServersLocation = { servers: JsonRecord; write: (servers: JsonRecord) => JsonRecord }

function locateServers(config: JsonRecord): ServersLocation {
  if (isJsonRecord(config.servers)) {
    return { servers: config.servers, write: (servers) => ({ ...config, servers }) }
  }
  const capabilities = isJsonRecord(config.capabilities) ? config.capabilities : undefined
  const mcp = isJsonRecord(capabilities?.mcp) ? capabilities.mcp : undefined
  if (capabilities && mcp && isJsonRecord(mcp.servers)) {
    return {
      servers: mcp.servers,
      write: (servers) => ({ ...config, capabilities: { ...capabilities, mcp: { ...mcp, servers } } })
    }
  }
  return { servers: {}, write: (servers) => ({ ...config, servers }) }
}

/**
 * Writes `form` into the Kun config text, creating the server or updating it
 * in place. Fields the sheet does not edit (trust scope, roots, ...) survive.
 */
export function applyMcpServerForm(
  configText: string,
  form: McpServerForm,
  options: { requiredKeys?: readonly string[] } = {}
): string {
  const config = parseMcpJsonConfig(configText)
  const location = locateServers(config)
  const existing = isJsonRecord(location.servers[form.id]) ? location.servers[form.id] as JsonRecord : undefined
  const keepEmpty = new Set(options.requiredKeys ?? [])
  let next: JsonRecord
  if (form.transport === 'stdio') {
    const base = existing ?? buildStdioMcpServer(form.command.trim(), [])
    next = { ...base, transport: 'stdio', command: form.command.trim(), args: form.args.map((arg) => arg.trim()).filter(Boolean), env: envRecord(form.env, keepEmpty) }
    delete next.url
    delete next.headers
  } else {
    const base = existing ?? buildRemoteMcpServer(form.url.trim())
    next = { ...base, transport: form.remoteTransport || 'streamable-http', url: form.url.trim(), headers: headerRecord(form.headers) }
    delete next.command
    delete next.args
  }
  next.timeoutMs = Math.max(1, Math.round(form.timeoutSec || DEFAULT_TIMEOUT_SEC)) * 1000
  next.enabled = form.enabled
  delete next.disabled
  return `${JSON.stringify(location.write({ ...location.servers, [form.id]: next }), null, 2)}\n`
}

export function removeMcpServer(configText: string, id: string): string {
  const config = parseMcpJsonConfig(configText)
  const location = locateServers(config)
  if (!Object.prototype.hasOwnProperty.call(location.servers, id)) {
    throw new Error(`MCP server "${id}" does not exist.`)
  }
  const servers = { ...location.servers }
  delete servers[id]
  return `${JSON.stringify(location.write(servers), null, 2)}\n`
}
