import { randomUUID } from 'node:crypto'
import { resolveGoogleWorkspaceBinary } from './binary.js'
import { createGoogleWorkspaceRunner, GoogleWorkspaceError, type GoogleWorkspaceRunner } from './process.js'
import { sanitizeGoogleWorkspaceAuth, validateGoogleAuthorizationUrl } from './auth.js'
import { GOOGLE_WORKSPACE_SCOPES, GOOGLE_WORKSPACE_SETUP, GOOGLE_WORKSPACE_VERSION, type GoogleWorkspaceStatus } from './types.js'
import { validateGoogleWorkspaceCall } from './catalog.js'
import { consumeGoogleWorkspaceApproval, type GoogleWorkspaceApprovalGrant } from './approval.js'

const unknownServices = (): GoogleWorkspaceStatus['services'] => ({
  gmail: { state: 'unknown' }, calendar: { state: 'unknown' }, drive: { state: 'unknown' }
})
/** gws alone owns credentials. This service never opens credentials, caches, keys or exports. */
export class GoogleWorkspaceService {
  private readonly run: GoogleWorkspaceRunner
  private state: GoogleWorkspaceStatus = {
    experimental: true, binary: { available: false }, auth: { state: 'disconnected', scopes: [] },
    services: unknownServices(), setup: { required: true, ...GOOGLE_WORKSPACE_SETUP }
  }
  private controller?: AbortController
  private pending?: Promise<void>
  private refresh?: Promise<void>
  private refreshedAt = 0
  private stopFailed = false
  private authorization?: { authorizationUrl: string; operationId: string }
  private readonly activeCalls = new Set<AbortController>()
  private readonly activeCallSettlements = new Set<Promise<void>>()
  constructor(private readonly options: {
    run?: GoogleWorkspaceRunner
    resolveBinary?: typeof resolveGoogleWorkspaceBinary
  } = {}) { this.run = options.run ?? createGoogleWorkspaceRunner({ resolveBinary: options.resolveBinary }) }

