import { createElement, useState } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessRow, AdeHarnessTestResult } from '@shared/ade-harnesses'
import { defaultKunHarnessSettings } from '@shared/app-settings-kun-harness'
import type { KunHarnessDefaultsEntryV1, KunHarnessSettingsV1 } from '@shared/app-settings'
import { harnessProfileKey } from '@shared/harness-enablement'
import { cancelAgentEnablementChecks } from './agent-enablement-cancellation'
import { AGENT_ENABLEMENT_TIMEOUT_MS, useAgentEnablement } from './use-agent-enablement'

const mocks = vi.hoisted(() => ({ test: vi.fn(), load: vi.fn(), wait: vi.fn(), flush: vi.fn() }))
vi.mock('./agent-enablement-settings', () => ({ AGENT_SETTINGS_TIMEOUT_MS: 125_000, waitForAgentSettings: mocks.wait }))
vi.mock('../../agent/registry', () => ({ getProvider: () => ({ testHarness: mocks.test }) }))
vi.mock('../../store/harness-store', () => ({ loadHarnesses: mocks.load }))
const row: AdeHarnessRow = { definition: { id: 'pi', displayName: 'Pi', transport: 'pi-rpc',
  credentialModes: ['native-login', 'kun-gateway'], permissionModes: [], modelSource: 'probe', staticModels: [], builtin: true },
  status: { harnessId: 'pi', installed: 'yes', ready: 'unknown', login: 'unknown', checkedAt: new Date().toISOString() } }
const profile = { harnessId: 'pi', credentialMode: 'native-login' as const }
function result(ok = true): AdeHarnessTestResult {
  return { harnessId: 'pi', transport: 'pi-rpc', level: 'handshake', ok, durationMs: 1,
    detect: { durationMs: 1, ok: true, status: row.status },
    readiness: { profileKey: harnessProfileKey(profile), usable: ok, authentication: 'unverified', checks: [], checkedAt: new Date().toISOString() } }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
let tree: ReactTestRenderer | undefined
let gate: ReturnType<typeof useAgentEnablement>
let saved: KunHarnessSettingsV1
let edit: (patch: Partial<KunHarnessSettingsV1>) => void
let writes: Partial<KunHarnessSettingsV1>[]
let draftInput: Partial<KunHarnessDefaultsEntryV1> | undefined
let committed = 0
function Host({ inputRow = row }: { inputRow?: AdeHarnessRow }) {
  const [settings, setSettings] = useState(defaultKunHarnessSettings)
  saved = settings
  edit = (patch) => setSettings((current) => ({ ...current, ...patch }))
  gate = useAgentEnablement({ row: inputRow, settings, beforeCheck: mocks.flush, draft: draftInput,
    onCommitted: () => { committed += 1 }, patch: (patch) => { writes.push(patch); edit(patch) } })
  return null
}
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.test.mockReset(); mocks.load.mockReset(); mocks.wait.mockReset().mockResolvedValue(undefined); mocks.flush.mockReset().mockResolvedValue(true); writes = []; draftInput = undefined; committed = 0 })
afterEach(() => { act(() => tree?.unmount()); tree = undefined; vi.useRealTimers(); vi.unstubAllGlobals() })
function mount() { act(() => { tree = create(createElement(Host)) }) }

