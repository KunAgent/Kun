import { withHarnessReadiness } from '@shared/test-support/harness-readiness'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import {
  loadHarnesses,
  loadHarnessModels,
  loadHarnessProviderGroups,
  resetHarnessPolling,
  applyHarnessEnablementSettings,
  HARNESS_CATALOG_TTL_MS,
  nextReadinessPoll,
  READINESS_REFRESH_AHEAD_MS,
  useHarnessStore
} from './harness-store'

const provider = vi.hoisted(() => ({
  listHarnesses: vi.fn(),
  listHarnessModels: vi.fn()
}))

vi.mock('../agent/registry', () => ({
  getProvider: () => provider
}))

function row(
  id: string,
  status: Partial<AdeHarnessRow['status']> = {}
): AdeHarnessRow {
  return withHarnessReadiness({
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
  })
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
    provider.listHarnessModels.mockReset()
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
    expect(provider.listHarnesses).toHaveBeenCalledWith({ waitMs: 3_000, includeDisabled: true })
  })

  it('reuses a fresh catalog across repeated opens and keeps rows during one background refresh', async () => {
    const cached = row('devin')
    provider.listHarnesses.mockResolvedValue([cached])
    await loadHarnesses()
    for (let open = 0; open < 5; open++) await loadHarnesses()
    expect(provider.listHarnesses).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(HARNESS_CATALOG_TTL_MS + 1)
    let finish!: (rows: AdeHarnessRow[]) => void
    provider.listHarnesses.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const refresh = loadHarnesses()
    expect(useHarnessStore.getState()).toMatchObject({ rows: [cached], rowsLoading: true })
    await loadHarnesses()
    expect(provider.listHarnesses).toHaveBeenCalledTimes(2)
    finish([row('devin', { version: 'new' })])
    await refresh
    expect(useHarnessStore.getState().rows[0]?.status.version).toBe('new')
    await loadHarnesses()
    expect(provider.listHarnesses).toHaveBeenCalledTimes(2)
  })

  it('explicit refresh bypasses the cache and revoked profiles cannot be restored by an older request', async () => {
    const cached = row('devin')
    provider.listHarnesses.mockResolvedValue([cached])
    await loadHarnesses()
    let finish!: (rows: AdeHarnessRow[]) => void
    provider.listHarnesses.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const refresh = loadHarnesses(true)
    applyHarnessEnablementSettings({ disabledIds: ['devin'], enabledProfiles: [], defaults: {}, custom: [], binaryPaths: {},
      defaultHarnessId: 'kun', agentOrder: [], terminalAgents: [] }, true)
    expect(useHarnessStore.getState().rowsLoadedAt).toBeUndefined()
    expect(useHarnessStore.getState().rows[0]?.readyProfiles).toEqual([])
    finish([cached])
    await refresh
    expect(useHarnessStore.getState().rows[0]?.enabled).toBe(false)
    provider.listHarnesses.mockResolvedValue([])
    await loadHarnesses()
    expect(provider.listHarnesses).toHaveBeenCalledTimes(3)
  })

  it('retains cached rows after a refresh error while retrying in the background', async () => {
    const cached = row('devin')
    provider.listHarnesses.mockResolvedValueOnce([cached]).mockRejectedValueOnce(new Error('offline'))
    await loadHarnesses()
    await vi.advanceTimersByTimeAsync(HARNESS_CATALOG_TTL_MS + 1)
    await loadHarnesses()
    expect(useHarnessStore.getState()).toMatchObject({ rows: [cached], rowsLoading: false, rowsError: 'offline' })
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

describe('harness model cache identity', () => {
  it('loads selected native details while preserving only previously learned reasoning facts', async () => {
    useHarnessStore.setState({ models: { devin: { loading: false, models: ['first', 'second'],
      loadedAt: Date.now(), modelInfo: [{ id: 'first', displayName: 'Old label', isDefault: true,
        reasoningEfforts: ['medium', 'high'] }] } } })
    provider.listHarnessModels.mockResolvedValue({ models: ['first', 'second'], modelInfo: [
      { id: 'first', displayName: 'New label' }, { id: 'second', isDefault: true, reasoningEfforts: ['low'] }
    ] })
    await loadHarnessModels('devin', false, 'second')
    expect(provider.listHarnessModels).toHaveBeenCalledWith('devin', undefined, 'second')
    const cache = useHarnessStore.getState().models.devin
    expect(cache.modelInfo?.[0]).toEqual({ id: 'first', displayName: 'New label',
      reasoningEfforts: ['medium', 'high'], defaultReasoningEffort: undefined })
    expect(cache.detailsModel).toBe('second')
  })

  beforeEach(() => {
    resetStore()
    resetHarnessPolling()
    provider.listHarnesses.mockReset()
    provider.listHarnessModels.mockReset()
  })

  it('invalidates model and gateway groups when the same harness changes transport', async () => {
    const old = row('codex')
    useHarnessStore.setState({ rows: [old] })
    provider.listHarnessModels.mockImplementation(async (_id: string, mode?: string) =>
      mode === 'kun-gateway' ? { groups: [{ providerId: 'old', label: 'Old', models: ['old'] }] } : { models: ['old'] })
    await loadHarnessModels('codex')
    await loadHarnessProviderGroups('codex')
    expect(useHarnessStore.getState().models.codex?.models).toEqual(['old'])
    const native = { ...old, definition: { ...old.definition, transport: 'codex-app-server' as const } }
    provider.listHarnesses.mockResolvedValue([native])
    await loadHarnesses(true)
    expect(useHarnessStore.getState().models.codex).toBeUndefined()
    expect(useHarnessStore.getState().providerGroups.codex).toBeUndefined()
    provider.listHarnessModels.mockResolvedValue({ models: ['new'] })
    await loadHarnessModels('codex')
    expect(useHarnessStore.getState().models.codex?.models).toEqual(['new'])
  })

  it('does not let an old in-flight model response replace the new transport catalog', async () => {
    const old = row('codex')
    useHarnessStore.setState({ rows: [old] })
    let resolveOld!: (value: { models: string[] }) => void
    provider.listHarnessModels.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockResolvedValueOnce({ models: ['native-model'] })
    const pending = loadHarnessModels('codex')
    const native = { ...old, definition: { ...old.definition, transport: 'codex-app-server' as const } }
    provider.listHarnesses.mockResolvedValue([native])
    await loadHarnesses(true)
    await loadHarnessModels('codex')
    resolveOld({ models: ['stale-acp-model'] })
    await pending
    expect(useHarnessStore.getState().models.codex?.models).toEqual(['native-model'])
  })

  it('reloads models after the native network policy changes without exposing the proxy URL', async () => {
    const old = row('codex', { networkSource: 'system', networkFingerprint: 'opaque-old' })
    useHarnessStore.setState({ rows: [old], models: { codex: { models: ['cached'], loading: false } } })
    provider.listHarnesses.mockResolvedValue([row('codex', { networkSource: 'system', networkFingerprint: 'opaque-new' })])
    await loadHarnesses(true)
    expect(useHarnessStore.getState().models.codex).toBeUndefined()
    provider.listHarnessModels.mockResolvedValue({ models: ['refreshed'] })
    await loadHarnessModels('codex')
    expect(useHarnessStore.getState().models.codex?.models).toEqual(['refreshed'])
  })

  it('invalidates cached empty models when native sign-in changes', async () => {
    const old = row('claude-code', { login: 'signed-out' })
    useHarnessStore.setState({ rows: [old], models: { 'claude-code': { models: [], loading: false } } })
    provider.listHarnesses.mockResolvedValue([row('claude-code', { login: 'signed-in' })])
    await loadHarnesses(true)
    expect(useHarnessStore.getState().models['claude-code']).toBeUndefined()
  })

  it('preserves a model cache through a volatile checkedAt refresh', async () => {
    const old = row('codex')
    useHarnessStore.setState({ rows: [old], models: { codex: { models: ['cached'], loading: false } } })
    provider.listHarnesses.mockResolvedValue([{ ...old, status: { ...old.status, checkedAt: '2026-02-01T00:00:00.000Z' } }])
    await loadHarnesses(true)
    expect(useHarnessStore.getState().models.codex?.models).toEqual(['cached'])
  })
})

describe('harnessRowUnavailableCode (P4-05)', () => {
  it('prefers the wire reasonCode and honors the detecting sentinel', async () => {
    const { harnessRowUnavailableCode } = await import('./harness-store')
    expect(harnessRowUnavailableCode(detectingRow())).toBe('detecting')
    expect(harnessRowUnavailableCode(row('devin', { detecting: true }))).toBeNull()
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
    // Inconclusive protocol checks fail closed for new routes.
    expect(harnessRowUnavailableCode(row('a', { ready: 'unknown' }))).toBe('readiness_required')
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

describe('native catalog failures', () => {
  beforeEach(() => { resetStore(); provider.listHarnessModels.mockReset() })

  it('records a failed live lookup as an error and keeps models already shown', async () => {
    provider.listHarnessModels.mockResolvedValueOnce({ harnessId: 'devin', models: ['swe-2'], catalogStatus: { source: 'native', fetchedAt: 'x' } })
    await loadHarnessModels('devin')
    provider.listHarnessModels.mockResolvedValueOnce({ harnessId: 'devin', models: [],
      catalogStatus: { source: 'fallback', fetchedAt: 'y', error: { code: 'agent_error', message: 'team settings timed out' } } })
    await loadHarnessModels('devin', true)
    expect(useHarnessStore.getState().models.devin).toMatchObject({
      models: ['swe-2'], error: 'team settings timed out', errorCode: 'agent_error', failures: 1, loading: false
    })
  })

  it('counts consecutive empty failures so the composer can back off', async () => {
    const failed = { harnessId: 'devin', models: [], catalogStatus: { source: 'fallback', fetchedAt: 'y', error: { code: 'timeout' } } }
    provider.listHarnessModels.mockResolvedValue(failed)
    await loadHarnessModels('devin')
    await loadHarnessModels('devin')
    expect(useHarnessStore.getState().models.devin).toMatchObject({ models: [], errorCode: 'timeout', failures: 2 })
    provider.listHarnessModels.mockResolvedValue({ harnessId: 'devin', models: ['ok'], catalogStatus: { source: 'native', fetchedAt: 'z' } })
    await loadHarnessModels('devin')
    expect(useHarnessStore.getState().models.devin?.error).toBeUndefined()
    expect(useHarnessStore.getState().models.devin?.failures).toBeUndefined()
  })
})

describe('cold-start catalog seed', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    resetStore(); provider.listHarnessModels.mockReset(); store.clear()
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('shows the last live catalog while a cold-start lookup fails, then stays honest about the failure', async () => {
    provider.listHarnessModels.mockResolvedValueOnce({ harnessId: 'devin', models: ['swe-2'], catalogStatus: { source: 'native', fetchedAt: 'x', version: '3000.11.3' } })
    await loadHarnessModels('devin')
    resetStore()
    provider.listHarnessModels.mockResolvedValueOnce({ harnessId: 'devin', models: [],
      catalogStatus: { source: 'fallback', fetchedAt: 'y', error: { code: 'timeout' } } })
    await loadHarnessModels('devin')
    expect(useHarnessStore.getState().models.devin).toMatchObject({ models: ['swe-2'], errorCode: 'timeout' })
  })
})

describe('readiness refresh-ahead polling', () => {
  it('polls inside the runtime refresh window, then at expiry once it has passed', () => {
    const now = 1_000_000
    expect(nextReadinessPoll([now + 300_000], now)).toBe(now + 300_000 - READINESS_REFRESH_AHEAD_MS)
    expect(nextReadinessPoll([now + 30_000], now)).toBe(now + 30_001)
  })
})
