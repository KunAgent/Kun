/**
 * Minimal LSP client for the `lsp` AI tool.
 *
 * Speaks JSON-RPC 2.0 over stdio to a language server process (currently
 * typescript-language-server). Implements only what the tool needs:
 * initialize, textDocument/didOpen, and a handful of textDocument/ and
 * workspace/ requests. No subscriptions, no diagnostics, no completion —
 * this is a query-only client, not a full editor integration.
 *
 * Sessions are keyed by workspace root and reference-counted; when the last
 * caller releases, the server is kept alive briefly (CLEANUP_DELAY) before
 * being killed, so back-to-back tool calls don't respawn the server.
 */

import type { ChildProcess } from 'node:child_process'
import { spawnOwnedProcess, stopOwnedProcess } from '../../process/owned-process.js'
import { pathToFileURL } from 'node:url'
import { shellSpawnEnv } from './builtin-tool-utils.js'
import { collectWorkspaceDiagnostics, normalizeDiagnosticReport } from './lsp-diagnostics.js'
import { getLanguageServer, resolveServerCommand } from './lsp-servers.js'
import { handleNotification } from './lsp-notifications.js'

const CLEANUP_DELAY = 30_000
const REQUEST_TIMEOUT = 30_000
const BROKEN_SERVER_COOLDOWN_MS = 5 * 60_000
const STDERR_LOG_LIMIT = 200
const STDERR_LOG_TAIL = 20

type PendingRequest = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: NodeJS.Timeout
}

interface LspSession {
  process: ChildProcess
  workspaceRoot: string
  serverKey: string
  serverDisplayName: string
  pythonPath: string
  refCount: number
  cleanupTimer: NodeJS.Timeout | null
  /** Sequential buffer for stdout framing. */
  stdoutBuffer: Buffer
  /** Pending JSON-RPC requests awaiting a response, keyed by id. */
  pending: Map<string, PendingRequest>
  /** Monotonic request id counter. */
  nextId: number
  initialized: boolean
  initPromise: Promise<void> | null
  stderrLog: string[]
  diagnostics: Map<string, unknown[]>
  diagnosticIdentifier: string | null
  diagnosticRefreshRequested: boolean
  closing: boolean
  closed: boolean
}

/**
 * Map<workspaceRoot, Promise<LspSession>>.
 * Storing the Promise (not the resolved session) prevents a race where two
 * concurrent acquireLspSession calls both see sessions.get() === undefined
 * and each spawns their own server. The first caller writes its Promise
 * into the map before awaiting anything; the second caller awaits the same
 * Promise.
 */
const sessions = new Map<string, Promise<LspSession>>()
const activeSessions = new Set<LspSession>()
const closingSessions = new Map<LspSession, Promise<void>>()
const brokenServers = new Map<string, number>()

function sessionKey(workspaceRoot: string, serverKey: string): string {
  return `${workspaceRoot}::${serverKey}`
}

function markBrokenServer(workspaceRoot: string, serverKey: string): void {
  brokenServers.set(sessionKey(workspaceRoot, serverKey), Date.now())
}

function clearBrokenServer(workspaceRoot: string, serverKey: string): void {
  brokenServers.delete(sessionKey(workspaceRoot, serverKey))
}

function remainingCooldownMs(workspaceRoot: string, serverKey: string): number {
  const key = sessionKey(workspaceRoot, serverKey)
  const failedAt = brokenServers.get(key)
  if (failedAt === undefined) return 0
  const remaining = BROKEN_SERVER_COOLDOWN_MS - (Date.now() - failedAt)
  if (remaining <= 0) {
    brokenServers.delete(key)
    return 0
  }
  return remaining
}

function disposeSession(session: LspSession, terminateProcess: boolean): void {
  if (session.closed) return
  session.closed = true
  if (session.cleanupTimer) {
    clearTimeout(session.cleanupTimer)
    session.cleanupTimer = null
  }
  for (const [id, entry] of session.pending) {
    clearTimeout(entry.timer)
    entry.reject(new Error('LSP session closed'))
    session.pending.delete(id)
  }
  session.closing = true
  const closing = stopOwnedProcess(session.process, { graceMs: terminateProcess ? 1000 : 0 })
  closingSessions.set(session, closing)
  void closing.then(() => {
    activeSessions.delete(session)
    closingSessions.delete(session)
  }).catch(() => undefined)
}

