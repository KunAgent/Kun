import { describe, expect, it, vi } from 'vitest'
import { GoogleWorkspaceService, hasGoogleWorkspaceScopes } from './service.js'
import { GoogleWorkspaceError, type GoogleWorkspaceRunner } from './process.js'
import { GOOGLE_WORKSPACE_SCOPES } from './types.js'
import { GOOGLE_WORKSPACE_METHODS, googleWorkspaceCallArguments, validateGoogleWorkspaceCall } from './catalog.js'
import { mintGoogleWorkspaceApproval } from './approval.js'
import { registerHostActionApprovalGrant } from '../adapters/tool/action-approval-grants.js'
import { ToolOperationJournal } from '../reliability/operation-journal.js'
import type { ToolHostContext } from '../ports/tool-host.js'
const result = (value: unknown) => ({ stdout: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)), stderr: Buffer.alloc(0), exitCode: 0 })
const authenticated = { client_config_exists: true, encrypted_credentials_exists: true, token_valid: true, scopes: GOOGLE_WORKSPACE_SCOPES,
  encrypted_credentials: '/secret/credentials.enc', config_client_id: 'private', user: 'private@example.com' }
const normalRun = async (args: readonly string[]) => args[0] === '--version'
  ? result('gws 0.22.5\nThis is not an officially supported Google product.\n')
  : args[0] === 'auth' && args[1] === 'status' ? result(authenticated) : result({ ok: true })
function writeGrant(method: string, params: Record<string, unknown>, body?: Record<string, unknown>) {
  const call = validateGoogleWorkspaceCall({ method, params, body })
  const proof = Object.freeze({ id: 'approval', source: 'user' as const, toolName: 'google_workspace_call', callId: 'call',
    argumentsHash: ToolOperationJournal.argsHash(googleWorkspaceCallArguments(call)), issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() })
  registerHostActionApprovalGrant(proof)
  return mintGoogleWorkspaceApproval(call, { activeToolCallId: 'call', kunActionApprovalGrant: proof } as ToolHostContext)
}
describe('Google Workspace service lifecycle', () => {
  it('accepts pinned multiline version output and sanitizes status without leaking raw fields', async () => {
    const run = vi.fn(normalRun)
    const service = new GoogleWorkspaceService({ run })
    const status = await service.status()
    expect(status.binary).toEqual({ available: true, version: '0.22.5' })
    expect(status.auth.state).toBe('connected')
    expect(JSON.stringify(status)).not.toMatch(/private|\/secret/)
    expect(status).not.toHaveProperty('authorizationUrl')
    await service.status()
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('uses the configured broader scopes for every curated method, never scope-name prefixes', () => {
    for (const method of GOOGLE_WORKSPACE_METHODS) expect(hasGoogleWorkspaceScopes(GOOGLE_WORKSPACE_SCOPES, method.scopes), method.method).toBe(true)
    expect(hasGoogleWorkspaceScopes(['https://www.googleapis.com/auth/drive.readonly'], ['https://www.googleapis.com/auth/drive'])).toBe(false)
    expect(hasGoogleWorkspaceScopes([], ['https://www.googleapis.com/auth/gmail.readonly'])).toBe(false)
  })
  it('tests all services through valid read-only canaries using primary events scope', async () => {
    const run = vi.fn(normalRun)
    const service = new GoogleWorkspaceService({ run })
    service.test()
    await vi.waitFor(() => expect(service.snapshot().operation?.state).toBe('succeeded'))
    expect(Object.values(service.snapshot().services).map(x => x.state)).toEqual(['ready', 'ready', 'ready'])
    const calls = run.mock.calls.map(x => x[0])
    expect(calls.some(args => args.slice(0, 3).join('.') === 'calendar.events.list')).toBe(true)
    expect(calls.some(args => args.includes('calendarList'))).toBe(false)
    expect(calls.filter(args => args[0] !== 'auth' && args[0] !== '--version')).toHaveLength(3)
  })
  it('setup returns guidance and never launches gcloud or auth setup', async () => {
    const run = vi.fn(normalRun)
    const service = new GoogleWorkspaceService({ run })
    const status = await service.setup()
    expect(status.operation?.kind).toBe('setup')
    expect(status.setup.instructions.join(' ')).toContain('gcloud')
    expect(run.mock.calls.some(x => x[0].includes('setup'))).toBe(false)
  })
  it('cancels login, clears the transient URL and rejects overlapping operations', async () => {
    const run: GoogleWorkspaceRunner = async (args, options) => {
      if (args[1] !== 'login') return normalRun(args)
      const url = new URL('https://accounts.google.com/o/oauth2/auth')
      url.searchParams.set('client_id', '123.apps.googleusercontent.com')
      url.searchParams.set('redirect_uri', 'http://localhost:12345')
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', GOOGLE_WORKSPACE_SCOPES.join(' '))
      options?.onOutput?.(`Open browser:\n${url.href}\n`)
      return await new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new GoogleWorkspaceError('cancelled'))))
    }
    const service = new GoogleWorkspaceService({ run })
    expect(service.login().operation?.state).toBe('running')
    expect(service.authorizationUrl().authorizationUrl).toContain('accounts.google.com')
    expect(() => service.login()).toThrow()
    await service.cancel()
    expect(service.authorizationUrl()).toEqual({})
    expect(service.snapshot().operation?.state).toBe('cancelled')
  })
  it('rejects forged or replayed approval before invoking a write', async () => {
    const run = vi.fn(normalRun)
    const service = new GoogleWorkspaceService({ run })
    const params = { calendarId: 'primary', eventId: 'event', sendUpdates: 'none' }
    await expect(service.call('calendar.events.delete', params, undefined, undefined, { id: 'forged' })).rejects.toThrow(/approval/)
    expect(run).not.toHaveBeenCalled()
    const grant = writeGrant('calendar.events.delete', params)
    await service.call('calendar.events.delete', params, undefined, undefined, grant)
    await expect(service.call('calendar.events.delete', params, undefined, undefined, grant)).rejects.toThrow(/approval/)
  })
  it('accepts empty successful delete responses and marks real write failures unknown', async () => {
    for (const method of ['calendar.events.delete', 'gmail.users.drafts.delete']) {
      const params = method.startsWith('calendar') ? { calendarId: 'primary', eventId: 'event', sendUpdates: 'none' } : { userId: 'me', id: 'draft' }
      const service = new GoogleWorkspaceService({ run: async args => args.includes('delete') ? result('') : normalRun(args) })
      await expect(service.call(method, params, undefined, undefined, writeGrant(method, params))).resolves.toEqual({ status: 'success' })
    }
    for (const failure of [new GoogleWorkspaceError('timeout'), new GoogleWorkspaceError('cancelled'), 'not JSON']) {
      const params = { userId: 'me' }
      const body = { to: ['recipient@example.com'], subject: 'Subject', text: 'Exact content' }
      const service = new GoogleWorkspaceService({ run: async args => {
        if (!args.includes('send')) return normalRun(args)
        if (typeof failure === 'string') return result(failure)
        throw failure
      } })
      await expect(service.call('gmail.users.messages.send', params, body, undefined, writeGrant('gmail.users.messages.send', params, body))).rejects.toMatchObject({ unknownOutcome: true })
    }
  })
})