  snapshot(): GoogleWorkspaceStatus { return structuredClone(this.state) }
  async status(forceRefresh = false): Promise<GoogleWorkspaceStatus> {
    if (!this.stopFailed && !this.controller && (forceRefresh || Date.now() - this.refreshedAt > 30_000)) {
      this.refresh ??= this.refreshStatus().finally(() => { this.refresh = undefined })
      await this.refresh
    }
    return this.snapshot()
  }
  private async refreshStatus(signal?: AbortSignal): Promise<void> {
    try {
      if (!this.options.run) await (this.options.resolveBinary ?? resolveGoogleWorkspaceBinary)()
      const version = await this.run(['--version'], { signal, timeoutMs: 5000, maxOutputBytes: 4096 })
      if (version.stdout.toString('utf8').split(/\r?\n/, 1)[0]?.trim() !== `gws ${GOOGLE_WORKSPACE_VERSION}`) throw new GoogleWorkspaceError('version_mismatch')
      this.state.binary = { available: true, version: GOOGLE_WORKSPACE_VERSION }
      const result = await this.run(['auth', 'status'], { signal, timeoutMs: 30_000, maxOutputBytes: 64 * 1024 })
      this.state.auth = sanitizeGoogleWorkspaceAuth(parseJson(result.stdout))
      this.state.setup.required = this.state.auth.state === 'setup_required'
      if (this.state.auth.state !== 'connected') this.state.services = unknownServices()
    } catch (error) {
      const safe = safeError(error)
      if (safe.code === 'stop_failed') {
        this.failStop(safe)
        if (signal) throw safe
        return
      }
      if (signal?.aborted) return
      if (safe.code === 'missing_binary' || safe.code === 'version_mismatch') {
        this.state.binary = { available: false, error: safe.message }
      }
      this.state.auth = { state: 'error', scopes: [] }
      this.state.services = unknownServices()
    } finally { this.refreshedAt = Date.now() }
  }
  authorizationUrl(): { authorizationUrl?: string; operationId?: string } {
    return this.state.operation?.kind === 'login' && this.state.operation.state === 'running' &&
      !this.controller?.signal.aborted ? { ...this.authorization } : {}
  }
  async setup(): Promise<GoogleWorkspaceStatus> {
    if (this.stopFailed) throw new GoogleWorkspaceError('stop_failed')
    if (this.controller) throw new GoogleWorkspaceError('validation')
    await this.status()
    if (this.stopFailed) throw new GoogleWorkspaceError('stop_failed')
    if (this.controller) throw new GoogleWorkspaceError('validation')
    this.state.operation = { id: randomUUID(), kind: 'setup', state: 'succeeded',
      message: 'Complete the OAuth setup yourself using these instructions, then choose Connect. The upstream interactive gcloud wizard is not run by Kun.' }
    return this.snapshot()
  }
  login(): GoogleWorkspaceStatus {
    return this.start('login', async signal => {
      let tail = ''
      const operationId = this.state.operation!.id
      await this.run(['auth', 'login', '--scopes', GOOGLE_WORKSPACE_SCOPES.join(',')], {
        signal, timeoutMs: 5 * 60_000, maxOutputBytes: 64 * 1024,
        onOutput: chunk => {
          tail = (tail + chunk).slice(-20_000)
          for (const raw of tail.match(/https:\/\/accounts\.google\.com\/[^\s]+(?=\s)/g) ?? []) {
            const authorizationUrl = validateGoogleAuthorizationUrl(raw)
            if (authorizationUrl && !signal.aborted && this.state.operation?.id === operationId) {
              this.authorization = { authorizationUrl, operationId }
            }
          }
        }
      })
      if (!signal.aborted) await this.refreshStatus(signal)
      if (!signal.aborted && this.state.auth.state !== 'connected') throw new GoogleWorkspaceError('authentication')
    })
  }
  logout(): GoogleWorkspaceStatus {
    return this.start('logout', async signal => {
      for (const active of this.activeCalls) active.abort()
      await Promise.allSettled([...this.activeCallSettlements])
      await this.run(['auth', 'logout'], { signal, maxOutputBytes: 16 * 1024 })
      if (!signal.aborted) {
        this.state.auth = { state: 'disconnected', scopes: [] }
        this.state.services = unknownServices()
        this.refreshedAt = Date.now()
      }
    })
  }
  test(): GoogleWorkspaceStatus {
    return this.start('test', async signal => {
      await this.refreshStatus(signal)
      if (signal.aborted) return
      if (this.state.auth.state !== 'connected') throw new GoogleWorkspaceError('authentication')
      const tests = [
        ['gmail', 'gmail.users.labels.list', { userId: 'me' }],
        ['calendar', 'calendar.events.list', { calendarId: 'primary', maxResults: 1, timeMin: new Date().toISOString(), timeMax: new Date(Date.now() + 86_400_000).toISOString() }],
        ['drive', 'drive.files.list', { pageSize: 1 }]
      ] as const
      for (const [service, method, params] of tests) {
        if (signal.aborted) return
        try {
          const call = validateGoogleWorkspaceCall({ method, params })
          await this.run(call.argv, { signal, maxOutputBytes: 64 * 1024 })
          if (!signal.aborted) this.state.services[service] = { state: 'ready' }
        } catch (error) {
          if (error instanceof GoogleWorkspaceError && error.code === 'stop_failed') {
            this.failStop(error)
            throw error
          }
          if (!signal.aborted) this.state.services[service] = { state: 'error', message: safeError(error).message }
        }
      }
      if (Object.values(this.state.services).some(service => service.state === 'error')) throw new GoogleWorkspaceError('api')
    })
  }
  private start(kind: 'login' | 'logout' | 'test', execute: (signal: AbortSignal) => Promise<void>): GoogleWorkspaceStatus {
    if (this.stopFailed) throw new GoogleWorkspaceError('stop_failed')
    if (this.controller || this.refresh || (kind === 'login' && this.activeCalls.size > 0)) throw new GoogleWorkspaceError('validation')
    const controller = new AbortController()
    this.controller = controller
    this.authorization = undefined
    const operation = { id: randomUUID(), kind, state: 'running' as const }
    this.state.operation = operation
    this.pending = execute(controller.signal).then(() => {
      if (!controller.signal.aborted) this.state.operation = { ...operation, state: 'succeeded' }
    }, error => {
      if (error instanceof GoogleWorkspaceError && error.code === 'stop_failed') {
        this.failStop(error)
        this.state.operation = { ...operation, state: 'failed', message: error.message }
      } else if (!controller.signal.aborted) this.state.operation = { ...operation, state: 'failed', message: safeError(error).message }
    }).finally(() => {
      this.authorization = undefined
      if (this.controller === controller) this.controller = undefined
      this.pending = undefined
    })
    return this.snapshot()
  }
  async cancel(): Promise<GoogleWorkspaceStatus> {
    this.authorization = undefined
    const operation = this.state.operation
    this.controller?.abort()
    if (operation?.state === 'running') this.state.operation = { ...operation, state: 'cancelled' }
    await this.pending
    return this.snapshot()
  }
  private failStop(error: GoogleWorkspaceError): void {
    if (this.stopFailed) return
    this.stopFailed = true
    this.authorization = undefined
    this.controller?.abort()
    for (const active of this.activeCalls) active.abort()
    const operation = this.state.operation
    if (operation?.state === 'running') this.state.operation = { ...operation, state: 'failed', message: error.message }
    this.state.binary = { available: false, error: error.message }
    this.state.auth = { state: 'error', scopes: [] }
    this.state.services = unknownServices()
  }
  async shutdown(): Promise<void> {
    for (const active of this.activeCalls) active.abort()
    await this.cancel()
    await Promise.allSettled([...this.activeCallSettlements])
  }
  async call(method: string, params: Record<string, unknown>, body?: Record<string, unknown>, signal?: AbortSignal,
    grant?: GoogleWorkspaceApprovalGrant): Promise<unknown> {
    if (this.stopFailed) throw new GoogleWorkspaceError('stop_failed')
    const validated = validateGoogleWorkspaceCall({ method, params, body })
    consumeGoogleWorkspaceApproval(grant, validated)
    if (this.controller) throw new GoogleWorkspaceError('validation')
    const status = await this.status()
    if (this.stopFailed) throw new GoogleWorkspaceError('stop_failed')
    if (this.controller) throw new GoogleWorkspaceError('validation')
    if (status.auth.state !== 'connected' || !hasGoogleWorkspaceScopes(status.auth.scopes, validated.scopes)) {
      throw new GoogleWorkspaceError('authentication')
    }
    const controller = new AbortController()
    const abort = (): void => controller.abort()
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    this.activeCalls.add(controller)
    let settle!: () => void
    const settled = new Promise<void>(resolve => { settle = resolve })
    this.activeCallSettlements.add(settled)
    try {
      const result = await this.run(validated.argv, { signal: controller.signal, maxOutputBytes: 2 * 1024 * 1024, media: validated.responseFormat === 'media' })
      return validated.responseFormat === 'media'
        ? { encoding: 'base64', data: result.stdout.toString('base64'), byteLength: result.stdout.length }
        : result.stdout.length === 0 && ['calendar.events.delete', 'gmail.users.drafts.delete'].includes(validated.method)
          ? { status: 'success' } : parseJson(result.stdout)
    } catch (error) {
      if (error instanceof GoogleWorkspaceError && error.code === 'stop_failed') this.failStop(error)
      if (validated.requiresApproval) {
        const unknown = safeError(error)
        unknown.unknownOutcome = true
        unknown.message += ' The write outcome is unknown and it may have completed. Inspect Google Workspace before retrying.'
        throw unknown
      }
      throw error
    } finally {
      signal?.removeEventListener('abort', abort)
      this.activeCalls.delete(controller)
      this.activeCallSettlements.delete(settled)
      settle()
    }
  }
}
function parseJson(buffer: Buffer): unknown {
  try { return JSON.parse(buffer.toString('utf8')) }
  catch { throw new GoogleWorkspaceError('process') }
}
function safeError(error: unknown): GoogleWorkspaceError {
  return error instanceof GoogleWorkspaceError ? error : new GoogleWorkspaceError('process')
}

export function hasGoogleWorkspaceScopes(granted: readonly string[], required: readonly string[]): boolean {
  const covered = new Set(granted)
  if (covered.has('https://www.googleapis.com/auth/gmail.modify')) {
    for (const suffix of ['gmail.readonly', 'gmail.compose', 'gmail.send']) covered.add(`https://www.googleapis.com/auth/${suffix}`)
  }
  if (covered.has('https://www.googleapis.com/auth/calendar.events')) covered.add('https://www.googleapis.com/auth/calendar.events.readonly')
  return required.every(scope => covered.has(scope))
}
