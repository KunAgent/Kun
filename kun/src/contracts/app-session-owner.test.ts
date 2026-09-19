import { describe, expect, it } from 'vitest'
import { AppSessionOwnerSchema, sameAppSessionOwner } from './app-session-owner.js'
import { createManagerDiscoveryRecord } from '../manager/manager-discovery.js'

const owner = {
  ownerSessionId: 'application-session', ownerKind: 'gui' as const, ownerPid: 123,
  ownerStartedAt: '2026-09-14T00:00:00.000Z', ownerProcessIdentity: 'process-birth-identity', generation: 1
}

describe('application owner contract', () => {
  it('requires a complete positive generation and process identity for owned mode', () => {
    expect(() => AppSessionOwnerSchema.parse({ ...owner, generation: 0 })).toThrow()
    expect(() => AppSessionOwnerSchema.parse({ ...owner, ownerProcessIdentity: '' })).toThrow()
    expect(() => AppSessionOwnerSchema.parse({ ...owner, generation: undefined })).toThrow()
  })

  it('rejects changed sessions, generations and process births even when the PID matches', () => {
    expect(sameAppSessionOwner(owner, { ...owner })).toBe(true)
    expect(sameAppSessionOwner(owner, { ...owner, ownerSessionId: 'another-session' })).toBe(false)
    expect(sameAppSessionOwner(owner, { ...owner, generation: 2 })).toBe(false)
    expect(sameAppSessionOwner(owner, { ...owner, ownerProcessIdentity: 'reused-pid' })).toBe(false)
    expect(sameAppSessionOwner(owner, undefined)).toBe(false)
  })

  it('reads legacy discovery without granting application ownership', () => {
    const record = createManagerDiscoveryRecord({ instanceId: 'legacy-manager', pid: 123,
      startedAt: owner.ownerStartedAt, host: '127.0.0.1', port: 19999,
      baseUrl: 'http://127.0.0.1:19999', managerToken: 'local-test-token', serviceVersion: '0.3.9',
      dataDir: '/test/data', settingsPath: '/test/settings.json' })
    expect(record.appOwner).toBeUndefined()
    expect(sameAppSessionOwner(record.appOwner, owner)).toBe(false)
  })
})