describe('finite, cancellable enablement', () => {
  it('enables only after explicit readiness, and never promotes detection-only/old responses', async () => {
    mocks.test.mockResolvedValue({ ...result(), readiness: undefined }); mount()
    await act(async () => { await gate.enable() })
    expect(saved.enabledProfiles).toEqual([])
    expect(gate.error).toBeTruthy()
    mocks.test.mockResolvedValue(result())
    await act(async () => { await gate.enable() })
    expect(saved.enabledProfiles).toEqual([profile])
    expect(gate.result?.readiness?.authentication).toBe('unverified')
  })
  it('locks repeated clicks synchronously and cancellation ignores even a late success', async () => {
    const pending = deferred<AdeHarnessTestResult>(); mocks.test.mockReturnValue(pending.promise); mount()
    let checking!: Promise<void>
    await act(async () => { checking = gate.enable(); void gate.enable() })
    expect(mocks.test).toHaveBeenCalledTimes(1)
    const signal = mocks.test.mock.calls[0][2].signal as AbortSignal
    act(() => gate.cancel()); expect(signal.aborted).toBe(true)
    await act(async () => { pending.resolve(result()); await checking })
    expect(writes).toEqual([]); expect(gate.checking).toBe(false)
  })
  it.each(['model', 'provider', 'binary'] as const)('rejects %s edits during an in-flight check', async (kind) => {
    const pending = deferred<AdeHarnessTestResult>(); mocks.test.mockReturnValue(pending.promise); mount()
    let checking!: Promise<void>; await act(async () => { checking = gate.enable() })
    act(() => edit(kind === 'binary' ? { providers: { pi: { command: '/changed/pi' } } }
      : { defaults: { pi: kind === 'model' ? { model: 'changed' } : { credentialMode: 'kun-gateway', providerId: 'new' } } }))
    await act(async () => { pending.resolve(result()); await checking })
    expect(saved.enabledProfiles).toEqual([]); expect(writes).toEqual([])
  })
  it('rejects stale agent switches and unmounts', async () => {
    const pending = deferred<AdeHarnessTestResult>(); mocks.test.mockReturnValue(pending.promise); mount()
    let checking!: Promise<void>; await act(async () => { checking = gate.enable() })
    act(() => tree!.update(createElement(Host, { inputRow: { ...row, definition: { ...row.definition, id: 'deepseek-harness' } } })))
    await act(async () => { pending.resolve(result()); await checking })
    expect(writes).toEqual([])
    const next = deferred<AdeHarnessTestResult>(); mocks.test.mockReturnValue(next.promise)
    await act(async () => { checking = gate.enable() }); act(() => tree!.unmount()); tree = undefined
    await act(async () => { next.resolve(result()); await checking })
    expect(writes).toEqual([])
  })
  it('times out a transport that ignores cancellation and never enables after the deadline', async () => {
    vi.useFakeTimers(); const pending = deferred<AdeHarnessTestResult>(); mocks.test.mockReturnValue(pending.promise); mount()
    let checking!: Promise<void>; await act(async () => { checking = gate.enable() })
    await act(async () => { await vi.advanceTimersByTimeAsync(AGENT_ENABLEMENT_TIMEOUT_MS); await checking })
    expect(gate.checking).toBe(false); expect(gate.error).toBe('agentEnablement.timeout'); expect(writes).toEqual([])
    await act(async () => { pending.resolve(result()); await Promise.resolve() }); expect(writes).toEqual([])
  })
  it('fails closed on mismatched profile and preserves other enabled profiles when disabling', async () => {
    mocks.test.mockResolvedValue({ ...result(), readiness: { ...result().readiness!, profileKey: 'other' } }); mount()
    await act(async () => { await gate.enable() }); expect(saved.enabledProfiles).toEqual([])
    const other = { ...profile, providerId: 'account-other' }
    act(() => edit({ enabledProfiles: [profile, other] })); act(() => gate.disable())
    expect(saved.enabledProfiles).toEqual([other])
  })
  it('cancels on close intent before delayed settings navigation unmounts', async () => {
    const pending = deferred<AdeHarnessTestResult>(); mocks.test.mockReturnValue(pending.promise); mount()
    let checking!: Promise<void>; await act(async () => { checking = gate.enable() })
    act(() => cancelAgentEnablementChecks())
    expect(gate.checking).toBe(false)
    await act(async () => { pending.resolve(result()); await checking })
    expect(saved.enabledProfiles).toEqual([]); expect(writes).toEqual([])
  })
  it('recheck disables first and a failed recheck stays disabled', async () => {
    mocks.test.mockResolvedValue(result(false)); mount(); act(() => edit({ enabledProfiles: [profile] }))
    await act(async () => { gate.disable(); await gate.enable() })
    expect(saved.enabledProfiles).toEqual([]); expect(gate.error).toBeTruthy()
  })
})