function killSession(session: LspSession): void {
  disposeSession(session, true)
}

function sendMessage(session: LspSession, message: Record<string, unknown>): void {
  const body = JSON.stringify(message)
  const chunk = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
  session.process.stdin?.write(chunk)
}

function handleResponse(session: LspSession, msg: Record<string, unknown>): void {
  const id = String(msg.id ?? '')
  const entry = session.pending.get(id)
  if (!entry) return
  clearTimeout(entry.timer)
  session.pending.delete(id)
  if (msg.error) {
    entry.reject(new Error(typeof msg.error === 'object' && msg.error !== null && 'message' in msg.error
      ? String((msg.error as { message: unknown }).message)
      : 'LSP request failed'))
  } else {
    entry.resolve(msg.result)
  }
}

function configurationValueForSection(session: LspSession, section: string): Record<string, unknown> {
  switch (section) {
    case 'python':
      return session.pythonPath ? { pythonPath: session.pythonPath } : {}
    case 'python.analysis':
      return {
        diagnosticMode: 'openFilesOnly',
        typeCheckingMode: 'basic'
      }
    case 'basedpyright':
      return {
        disableLanguageServices: false,
        disablePullDiagnostics: false
      }
    case 'basedpyright.analysis':
      return {
        diagnosticMode: 'openFilesOnly',
        typeCheckingMode: 'basic'
      }
    default:
      return {}
  }
}

function handleServerRequest(session: LspSession, msg: Record<string, unknown>): void {
  const method = typeof msg.method === 'string' ? msg.method : ''
  const id = msg.id
  if (!method || id === undefined) return

  switch (method) {
    case 'workspace/configuration': {
      const params = msg.params
      const items = params && typeof params === 'object' && Array.isArray((params as { items?: unknown[] }).items)
        ? (params as { items: Array<Record<string, unknown>> }).items
        : []
      sendMessage(session, {
        jsonrpc: '2.0',
        id,
        result: items.map((item) => {
          const section = typeof item.section === 'string' ? item.section : ''
          return configurationValueForSection(session, section)
        })
      })
      return
    }
    case 'workspace/workspaceFolders': {
      sendMessage(session, {
        jsonrpc: '2.0',
        id,
        result: [
          {
            uri: pathToFileURL(session.workspaceRoot).href,
            name: session.workspaceRoot
          }
        ]
      })
      return
    }
    case 'client/registerCapability': {
      const registrations = msg.params && typeof msg.params === 'object'
        ? (msg.params as { registrations?: Array<Record<string, unknown>> }).registrations
        : null
      const diagnosticRegistration = registrations?.find((registration) => (
        registration.method === 'textDocument/diagnostic'
      ))
      const registerOptions = diagnosticRegistration?.registerOptions
      if (registerOptions && typeof registerOptions === 'object') {
        const identifier = (registerOptions as { identifier?: unknown }).identifier
        if (typeof identifier === 'string' && identifier.trim()) {
          session.diagnosticIdentifier = identifier
        }
      }
      sendMessage(session, {
        jsonrpc: '2.0',
        id,
        result: null
      })
      return
    }
    case 'workspace/diagnostic/refresh': {
      session.diagnosticRefreshRequested = true
      sendMessage(session, {
        jsonrpc: '2.0',
        id,
        result: null
      })
      return
    }
    default: {
      sendMessage(session, {
        jsonrpc: '2.0',
        id,
        result: null
      })
    }
  }
}

function processBuffer(session: LspSession): void {
  const headerSeparator = Buffer.from('\r\n\r\n')
  while (true) {
    const headerEnd = session.stdoutBuffer.indexOf(headerSeparator)
    if (headerEnd === -1) return
    const header = session.stdoutBuffer.subarray(0, headerEnd).toString('utf8')
    const lengthMatch = header.match(/Content-Length:\s*(\d+)/i)
    if (!lengthMatch) {
      // Malformed; drop the header to resync.
      session.stdoutBuffer = session.stdoutBuffer.subarray(headerEnd + headerSeparator.length)
      continue
    }
    const contentLength = Number(lengthMatch[1])
    const bodyStart = headerEnd + headerSeparator.length
    if (session.stdoutBuffer.length < bodyStart + contentLength) return // incomplete
    const body = session.stdoutBuffer.subarray(bodyStart, bodyStart + contentLength)
    session.stdoutBuffer = session.stdoutBuffer.subarray(bodyStart + contentLength)
    try {
      const msg = JSON.parse(body.toString('utf8')) as Record<string, unknown>
      if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
        handleResponse(session, msg)
      } else if (msg.id !== undefined && typeof msg.method === 'string') {
        handleServerRequest(session, msg)
        handleNotification(session, msg.method, msg.params)
      } else if (typeof msg.method === 'string') {
        handleNotification(session, msg.method, msg.params)
      }
    } catch {
      // Malformed JSON; skip.
    }
  }
}

