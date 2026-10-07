import type { HarnessCredentialMode, HarnessDefinition, HarnessStatus } from '../contracts/harness.js'
import type { HarnessDiagnosticRow } from '../contracts/harness-diagnostics.js'
import type { HarnessReadiness, HarnessTestHandshake } from '../contracts/harness-test.js'

export type CredentialVerdict = {
  ok: boolean
  authentication: HarnessReadiness['authentication']
  detail: string
}

/**
 * Credentials are diagnostics, not a gate (docs/ade/17 §4.2). A native
 * login is blocked only by a definitive signal: the session answered
 * auth_required, the engine's own status command reports it is signed out,
 * or the engine cannot report sign-in over its protocol and Kun found no
 * local credential. Missing local evidence otherwise only warns; the Agent
 * asks for login when it needs one. Nothing here is verified authentication.
 */
export function credentialVerdict(input: {
  credentialMode: HarnessCredentialMode
  terminalLaunch: boolean
  nativeLoop: boolean
  requiresLogin: boolean
  hasKey: boolean
  nativeEvidence: boolean
  login: HarnessStatus['login']
  requireEvidence: boolean
}): CredentialVerdict {
  if (input.terminalLaunch) {
    return { ok: true, authentication: 'unverified', detail: 'Terminal launch checked; sign-in is handled by the CLI when opened' }
  }
  if (input.credentialMode !== 'native-login') {
    if (input.nativeLoop) return { ok: true, authentication: 'unverified', detail: 'Kun uses the selected provider profile' }
    return input.hasKey
      ? { ok: true, authentication: 'unverified', detail: 'Credential configured; authentication and quota not tested' }
      : { ok: false, authentication: 'missing', detail: 'No configured API credential' }
  }
  if (input.requiresLogin) {
    return { ok: false, authentication: 'missing', detail: 'The Agent requires login. Sign in with its native CLI and retry.' }
  }
  if (input.nativeEvidence) return { ok: true, authentication: 'verified', detail: 'Local account status verified; quota not tested' }
  if (input.hasKey) return { ok: true, authentication: 'unverified', detail: 'Credential configured; authentication and quota not tested' }
  if (input.login === 'signed-out') {
    return { ok: false, authentication: 'missing', detail: 'The Agent reports that it is signed out. Sign in with its native CLI and retry.' }
  }
  if (input.requireEvidence) {
    return { ok: false, authentication: 'missing',
      detail: 'No local credential found. This Agent cannot report sign-in over its protocol; sign in with its native CLI and retry.' }
  }
  return { ok: true, authentication: 'unverified', detail: 'No local credential found; the Agent asks you to sign in if it needs one' }
}

const NETWORK_LABEL: Record<NonNullable<HarnessStatus['networkSource']>, string> = {
  environment: 'Proxy from environment variables',
  system: 'System proxy',
  direct: 'Direct connection',
  'explicit-required': 'Proxy rules need explicit HTTP proxy variables'
}

const clamp = (value: string): string => value.length > 512 ? `${value.slice(0, 509)}...` : value

/** Readable rows for the Agent Center; one per stage that ran. */
export function readinessDiagnostics(input: {
  definition: Pick<HarnessDefinition, 'transport'>
  status: HarnessStatus
  installation: boolean
  configuration?: { ok: boolean; detail?: string }
  credentials: CredentialVerdict
  handshake?: Pick<HarnessTestHandshake, 'ok' | 'supported' | 'protocol' | 'agent' | 'detail' | 'models'>
  protocolOk: boolean
  modelCount?: number
}): HarnessDiagnosticRow[] {
  const rows: HarnessDiagnosticRow[] = []
  const { status } = input
  if (input.definition.transport !== 'native-loop') {
    rows.push(status.resolvedCommand
      ? { id: 'command', status: input.installation ? 'ok' : 'error', value: clamp(status.resolvedCommand) }
      : status.installed === 'yes'
        ? { id: 'command', status: 'ok', value: 'Bundled with Kun' }
        : { id: 'command', status: status.installed === 'no' ? 'error' : 'warn', value: clamp(status.message ?? 'Command not found') })
  }
  if (status.version) {
    rows.push({ id: 'version', status: status.versionSupported === false ? 'error' : 'ok',
      value: clamp(status.versionSupported === false ? `${status.version} (unsupported)` : status.version) })
  }
  if (input.configuration && !input.configuration.ok) {
    rows.push({ id: 'configuration', status: 'error', value: clamp(input.configuration.detail ?? 'The selected profile is not configured') })
  }
  if (status.networkSource) {
    rows.push({ id: 'network', status: status.networkSource === 'explicit-required' ? 'error' : 'info', value: NETWORK_LABEL[status.networkSource] })
  }
  rows.push({ id: 'credentials', value: clamp(input.credentials.detail),
    status: !input.credentials.ok ? 'error' : input.credentials.detail.startsWith('No local credential') ? 'warn' : 'ok' })
  if (input.handshake) {
    const agent = [input.handshake.agent?.name, input.handshake.agent?.version].filter(Boolean).join(' ')
    const summary = [agent || input.handshake.protocol, input.handshake.detail].filter(Boolean).join(' — ')
    rows.push({ id: 'protocol', status: input.protocolOk ? 'ok' : 'error', value: clamp(summary || (input.protocolOk ? 'Checked' : 'Failed')) })
  }
  const models = input.modelCount ?? input.handshake?.models?.length
  if (models !== undefined && models > 0) rows.push({ id: 'models', status: 'info', value: `${models} models` })
  return rows
}
