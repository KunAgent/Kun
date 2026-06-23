import { readFile, watch } from 'node:fs'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  McpCapabilityConfig,
  McpServerConfig,
} from '../../contracts/capabilities.js'
import { redactSecretText } from '../../config/secret-redaction.js'

/**
 * Result of parsing an MCP config file.
 * Either a valid config or a list of errors with line numbers.
 *
 * Supports two formats:
 *   1. { servers: {...}, search: {...} }  (flat MCP config)
 *   2. { capabilities: { mcp: { servers: {...} } } }  (full kun config)
 */
export type McpConfigFileParseResult =
  | { ok: true; config: McpCapabilityConfig; servers: Record<string, z.infer<typeof McpServerConfig>> }
  | { ok: false; errors: McpConfigError[] }

export type McpConfigError = {
  message: string
  line?: number
  column?: number
  path?: string
  severity: 'error' | 'warning'
}

/**
 * Read and parse the MCP JSON config file with line-number-aware errors.
 */
export async function readMcpConfigFile(filePath: string): Promise<McpConfigFileParseResult> {
  let rawText: string
  try {
    rawText = await readFileUtf8(filePath)
  } catch (error) {
    const code = (error as { code?: string }).code
    if (code === 'ENOENT') {
      return {
        ok: true,
        config: McpCapabilityConfig.parse({ enabled: false, servers: {} }),
        servers: {},
      }
    }
    return {
      ok: false,
      errors: [{
        message: `Failed to read MCP config file: ${errorMessage(error)}`,
        severity: 'error',
      }],
    }
  }
  return parseMcpConfigText(rawText, filePath)
}

/**
 * Parse MCP config from raw text. Exported for testing and GUI live-editor.
 */
export function parseMcpConfigText(
  rawText: string,
  filePath = '<config>'
): McpConfigFileParseResult {
  const trimmed = rawText.trim()
  if (trimmed === '') {
    return {
      ok: true,
      config: McpCapabilityConfig.parse({ enabled: false, servers: {} }),
      servers: {},
    }
  }

  // Step 1: Parse JSON with position tracking
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (error) {
    const pos = extractJsonErrorPosition(error, trimmed)
    return {
      ok: false,
      errors: [{
        message: `JSON parse error in ${filePath}: ${errorMessage(error)}`,
        line: pos.line,
        column: pos.column,
        severity: 'error',
      }],
    }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      ok: false,
      errors: [{
        message: `MCP config must be a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`,
        line: 1,
        severity: 'error',
      }],
    }
  }

  // Step 2: Extract MCP section (supports flat and capabilities.mcp formats)
  const root = parsed as Record<string, unknown>
  const rawMcpSection = extractMcpSection(root)

  // Step 3: Normalize (infer transport, trust scope, etc.)
  const mcpSection = normalizeMcpConfigSection(rawMcpSection)

  // Step 4: Validate with Zod
  const result = McpCapabilityConfig.safeParse(mcpSection)
  if (result.success) {
    return { ok: true, config: result.data, servers: result.data.servers }
  }

  // Map Zod errors to line numbers
  const errors: McpConfigError[] = result.error.issues.map((issue) => {
    const jsonPath = issue.path.map((p) => String(p))
    const pos = findLineForJsonPath(trimmed, jsonPath)
    return {
      message: issue.message,
      line: pos.line,
      column: pos.column,
      path: jsonPath.join('.'),
      severity: 'error',
    }
  })

  return { ok: false, errors }
}

/**
 * Start watching an MCP config file for changes. Returns a stop function.
 * Debounces rapid changes (editor saves) with configurable delay.
 */
export function watchMcpConfigFile(
  filePath: string,
  onChange: (result: McpConfigFileParseResult) => void,
  options: { debounceMs?: number } = {}
): () => void {
  const debounceMs = options.debounceMs ?? 300
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  const trigger = (): void => {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      if (stopped) return
      void readMcpConfigFile(filePath).then(onChange).catch(() => undefined)
    }, debounceMs)
  }

  const watcher = watch(filePath, { persistent: false }, (eventType) => {
    if (eventType === 'change' || eventType === 'rename') trigger()
  })
  watcher.on('error', () => { /* non-fatal */ })

  return () => {
    stopped = true
    if (timer) clearTimeout(timer)
    watcher.close()
  }
}

/**
 * Write MCP config to file. Creates parent directories as needed.
 */
export async function writeMcpConfigFile(
  filePath: string,
  config: { servers: Record<string, unknown>; search?: unknown; timeouts?: unknown }
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

/** Check if an MCP config file exists. */
export async function mcpConfigFileExists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true } catch { return false }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readFileUtf8(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    readFile(path, 'utf8', (err, data) => { if (err) reject(err); else resolve(data) })
  })
}