async function initialize(session: LspSession): Promise<void> {
  if (session.initialized) return
  if (session.initPromise) return session.initPromise

  session.initPromise = (async () => {
    const initResult = await sendRequest(session, 'initialize', {
      processId: process.pid,
      rootUri: pathToFileURL(session.workspaceRoot).href,
      capabilities: {
        textDocument: {
          synchronization: { didOpen: true, didChange: false, willSave: false },
          publishDiagnostics: {
            relatedInformation: true,
            versionSupport: false
          },
          diagnostic: {
            dynamicRegistration: true,
            relatedDocumentSupport: false
          },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          definition: { linkSupport: false },
          references: {},
          documentSymbol: { hierarchicalDocumentSymbolSupport: false },
          implementation: {},
          callHierarchy: { dynamicRegistration: false }
        },
        workspace: {
          configuration: true,
          workspaceFolders: true,
          symbol: {}
        }
      },
      initializationOptions: session.serverKey === 'python'
        ? {
            diagnosticMode: 'openFilesOnly',
            disablePullDiagnostics: false
          }
        : undefined,
      workspaceFolders: [
        {
          uri: pathToFileURL(session.workspaceRoot).href,
          name: session.workspaceRoot
        }
      ]
    }).catch((err) => {
      throw new Error(`LSP initialize failed: ${err instanceof Error ? err.message : String(err)}`)
    })

    // ts_ls / typescript-language-server: pull out tsserver path from init result if present.
    void initResult
    sendNotification(session, 'initialized', {})
    sendDidChangeConfiguration(session)
    session.initialized = true
  })()

  return session.initPromise
}

function sendRequest(session: LspSession, method: string, params: Record<string, unknown> | null): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = String(session.nextId++)
    const timer = setTimeout(() => {
      session.pending.delete(id)
      reject(new Error(`LSP request "${method}" timed out after ${REQUEST_TIMEOUT}ms`))
    }, REQUEST_TIMEOUT)
    session.pending.set(id, { resolve, reject, timer })
    sendMessage(session, { jsonrpc: '2.0', id, method, params: params ?? {} })
  })
}

function sendNotification(session: LspSession, method: string, params: Record<string, unknown>): void {
  sendMessage(session, { jsonrpc: '2.0', method, params })
}

function sendDidChangeConfiguration(session: LspSession): void {
  if (session.serverKey !== 'python') return
  sendNotification(session, 'workspace/didChangeConfiguration', { settings: null })
}

/**
 * Acquire (or reuse) an LSP session for the given workspace.
 * The returned session is initialized and ready for requests.
 * Caller MUST call releaseLspSession when done.
 *
 * Race-safe: the in-flight Promise is written to the sessions map before
 * any await, so concurrent callers get the same session.
 */
export async function acquireLspSession(workspaceRoot: string, serverKey: string): Promise<LspSession> {
  const server = getLanguageServer(serverKey)
  if (!server) {
    throw new Error(`Unknown language server: ${serverKey}`)
  }
  const key = sessionKey(workspaceRoot, serverKey)
  const cooldown = remainingCooldownMs(workspaceRoot, serverKey)
  if (cooldown > 0) {
    const seconds = Math.ceil(cooldown / 1000)
    throw new Error(
      `${server.displayName} language server recently failed for this workspace. Retry in about ${seconds}s.`
    )
  }

  const existing = sessions.get(key)
  if (existing) {
    const session = await existing
    if (session.cleanupTimer) {
      clearTimeout(session.cleanupTimer)
      session.cleanupTimer = null
    }
    session.refCount += 1
    await initialize(session)
    return session
  }

  // Write the Promise immediately to prevent concurrent spawns.
  const sessionPromise = createSession(workspaceRoot, serverKey)
  sessions.set(key, sessionPromise)

  try {
    const session = await sessionPromise
    return session
  } catch (err) {
    // If spawn/init fails, remove the placeholder so the next call can retry.
    sessions.delete(key)
    throw err
  }
}