it('does not probe before an in-flight save completes and reports save failure', async () => {
  const save = deferred<boolean>(); mocks.flush.mockReturnValue(save.promise); mocks.test.mockResolvedValue(result()); mount()
  let checking!: Promise<void>
  await act(async () => { checking = gate.enable() })
  expect(mocks.test).not.toHaveBeenCalled(); expect(gate.phase).toBe('preparing')
  await act(async () => { save.resolve(false); await checking })
  expect(gate.error).toBe('agentEnablement.saveFailed'); expect(writes).toEqual([])
})
it('keeps activation pending until the profile is persisted and acknowledged', async () => {
  const applied = deferred<void>(); mocks.wait.mockResolvedValueOnce(undefined).mockReturnValueOnce(applied.promise)
  mocks.test.mockResolvedValue(result()); mount()
  let checking!: Promise<void>
  await act(async () => { checking = gate.enable() })
  expect(gate.phase).toBe('activating'); expect(gate.checking).toBe(true)
  expect(mocks.flush).toHaveBeenCalledTimes(2)
  expect(mocks.wait.mock.calls[1][2]).toMatchObject({ harnessId: 'pi', enabledProfile: profile })
  expect(mocks.load).not.toHaveBeenCalled()
  await act(async () => { applied.resolve(); await checking })
  expect(gate.checking).toBe(false); expect(mocks.load).toHaveBeenCalled()
})
it('does not cancel a valid check when command detection fills initially unknown facts', async () => {
  const pending = deferred<AdeHarnessTestResult>(); mocks.test.mockReturnValue(pending.promise); mount()
  let checking!: Promise<void>
  await act(async () => { checking = gate.enable() })
  act(() => tree!.update(createElement(Host, { inputRow: { ...row, status: { ...row.status,
    version: '1.0.0', resolvedCommand: '/selected/pi' } } })))
  await act(async () => { pending.resolve(result()); await checking })
  expect(saved.enabledProfiles).toEqual([profile])
})
it('identifies the failed readiness step instead of using successful handshake text', async () => {
  mocks.test.mockResolvedValue({ ...result(false), handshake: { ok: true, supported: true, durationMs: 1, detail: 'Connected' },
    readiness: { ...result(false).readiness!, checks: [{ id: 'credentials', ok: false, detail: 'Missing account' }] } }); mount()
  await act(async () => { await gate.enable() })
  expect(gate.error).toBe('agentEnablement.failures.credentials'); expect(gate.errorDetail).toBe('Missing account')
})

