import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import {
  loadHarnesses,
  resetHarnessPolling,
  useHarnessStore
} from './harness-store'

const provider = vi.hoisted(() => ({
  listHarnesses: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: () => provider
}))

function row(
  id: string,
  status: Partial<AdeHarnessRow['status']> = {}
): AdeHarnessRow {
  return {
    definition: {
      id,
      displayName: id,
      transport: 'acp',
      credentialModes: ['native-login'],
      permissionModes: [],
      modelSource: 'static',
      staticModels: [],
      builtin: false
    },
    status: {
      harnessId: id,
      installed: 'yes',
      login: 'signed-in',
      checkedAt: '2026-01-01T00:00:00.000Z',
      ...status
    }
  }
}

const detectingRow = (): AdeHarnessRow =>
  row('fake-cli', { installed: 'unknown', login: 'unknown', detecting: true })

function resetStore(): void {
  useHarnessStore.setState({
    rows: [],
    rowsLoadedAt: undefined,
    rowsLoading: false,
    rowsError: undefined,
    models: {},
    providerGroups: {},
    sessions: {}
  })
}

describe('harness-store loadHarnesses polling (P4-02)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    provider.listHarnesses.mockReset()
    resetStore()
    resetHarnessPolling()
  })

  afterEach(() => {
    resetHarnessPolling()
    vi.useRealTimers()
  })

  it('passes waitMs through to the provider list request', async () => {
    provider.listHarnesses.mockResolvedValue([row('kun')])
    await loadHarnesses(true, { waitMs: 3_000 })
    expect(provider.listHarnesses).toHaveBeenCalledWith({ waitMs: 3_000 })
  })

  it('polls while a row is still detecting and stops once it settles', async () => {
    provider.listHarnesses
      .mockResolvedValueOnce([detectingRow()])
      .mockResolvedValueOnce([row('fake-cli')])
    await loadHarnesses(true)
    expect(provider.listHarnesses).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(provider.listHarnesses).toHaveBeenCalledTimes(2)
    expect(useHarnessStore.getState().rows[0]?.status.installed).toBe('yes')

    // Settled — no further polls.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(provider.listHarnesses).toHaveBeenCalledTimes(2)
  })

  it('keeps polling on provisional unknown verdicts without the flag', async () => {
    provider.listHarnesses
      .mockResolvedValueOnce([row('fake-cli', { installed: 'unknown', login: 'unknown' })])
      .mockResolvedValueOnce([row('fake-cli')])
    await loadHarnesses(true)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(provider.listHarnesses).toHaveBeenCalledTimes(2)
    expect(useHarnessStore.getState().rows[0]?.status.installed).toBe('yes')
  })

  it('retries a failed list with backoff and records the error', async () => {
    provider.listHarnesses
      .mockRejectedValueOnce(new Error('runtime offline'))
      .mockResolvedValueOnce([row('fake-cli')])
    await loadHarnesses(true)
    expect(useHarnessStore.getState().rowsError).toBe('runtime offline')

    await vi.advanceTimersByTimeAsync(1_000)
    expect(provider.listHarnesses).toHaveBeenCalledTimes(2)
    expect(useHarnessStore.getState().rowsError).toBeUndefined()
    expect(useHarnessStore.getState().rows[0]?.status.installed).toBe('yes')
  })

  it('stops polling once the detecting budget is spent', async () => {
    provider.listHarnesses.mockResolvedValue([detectingRow()])
    await loadHarnesses(true)
    await vi.advanceTimersByTimeAsync(40_000)
    const callsAfterBudget = provider.listHarnesses.mock.calls.length
    expect(callsAfterBudget).toBeGreaterThan(1)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(provider.listHarnesses).toHaveBeenCalledTimes(callsAfterBudget)
  })
})

describe('harnessRowUnavailableCode (P4-05)', () => {
  it('prefers the wire reasonCode and honors the detecting sentinel', async () => {
    const { harnessRowUnavailableCode } = await import('./harness-store')
    expect(harnessRowUnavailableCode(detectingRow())).toBe('detecting')
    expect(
      harnessRowUnavailableCode(row('a', { installed: 'no', reasonCode: 'adapter_missing' }))
    ).toBe('adapter_missing')
  })

  it('derives codes from fields for statuses predating reasonCode', async () => {
    const { harnessRowUnavailableCode } = await import('./harness-store')
    expect(harnessRowUnavailableCode(row('a', { installed: 'no' }))).toBe('not_installed')
    expect(
      harnessRowUnavailableCode(row('a', { versionSupported: false }))
    ).toBe('version_too_low')
    expect(
      harnessRowUnavailableCode(row('a', { ready: 'no', login: 'signed-out' }))
    ).toBe('handshake_failed')
    // P4-03: an inconclusive handshake stays selectable — the wire
    // `handshake_timeout` code is advisory for management surfaces only.
    expect(harnessRowUnavailableCode(row('a', { ready: 'unknown' }))).toBeNull()
    expect(harnessRowUnavailableCode(row('a', { login: 'signed-out' }))).toBe('signed_out')
    expect(harnessRowUnavailableCode(row('a', { ready: 'yes' }))).toBeNull()
  })
})

describe('harnessRowRunsTurns (P4-13)', () => {
  it('excludes terminal-only rows from turn pickers', async () => {
    const { harnessRowRunsTurns } = await import('./harness-store')
    const terminalRow = row('zed-shell')
    terminalRow.definition.transport = 'terminal'
    expect(harnessRowRunsTurns(terminalRow)).toBe(false)
    expect(harnessRowRunsTurns(row('mine'))).toBe(true)
    const kunRow = row('kun')
    kunRow.definition.transport = 'native-loop'
    expect(harnessRowRunsTurns(kunRow)).toBe(true)
  })
})
