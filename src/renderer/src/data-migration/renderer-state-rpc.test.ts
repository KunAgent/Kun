import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ImportedWorkspaceTrustReset } from '@shared/data-migration'
import {
  applyTrustResetSnapshot,
  captureTrustResets,
  normalizeTrustResetSnapshot
} from './renderer-state-rpc'

describe('data migration renderer trust snapshots', () => {
  const values = new Map<string, string>()

  beforeEach(() => {
    values.clear()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) }
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('replaces the operation workspace scope so rollback can remove a newly introduced reset', () => {
    const reset: ImportedWorkspaceTrustReset = { workspaceRoot: '/imported', trusted: false, disabledCapabilities: ['commands'] }
    applyTrustResetSnapshot({ workspaceRoots: ['/imported'], resets: [reset] })
    expect(captureTrustResets(['/imported'])).toEqual([reset])
    applyTrustResetSnapshot({ workspaceRoots: ['/imported'], resets: [] })
    expect(captureTrustResets(['/imported'])).toEqual([])
  })

  it('rejects a trust record outside the declared replacement scope', () => {
    expect(() => normalizeTrustResetSnapshot({
      workspaceRoots: ['/allowed'],
      resets: [{ workspaceRoot: '/other', trusted: false, disabledCapabilities: [] }]
    })).toThrow('out-of-scope workspace')
  })
})