describe('unsaved connection edits', () => {
  const gatewayProfile = { harnessId: 'pi', credentialMode: 'kun-gateway' as const, providerId: 'new' }
  const draft = { credentialMode: 'kun-gateway' as const, providerId: 'new' }
  const gatewayResult = (ok = true): AdeHarnessTestResult => ({ ...result(ok),
    readiness: { ...result(ok).readiness!, profileKey: harnessProfileKey(gatewayProfile) } })
  const enableSaved = (): void => { act(() => edit({ enabledProfiles: [profile], defaults: { pi: { credentialMode: 'native-login' } } })) }

  it('keeps the saved connection enabled while an edit is pending and reports it as dirty', () => {
    mount(); enableSaved(); draftInput = draft
    act(() => tree!.update(createElement(Host)))
    expect(gate.dirty).toBe(true); expect(gate.savedEnabled).toBe(true); expect(gate.savedProfile).toEqual(profile)
    expect(gate.profile).toEqual(gatewayProfile)
    // Pending edits are never written by merely existing.
    expect(writes).toEqual([])
  })

  it('checks the edit, then saves and clears it only after the check passes', async () => {
    mocks.test.mockResolvedValue(gatewayResult()); mount(); enableSaved(); draftInput = draft
    act(() => tree!.update(createElement(Host)))
    await act(async () => { await gate.enable() })
    expect(mocks.test.mock.calls[0][1]).toMatchObject({ credentialMode: 'kun-gateway', providerId: 'new' })
    expect(saved.defaults.pi).toMatchObject({ credentialMode: 'kun-gateway', providerId: 'new' })
    expect(saved.enabledProfiles).toContainEqual(gatewayProfile)
    expect(committed).toBe(1)
  })

  it('writes the original defaults back when the check fails, and keeps the edit for another try', async () => {
    mocks.test.mockResolvedValue(gatewayResult(false)); mount(); enableSaved(); draftInput = draft
    act(() => tree!.update(createElement(Host)))
    await act(async () => { await gate.enable() })
    expect(saved.defaults.pi).toEqual({ credentialMode: 'native-login' })
    expect(saved.enabledProfiles).toEqual([profile])
    expect(committed).toBe(0); expect(gate.error).toBeTruthy(); expect(gate.dirty).toBe(true)
    expect(mocks.load).toHaveBeenCalled()
  })

  it('writes the original defaults back when the check is cancelled after the edit was saved', async () => {
    const pending = deferred<AdeHarnessTestResult>(); mocks.test.mockReturnValue(pending.promise)
    mount(); enableSaved(); draftInput = draft
    act(() => tree!.update(createElement(Host)))
    let checking!: Promise<void>
    await act(async () => { checking = gate.enable() })
    expect(saved.defaults.pi).toMatchObject({ credentialMode: 'kun-gateway' })
    act(() => gate.cancel())
    expect(saved.defaults.pi).toEqual({ credentialMode: 'native-login' })
    await act(async () => { pending.resolve(gatewayResult()); await checking })
    expect(saved.defaults.pi).toEqual({ credentialMode: 'native-login' }); expect(committed).toBe(0)
  })

  it('writes the original defaults back when the page goes away mid-check', async () => {
    const pending = deferred<AdeHarnessTestResult>(); mocks.test.mockReturnValue(pending.promise)
    mount(); enableSaved(); draftInput = draft
    act(() => tree!.update(createElement(Host)))
    let checking!: Promise<void>
    await act(async () => { checking = gate.enable() })
    expect(saved.defaults.pi).toMatchObject({ credentialMode: 'kun-gateway' })
    act(() => tree!.unmount()); tree = undefined
    // The host is gone, so read what was written rather than its last state.
    expect(writes.at(-1)).toEqual({ defaults: { pi: { credentialMode: 'native-login' } } })
    await act(async () => { pending.resolve(gatewayResult()); await checking })
    expect(writes.at(-1)).toEqual({ defaults: { pi: { credentialMode: 'native-login' } } }); expect(committed).toBe(0)
  })

  it('does not let an old cancelled run revert the draft a newer run saved', async () => {
    const first = deferred<AdeHarnessTestResult>(); const second = deferred<AdeHarnessTestResult>()
    mocks.test.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    mount(); enableSaved(); draftInput = draft
    act(() => tree!.update(createElement(Host)))
    let one!: Promise<void>, two!: Promise<void>
    await act(async () => { one = gate.enable() })
    act(() => gate.cancel())
    await act(async () => { two = gate.enable() })
    await act(async () => { first.resolve(gatewayResult()); await one })
    expect(saved.defaults.pi).toMatchObject({ credentialMode: 'kun-gateway' })
    await act(async () => { second.resolve(gatewayResult()); await two })
    expect(saved.enabledProfiles).toContainEqual(gatewayProfile); expect(committed).toBe(1)
  })

  it('turns off the saved connection, not the unsaved one, and discards the edit', () => {
    mount(); enableSaved(); draftInput = draft
    act(() => tree!.update(createElement(Host)))
    act(() => gate.disable())
    expect(saved.enabledProfiles).toEqual([]); expect(committed).toBe(1)
  })
})