describe('Google Workspace interrupted admission', () => {
  it('does not let setup overwrite a login started during a cached status await', async () => {
    const service = new GoogleWorkspaceService({ run: normalRun })
    await service.status()
    const setup = service.setup()
    service.login()
    await expect(setup).rejects.toMatchObject({ code: 'validation' })
    expect(service.snapshot().operation?.kind).toBe('login')
    await service.cancel()
  })
  it('waits for in-flight process cancellation before removing gws credentials', async () => {
    const events: string[] = []
    const run: GoogleWorkspaceRunner = async (args, options) => {
      if (args[0] === 'drive') return await new Promise((_resolve, reject) => {
        events.push('read-running')
        options?.signal?.addEventListener('abort', () => { setTimeout(() => {
          events.push('read-stopped'); reject(new GoogleWorkspaceError('cancelled'))
        }, 15) })
      })
      if (args[1] === 'logout') events.push('logout')
      return normalRun(args)
    }
    const service = new GoogleWorkspaceService({ run })
    await service.status()
    const call = service.call('drive.files.list', {})
    const failed = expect(call).rejects.toMatchObject({ code: 'cancelled' })
    await vi.waitFor(() => expect(events).toContain('read-running'))
    service.logout()
    await vi.waitFor(() => expect(service.snapshot().operation?.state).toBe('succeeded'))
    await failed
    expect(events).toEqual(['read-running', 'read-stopped', 'logout'])
  })
})

describe('Google OAuth output framing', () => {
  it('never publishes an unterminated URL fragment before state/PKCE suffixes arrive', async () => {
    let output: ((chunk: string) => void) | undefined
    const run: GoogleWorkspaceRunner = async (_args, options) => {
      output = options?.onOutput
      return await new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new GoogleWorkspaceError('cancelled'))))
    }
    const service = new GoogleWorkspaceService({ run })
    service.login()
    const url = new URL('https://accounts.google.com/o/oauth2/auth')
    url.searchParams.set('client_id', '123.apps.googleusercontent.com')
    url.searchParams.set('redirect_uri', 'http://localhost:12345')
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', GOOGLE_WORKSPACE_SCOPES.join(' '))
    output?.(`Open browser:\n${url.href}`)
    expect(service.authorizationUrl()).toEqual({})
    output?.('&state=complete-state&code_challenge=challenge\n')
    expect(service.authorizationUrl().authorizationUrl).toContain('state=complete-state')
    expect(service.authorizationUrl().authorizationUrl).toContain('code_challenge=challenge')
    await service.cancel()
  })
})

describe('failed cancellation fencing', () => {
  it('fails closed until restart if process termination could not be confirmed', async () => {
    const run = vi.fn<GoogleWorkspaceRunner>(async (_args, options) => await new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new GoogleWorkspaceError('stop_failed')))
    }))
    const service = new GoogleWorkspaceService({ run })
    service.login()
    const status = await service.cancel()
    expect(status.operation?.state).toBe('failed')
    expect(status.binary.error).toContain('could not confirm')
    expect(status.auth.state).toBe('error')
    expect(() => service.login()).toThrow(/Restart Kun/)
    await expect(service.call('drive.files.list', {})).rejects.toMatchObject({ code: 'stop_failed' })
    await service.status(true)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('status process termination fencing', () => {
  it('returns a restart-required state and never retries an unconfirmed status process', async () => {
    const run = vi.fn<GoogleWorkspaceRunner>(async () => { throw new GoogleWorkspaceError('stop_failed') })
    const service = new GoogleWorkspaceService({ run })
    expect((await service.status()).binary.error).toContain('Restart Kun')
    await service.status(true)
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('fences the integration if a read canary cannot be stopped', async () => {
    const service = new GoogleWorkspaceService({ run: async args => {
      if (args[0] === 'gmail') throw new GoogleWorkspaceError('stop_failed')
      return normalRun(args)
    } })
    service.test()
    await vi.waitFor(() => expect(service.snapshot().operation?.state).toBe('failed'))
    expect(service.snapshot().binary.error).toContain('Restart Kun')
    expect(() => service.test()).toThrow(/Restart Kun/)
  })
})