async function createSession(workspaceRoot: string, serverKey: string): Promise<LspSession> {
  const server = getLanguageServer(serverKey)
  if (!server) {
    throw new Error(`Unknown language server: ${serverKey}`)
  }
  const cmd = await resolveServerCommand(workspaceRoot, serverKey)
  if (!cmd) {
    throw new Error(
      `${server.displayName} language server is not installed or not available on PATH. ${server.installHint}`
    )
  }

  const proc = await spawnOwnedProcess(cmd.command, cmd.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: workspaceRoot,
    env: {
      ...shellSpawnEnv(),
      ...cmd.env
    },
    windowsHide: true
  })

  const session: LspSession = {
    process: proc,
    workspaceRoot,
    serverKey,
    serverDisplayName: server.displayName,
    pythonPath: 'python3',
    refCount: 1,
    cleanupTimer: null,
    stdoutBuffer: Buffer.alloc(0),
    pending: new Map(),
    nextId: 1,
    initialized: false,
    initPromise: null,
    stderrLog: [],
    diagnostics: new Map(),
    diagnosticIdentifier: null,
    diagnosticRefreshRequested: false,
    closing: false,
    closed: false
  }
  activeSessions.add(session)

  proc.stdout?.on('data', (chunk: Buffer) => {
    session.stdoutBuffer = Buffer.concat([session.stdoutBuffer, chunk])
    processBuffer(session)
  })

  proc.stderr?.on('data', (chunk: Buffer) => {
    const lines = chunk
      .toString('utf-8')
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean)
    if (lines.length === 0) return
    session.stderrLog.push(...lines)
    if (session.stderrLog.length > STDERR_LOG_LIMIT) {
      session.stderrLog.splice(0, session.stderrLog.length - STDERR_LOG_LIMIT)
    }
  })

  proc.on('error', (err) => {
    // Kill + reject pending rather than throwing (throw in an event handler
    // becomes an uncaught exception).
    markBrokenServer(workspaceRoot, serverKey)
    killSession(session)
    sessions.delete(sessionKey(workspaceRoot, serverKey))
    void err
  })

  proc.on('exit', (code, signal) => {
    // Reject all pending requests so callers don't hang for 30s.
    if (!session.closing) {
      markBrokenServer(workspaceRoot, serverKey)
      if (code !== 0 || !session.initialized) {
        const stderrTail = session.stderrLog.slice(-STDERR_LOG_TAIL).join('\n')
        const suffix = stderrTail ? `\n${stderrTail}` : ''
        console.error(
          `[lsp] ${session.serverDisplayName} language server exited unexpectedly ` +
          `(code=${code ?? 'null'}, signal=${signal ?? 'null'})${suffix}`
        )
      }
    }
    disposeSession(session, false)
    sessions.delete(sessionKey(workspaceRoot, serverKey))
  })

  try {
    await initialize(session)
    clearBrokenServer(workspaceRoot, serverKey)
    return session
  } catch (err) {
    markBrokenServer(workspaceRoot, serverKey)
    killSession(session)
    sessions.delete(sessionKey(workspaceRoot, serverKey))
    throw err
  }
}

/**
 * Kill all active LSP sessions. Should be called on app quit / process exit
 * to prevent orphaned language-server processes.
 */
export async function shutdownAllLspSessions(): Promise<void> {
  sessions.clear()
  for (const session of [...activeSessions]) killSession(session)
  const results = await Promise.allSettled(closingSessions.values())
  const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failed.length) throw new AggregateError(failed.map((result) => result.reason), 'LSP processes failed to exit')
}

export function releaseLspSession(workspaceRoot: string, serverKey: string): void {
  const key = sessionKey(workspaceRoot, serverKey)
  const sessionPromise = sessions.get(key)
  if (!sessionPromise) return
  sessionPromise
    .then((session) => {
      session.refCount -= 1
      if (session.refCount <= 0) {
        session.cleanupTimer = setTimeout(() => {
          const sp = sessions.get(key)
          if (!sp) return
          sp.then((s) => {
            if (s.refCount <= 0) {
              killSession(s)
              sessions.delete(key)
            }
          }).catch(() => { /* ignore */ })
        }, CLEANUP_DELAY)
      }
    })
    .catch(() => { /* session failed to init — nothing to release */ })
  }

