import { describe, expect, it } from 'vitest'
import { credentialVerdict, readinessDiagnostics } from './harness-readiness-verdict.js'

const native = {
  credentialMode: 'native-login' as const, terminalLaunch: false, nativeLoop: false, requiresLogin: false,
  hasKey: false, nativeEvidence: false, login: 'unknown' as const, requireEvidence: false
}

describe('credentialVerdict', () => {
  it('only warns when a native login has no local evidence', () => {
    expect(credentialVerdict(native)).toEqual({ ok: true, authentication: 'unverified',
      detail: 'No local credential found; the Agent asks you to sign in if it needs one' })
  })

  it('blocks on definitive signals only', () => {
    expect(credentialVerdict({ ...native, requiresLogin: true })).toMatchObject({ ok: false, authentication: 'missing' })
    expect(credentialVerdict({ ...native, login: 'signed-out' })).toMatchObject({ ok: false, detail: expect.stringContaining('signed out') })
    expect(credentialVerdict({ ...native, requireEvidence: true })).toMatchObject({ ok: false,
      detail: expect.stringContaining('cannot report sign-in') })
  })

  it('lets local evidence outrank a signed-out status, but never an auth_required session', () => {
    expect(credentialVerdict({ ...native, login: 'signed-out', hasKey: true })).toMatchObject({ ok: true, authentication: 'unverified' })
    expect(credentialVerdict({ ...native, requireEvidence: true, hasKey: true }).ok).toBe(true)
    expect(credentialVerdict({ ...native, nativeEvidence: true })).toMatchObject({ ok: true, authentication: 'verified' })
    expect(credentialVerdict({ ...native, requiresLogin: true, hasKey: true, nativeEvidence: true }).ok).toBe(false)
  })

  it('keeps provider and gateway profiles gated on their configured key', () => {
    const gateway = { ...native, credentialMode: 'kun-gateway' as const }
    expect(credentialVerdict(gateway)).toEqual({ ok: false, authentication: 'missing', detail: 'No configured API credential' })
    expect(credentialVerdict({ ...gateway, hasKey: true }).ok).toBe(true)
    expect(credentialVerdict({ ...native, credentialMode: 'provider', nativeLoop: true }).ok).toBe(true)
    expect(credentialVerdict({ ...native, terminalLaunch: true }).ok).toBe(true)
  })
})

describe('readinessDiagnostics', () => {
  const status = { harnessId: 'opencode', installed: 'yes' as const, login: 'unknown' as const, version: '1.18.35',
    resolvedCommand: '/opt/homebrew/bin/opencode', networkSource: 'environment' as const, checkedAt: '2026-10-08T00:00:00.000Z' }
  it('reports one row per stage with bounded values', () => {
    const rows = readinessDiagnostics({ definition: { transport: 'acp' }, status, installation: true,
      credentials: credentialVerdict(native), protocolOk: true, modelCount: 133,
      handshake: { ok: true, supported: true, protocol: 'acp', agent: { name: 'OpenCode', version: '1.18.35' } } })
    expect(rows).toEqual([
      { id: 'command', status: 'ok', value: '/opt/homebrew/bin/opencode' },
      { id: 'version', status: 'ok', value: '1.18.35' },
      { id: 'network', status: 'info', value: 'Proxy from environment variables' },
      { id: 'credentials', status: 'warn', value: 'No local credential found; the Agent asks you to sign in if it needs one' },
      { id: 'protocol', status: 'ok', value: 'OpenCode 1.18.35' },
      { id: 'models', status: 'info', value: '133 models' }
    ])
  })

  it('marks unsupported versions, missing commands and failed sessions as errors', () => {
    const rows = readinessDiagnostics({ definition: { transport: 'acp' },
      status: { ...status, resolvedCommand: undefined, installed: 'no', message: 'command not found: opencode', version: undefined },
      installation: false, credentials: credentialVerdict({ ...native, requiresLogin: true }), protocolOk: false,
      handshake: { ok: false, supported: true, protocol: 'acp', detail: 'x'.repeat(600) } })
    expect(rows.find((row) => row.id === 'command')).toEqual({ id: 'command', status: 'error', value: 'command not found: opencode' })
    expect(rows.find((row) => row.id === 'credentials')?.status).toBe('error')
    const protocol = rows.find((row) => row.id === 'protocol')!
    expect(protocol.status).toBe('error')
    expect(protocol.value.length).toBeLessThanOrEqual(512)
    expect(readinessDiagnostics({ definition: { transport: 'acp' }, status: { ...status, version: '0.9.0', versionSupported: false },
      installation: false, credentials: credentialVerdict(native), protocolOk: false })
      .find((row) => row.id === 'version')).toEqual({ id: 'version', status: 'error', value: '0.9.0 (unsupported)' })
  })
})
