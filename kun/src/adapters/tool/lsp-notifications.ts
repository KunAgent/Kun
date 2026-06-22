type LspNotificationSession = {
  diagnostics: Map<string, unknown[]>
  serverDisplayName: string
}

type LspMessageParams = {
  type?: unknown
  message?: unknown
}

type LspDiagnosticsParams = {
  uri?: unknown
  diagnostics?: unknown
}

function logMessage(session: LspNotificationSession, params: unknown): void {
  const messageParams = (params ?? {}) as LspMessageParams
  const message = typeof messageParams.message === 'string' ? messageParams.message : ''
  if (!message) return

  const prefix = `[lsp] ${session.serverDisplayName}: ${message}`
  switch (messageParams.type) {
    case 1:
      console.error(prefix)
      break
    case 2:
      console.warn(prefix)
      break
    default:
      console.info(prefix)
      break
  }
}

function storeDiagnostics(session: LspNotificationSession, params: unknown): void {
  const diagnosticsParams = (params ?? {}) as LspDiagnosticsParams
  if (typeof diagnosticsParams.uri !== 'string') return
  if (!Array.isArray(diagnosticsParams.diagnostics)) return
  session.diagnostics.set(diagnosticsParams.uri, diagnosticsParams.diagnostics)
}

export function handleNotification(
  session: LspNotificationSession,
  method: string,
  params: unknown
): void {
  switch (method) {
    case 'textDocument/publishDiagnostics':
      storeDiagnostics(session, params)
      break
    case 'window/logMessage':
    case '$/logTrace':
      logMessage(session, params)
      break
    default:
      break
  }
}