function errorMessage(error: unknown): string {
  return redactSecretText(error instanceof Error ? error.message : String(error))
}

function extractJsonErrorPosition(
  error: unknown,
  source: string
): { line?: number; column?: number } {
  const message = error instanceof Error ? error.message : String(error)
  const posMatch = message.match(/at position (\d+)/i)
  if (posMatch) return positionToLineColumn(source, Number.parseInt(posMatch[1], 10))
  const lineMatch = message.match(/line (\d+)/i)
  const colMatch = message.match(/column (\d+)/i)
  if (lineMatch) return { line: Number.parseInt(lineMatch[1], 10), column: colMatch ? Number.parseInt(colMatch[1], 10) : undefined }
  return {}
}

function positionToLineColumn(text: string, position: number): { line: number; column: number } {
  const safePos = Math.max(0, Math.min(position, text.length))
  const lines = text.slice(0, safePos).split('\n')
  return { line: lines.length, column: lines[lines.length - 1].length + 1 }
}

function findLineForJsonPath(
  text: string,
  path: string[]
): { line?: number; column?: number } {
  if (path.length === 0) return { line: 1, column: 1 }
  const lines = text.split('\n')
  let depth = 0
  let pathIndex = 0
  const bestByDepth: Array<{ line: number; col: number }> = []

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()

    // Count closing braces (leaving nested objects)
    let closes = 0
    for (const char of trimmed) {
      if (char === '}' || char === ']') closes++
      else if (char === '{' || char === '[') break
    }
    depth -= closes

    // Look for key definitions: "key":
    const keyMatch = trimmed.match(/"([^"]+)"\s*:/)
    if (keyMatch) {
      const key = keyMatch[1]
      const col = lines[i].indexOf(`"${key}"`) + 1
      const keyDepth = depth
      const expectedDepth = pathIndex + 1

      if (key === path[pathIndex] && keyDepth === expectedDepth) {
        bestByDepth[pathIndex] = { line: i + 1, col }
        if (pathIndex < path.length - 1) pathIndex++
      } else if (keyDepth < expectedDepth) {
        pathIndex = Math.max(0, keyDepth - 1)
        if (key === path[pathIndex] && keyDepth === pathIndex + 1) {
          bestByDepth[pathIndex] = { line: i + 1, col }
        }
      }
    }

    // Count opening braces after key (entering nested objects)
    let opens = 0
    const afterKey = keyMatch ? trimmed.slice(trimmed.indexOf(':') + 1) : trimmed
    for (const char of afterKey) {
      if (char === '{' || char === '[') opens++
      else if (char === '}' || char === ']') opens--
    }
    depth += opens
  }

  if (bestByDepth.length > 0) {
    const best = bestByDepth[bestByDepth.length - 1]
    if (best) return { line: best.line, column: best.col || undefined }
  }
  return {}
}

function extractMcpSection(root: Record<string, unknown>): unknown {
  // Flat format: top-level servers
  if (root.servers !== undefined) {
    return {
      enabled: root.enabled !== false,
      servers: root.servers,
      search: root.search ?? {},
      ...(root.timeouts ? { timeouts: root.timeouts } : {}),
    }
  }
  // Full kun config format: capabilities.mcp
  const capabilities = isRecord(root.capabilities) ? root.capabilities : {}
  const mcp = isRecord(capabilities.mcp) ? capabilities.mcp : {}
  if (mcp.servers !== undefined) return mcp
  return { enabled: false, servers: {} }
}

function normalizeMcpConfigSection(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const next: Record<string, unknown> = { ...raw }
  if (isRecord(raw.servers)) {
    const normalizedServers: Record<string, unknown> = {}
    for (const [serverId, server] of Object.entries(raw.servers)) {
      normalizedServers[serverId] = normalizeMcpServerConfig(server)
    }
    next.servers = normalizedServers
  }
  return next
}

function normalizeMcpServerConfig(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const out: Record<string, unknown> = { ...raw }
  const command = typeof raw.command === 'string' ? raw.command : undefined
  const url = typeof raw.url === 'string' ? raw.url : undefined
  const trustedWorkspaceRoots = Array.isArray(raw.trustedWorkspaceRoots)
    ? raw.trustedWorkspaceRoots
    : undefined

  delete out.disabled

  if (raw.transport === undefined) {
    if (command) out.transport = 'stdio'
    else if (url) out.transport = 'streamable-http'
  }

  if (raw.trustScope === undefined) {
    out.trustScope = trustedWorkspaceRoots && trustedWorkspaceRoots.length > 0
      ? 'workspace' : 'user'
  }

  if (raw.disabled === true && raw.enabled === undefined) out.enabled = false
  if (out.enabled === undefined) out.enabled = true

  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
