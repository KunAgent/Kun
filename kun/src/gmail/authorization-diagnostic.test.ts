import { describe, expect, it, vi } from 'vitest'
import { GmailLoopbackAuthorization } from './authorization.js'
import { GmailAuthorizationDiagnosticError } from './authorization-diagnostic.js'
import type { GmailAuthorizationFailure } from '../contracts/gmail-authorization-errors.js'

describe('safe retained native Gmail authorization status', () => {
  it('retains and persists only an allowlisted exchange failure after cleaning the browser URL', async () => {
    const records: GmailAuthorizationFailure[] = []
    let persisted!: () => void
    const writing = new Promise<void>((resolve) => { persisted = resolve })
    const onFailure = vi.fn(async (failure: GmailAuthorizationFailure) => { records.push(failure); await writing })
    const authorization = new GmailLoopbackAuthorization('thread:diagnostic', 'fake-client', Date.now,
      async () => { throw new GmailAuthorizationDiagnosticError('authorization_failed', 'Safe message', 'token_invalid_client') }, onFailure)
    try {
      const start = await authorization.start()
      const google = new URL(start.url)
      const callback = new URL(google.searchParams.get('redirect_uri')!)
      callback.searchParams.set('state', google.searchParams.get('state')!)
      callback.searchParams.set('code', 'PRIVATE_AUTH_CODE')
      const received = await fetch(callback, { redirect: 'manual' })
      expect(received.status).toBe(303)
      expect(received.headers.get('location')).not.toContain('PRIVATE_AUTH_CODE')
      await vi.waitFor(() => expect(authorization.status()).toMatchObject({ status: 'failed', errorCode: 'token_invalid_client' }))
      expect(onFailure).toHaveBeenCalledOnce()
      expect(records[0]).toMatchObject({ authorizationId: authorization.id, scopeId: 'thread:diagnostic', errorCode: 'token_invalid_client' })
      expect(Object.keys(records[0]!).sort()).toEqual(['authorizationId', 'errorCode', 'failedAt', 'scopeId'])
      expect(JSON.stringify(authorization.status()) + JSON.stringify(records)).not.toContain('PRIVATE_AUTH_CODE')
      let disposed = false
      const disposing = authorization.dispose().then(() => { disposed = true })
      await Promise.resolve()
      expect(disposed).toBe(false)
      persisted()
      await disposing
      expect(disposed).toBe(true)
    } finally { persisted?.(); await authorization.dispose() }
  })

  it('does not retain unknown callback errors or error descriptions', async () => {
    for (const [googleCode, expected] of [['admin_policy_enforced', 'google_admin_policy_enforced'],
      ['PRIVATE_UNKNOWN_CALLBACK_ERROR', 'authorization_failed']] as const) {
      const authorization = new GmailLoopbackAuthorization('thread:diagnostic', 'fake-client', Date.now, vi.fn())
      try {
        const start = await authorization.start()
        const google = new URL(start.url)
        const callback = new URL(google.searchParams.get('redirect_uri')!)
        callback.searchParams.set('state', google.searchParams.get('state')!)
        callback.searchParams.set('error', googleCode)
        callback.searchParams.set('error_description', 'PRIVATE_DESCRIPTION')
        expect((await fetch(callback, { redirect: 'manual' })).status).toBe(303)
        expect(authorization.status()).toMatchObject({ status: 'failed', errorCode: expected })
        expect(JSON.stringify(authorization.status())).not.toContain('PRIVATE_')
      } finally { await authorization.dispose() }
    }
  })

  it('rejects spoofed diagnostic values from exceptions and ignores failure-persistence errors', async () => {
    const authorization = new GmailLoopbackAuthorization('thread:diagnostic', 'fake-client', Date.now,
      async () => { throw { authorizationErrorCode: 'PRIVATE_TOKEN', message: 'PRIVATE_MESSAGE' } },
      async () => { throw new Error('PRIVATE_STORAGE_ERROR') })
    try {
      const start = await authorization.start()
      const google = new URL(start.url)
      const callback = new URL(google.searchParams.get('redirect_uri')!)
      callback.searchParams.set('state', google.searchParams.get('state')!)
      callback.searchParams.set('code', 'PRIVATE_CODE')
      await fetch(callback, { redirect: 'manual' })
      await vi.waitFor(() => expect(authorization.status()).toMatchObject({ status: 'failed', errorCode: 'authorization_failed' }))
      expect(JSON.stringify(authorization.status())).not.toContain('PRIVATE_')
    } finally { await authorization.dispose() }
  })
})
