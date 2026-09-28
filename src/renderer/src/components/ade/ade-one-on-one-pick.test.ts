import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import {
  readAdeLastOneOnOnePick,
  resolveOneOnOnePick,
  writeAdeLastOneOnOnePick
} from './ade-one-on-one-pick'

function row(modes: string[] = ['native-login']): AdeHarnessRow {
  return {
    definition: {
      id: 'h1',
      displayName: 'H1',
      transport: 'acp',
      credentialModes: modes as AdeHarnessRow['definition']['credentialModes'],
      permissionModes: [],
      modelSource: 'static',
      staticModels: [],
      builtin: false
    },
    status: {
      harnessId: 'h1',
      installed: 'yes',
      login: 'signed-in',
      checkedAt: '2026-01-01T00:00:00.000Z'
    }
  }
}

describe('ade-one-on-one-pick storage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns null when storage is empty or unreadable', () => {
    expect(readAdeLastOneOnOnePick()).toBeNull()
    vi.stubGlobal('localStorage', {
      getItem: () => '{bad json',
      setItem: () => undefined
    })
    expect(readAdeLastOneOnOnePick()).toBeNull()
  })

  it('round-trips a pick and drops unknown fields', () => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value)
    })
    writeAdeLastOneOnOnePick({
      harnessId: 'claude-code',
      credentialMode: 'kun-gateway',
      providerId: 'deepseek',
      model: 'deepseek-chat',
      isolation: 'worktree'
    })
    expect(readAdeLastOneOnOnePick()).toEqual({
      harnessId: 'claude-code',
      credentialMode: 'kun-gateway',
      providerId: 'deepseek',
      model: 'deepseek-chat',
      isolation: 'worktree'
    })
  })

  it('rejects a payload without a harness id', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => JSON.stringify({ model: 'x' }),
      setItem: () => undefined
    })
    expect(readAdeLastOneOnOnePick()).toBeNull()
  })
})

describe('resolveOneOnOnePick (P4-15)', () => {
  it('falls back to the row defaults when nothing else applies', () => {
    expect(resolveOneOnOnePick({ row: row(), defaults: undefined })).toEqual({
      credentialMode: 'native-login',
      providerId: '',
      model: '',
      isolation: 'local'
    })
  })

  it('applies configured P4-11 defaults', () => {
    const resolved = resolveOneOnOnePick({
      row: row(['native-login', 'kun-gateway']),
      defaults: {
        credentialMode: 'kun-gateway',
        providerId: 'deepseek',
        model: 'deepseek-chat',
        isolation: 'worktree'
      }
    })
    expect(resolved).toEqual({
      credentialMode: 'kun-gateway',
      providerId: 'deepseek',
      model: 'deepseek-chat',
      isolation: 'worktree'
    })
  })

  it('lets the remembered pick win over configured defaults', () => {
    const resolved = resolveOneOnOnePick({
      row: row(['native-login', 'provider']),
      defaults: { credentialMode: 'provider', providerId: 'p1', model: 'm1' },
      hint: {
        harnessId: 'h1',
        credentialMode: 'native-login',
        model: 'm-last',
        isolation: 'local'
      }
    })
    expect(resolved.credentialMode).toBe('native-login')
    expect(resolved.model).toBe('m-last')
    expect(resolved.providerId).toBe('p1')
  })

  it('ignores a remembered credential mode the harness does not offer', () => {
    const resolved = resolveOneOnOnePick({
      row: row(['native-login']),
      defaults: undefined,
      hint: { harnessId: 'h1', credentialMode: 'kun-gateway' }
    })
    expect(resolved.credentialMode).toBe('native-login')
  })
})