// --- LSP operations ---

function filePathToUri(filePath: string): string {
  return pathToFileURL(filePath).href
}

export async function lspOpenDocument(
  session: LspSession,
  filePath: string,
  content: string,
  languageId: string
): Promise<void> {
  sendNotification(session, 'textDocument/didOpen', {
    textDocument: {
      uri: filePathToUri(filePath),
      languageId,
      version: 1,
      text: content
    }
  })
}

export async function lspCloseDocument(session: LspSession, filePath: string): Promise<void> {
  sendNotification(session, 'textDocument/didClose', {
    textDocument: { uri: filePathToUri(filePath) }
  })
}

export async function lspDefinition(
  session: LspSession,
  filePath: string,
  line: number,
  character: number
): Promise<unknown> {
  return sendRequest(session, 'textDocument/definition', {
    textDocument: { uri: filePathToUri(filePath) },
    position: { line, character }
  })
}

export async function lspReferences(
  session: LspSession,
  filePath: string,
  line: number,
  character: number
): Promise<unknown> {
  return sendRequest(session, 'textDocument/references', {
    textDocument: { uri: filePathToUri(filePath) },
    position: { line, character },
    context: { includeDeclaration: true }
  })
}

export async function lspHover(
  session: LspSession,
  filePath: string,
  line: number,
  character: number
): Promise<unknown> {
  return sendRequest(session, 'textDocument/hover', {
    textDocument: { uri: filePathToUri(filePath) },
    position: { line, character }
  })
}

export async function lspImplementation(
  session: LspSession,
  filePath: string,
  line: number,
  character: number
): Promise<unknown> {
  return sendRequest(session, 'textDocument/implementation', {
    textDocument: { uri: filePathToUri(filePath) },
    position: { line, character }
  })
}

export async function lspDocumentSymbol(session: LspSession, filePath: string): Promise<unknown> {
  return sendRequest(session, 'textDocument/documentSymbol', {
    textDocument: { uri: filePathToUri(filePath) }
  })
}

export async function lspWorkspaceSymbol(session: LspSession, query: string): Promise<unknown> {
  return sendRequest(session, 'workspace/symbol', { query })
}

type DiagnosticsFetchResult = {
  diagnostics: unknown[]
  source: 'publishDiagnostics-cache' | 'textDocument/diagnostic' | 'none'
}

export async function lspGetDiagnostics(
  session: LspSession,
  filePath: string
): Promise<DiagnosticsFetchResult> {
  const cached = session.diagnostics.get(filePathToUri(filePath)) ?? []
  if (cached.length > 0) {
    return {
      diagnostics: cached,
      source: 'publishDiagnostics-cache'
    }
  }

  try {
    const result = await sendRequest(session, 'textDocument/diagnostic', {
      textDocument: { uri: filePathToUri(filePath) },
      ...(session.diagnosticIdentifier ? { identifier: session.diagnosticIdentifier } : {})
    })
    const pulled = normalizeDiagnosticReport(result) ?? []
    if (pulled.length > 0) {
      return {
        diagnostics: pulled,
        source: 'textDocument/diagnostic'
      }
    }
  } catch {
    // Fall back to whatever push diagnostics have accumulated.
  }

  try {
    const result = await sendRequest(session, 'workspace/diagnostic', {
      previousResultIds: [],
      ...(session.diagnosticIdentifier ? { identifier: session.diagnosticIdentifier } : {})
    })
    const workspaceDiagnostics = collectWorkspaceDiagnostics(result, filePathToUri(filePath))
    if (workspaceDiagnostics.length > 0) {
      return {
        diagnostics: workspaceDiagnostics,
        source: 'textDocument/diagnostic'
      }
    }
  } catch {
    // Workspace diagnostics are optional and not supported by all servers.
  }

  // Push diagnostics may have arrived while the pull requests were in flight,
  // so re-read the cache here rather than relying on the function-entry snapshot.
  const finalCached = session.diagnostics.get(filePathToUri(filePath)) ?? []
  return {
    diagnostics: finalCached,
    source: finalCached.length > 0 ? 'publishDiagnostics-cache' : 'none'
  }
}

export type { LspSession }
