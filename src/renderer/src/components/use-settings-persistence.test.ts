import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsPersistence } from './use-settings-persistence'

const mocks = vi.hoisted(() => ({ set: vi.fn(), get: vi.fn(), sync: vi.fn() }))
vi.mock('../agent/runtime-client', () => ({ rendererRuntimeClient: { setSettings: mocks.set, getSettings: mocks.get } }))
vi.mock('../lib/keyboard-shortcut-settings', () => ({ emitRendererSettingsChanged: vi.fn() }))
vi.mock('../lib/remote-mobile', () => ({ isRemoteWeb: () => false, readRemoteLocaleOverride: () => undefined }))
vi.mock('../lib/settings-home-paths', () => ({ expandSettingsHomePathsForUse: (s: unknown) => s }))
vi.mock('./settings-save-error', () => ({ parseSettingsSaveIssue: () => null }))
vi.mock('./settings-utils', () => ({ coerceRendererSettings: (s: unknown) => s, hasValidPort: () => true,
  diffSettingsPatch: (base: Record<string, unknown>, next: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(next).filter(([key, value]) => base[key] !== value)) }))

const ref = <T,>(current: T) => ({ current })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
let tree: ReactTestRenderer | undefined
let api: ReturnType<typeof useSettingsPersistence>
let scope: Record<string, any>
function Host() { api = useSettingsPersistence(scope); return null }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.set.mockReset(); mocks.get.mockReset().mockResolvedValue({ theme: 'light', locale: 'en' })
  mocks.sync.mockReset().mockResolvedValue({ state: 'synced' })
  vi.stubGlobal('window', { setTimeout, clearTimeout, kunGui: { getRuntimeSettingsSyncStatus: mocks.sync } })
  scope = { form: { theme: 'light', locale: 'en' }, pendingSnapshotRef: ref(null), persistedSettingsRef: ref({ theme: 'light', locale: 'en' }),
    saveTimer: ref(null), statusTimer: ref(null), draftVersion: ref(0), flushOnUnmountRef: ref(null),
    setForm: vi.fn(), setSaveStatus: vi.fn(), setSaveError: vi.fn(), setSaveIssue: vi.fn(),
    applyI18n: vi.fn(async () => undefined), reloadUiSettings: vi.fn(), probeRuntime: vi.fn() }
  act(() => { tree = create(createElement(Host)) })
})
afterEach(() => { act(() => tree?.unmount()); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('settings save barrier', () => {
  it('flush waits for an automatic save that already left the debounce queue', async () => {
    const write = deferred<any>(); mocks.set.mockReturnValue(write.promise)
    api.scheduleSave({ theme: 'dark', locale: 'en' }); await vi.advanceTimersByTimeAsync(450)
    expect(scope.pendingSnapshotRef.current).toBeNull()
    let done = false
    const flushed = api.flushPendingSave().then(() => { done = true })
    await Promise.resolve(); expect(done).toBe(false)
    write.resolve({ theme: 'dark', locale: 'en' }); await flushed
    expect(done).toBe(true); expect(mocks.set).toHaveBeenCalledTimes(1)
  })
  it('serializes a later write and diffs it against the actual persisted predecessor', async () => {
    const first = deferred<any>(); mocks.set.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ theme: 'dark', locale: 'zh' })
    api.scheduleSave({ theme: 'dark', locale: 'en' }); await vi.advanceTimersByTimeAsync(450)
    api.scheduleSave({ theme: 'dark', locale: 'zh' }); await vi.advanceTimersByTimeAsync(450)
    expect(mocks.set).toHaveBeenCalledTimes(1)
    first.resolve({ theme: 'dark', locale: 'en' }); await api.flushPendingSave()
    expect(mocks.set.mock.calls).toEqual([[{ theme: 'dark' }], [{ locale: 'zh' }]])
    expect(scope.setForm).toHaveBeenCalledTimes(1)
  })
  it('retains a failed draft and actually retries it', async () => {
    mocks.set.mockRejectedValueOnce(new Error('save failed')).mockResolvedValueOnce({ theme: 'dark', locale: 'en' })
    api.scheduleSave({ theme: 'dark', locale: 'en' })
    expect(await api.flushPendingSave()).toBe(false)
    expect(scope.pendingSnapshotRef.current).toEqual({ theme: 'dark', locale: 'en' })
    expect(await api.flushPendingSave()).toBe(true)
    expect(mocks.set).toHaveBeenCalledTimes(2)
  })
  it('orders the unmount flush after an older in-flight save', async () => {
    const first = deferred<any>(); mocks.set.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ theme: 'dark', locale: 'zh' })
    api.scheduleSave({ theme: 'dark', locale: 'en' }); await vi.advanceTimersByTimeAsync(450)
    api.scheduleSave({ theme: 'dark', locale: 'zh' })
    clearTimeout(scope.saveTimer.current)
    scope.flushOnUnmountRef.current()
    expect(mocks.set).toHaveBeenCalledTimes(1)
    first.resolve({ theme: 'dark', locale: 'en' })
    await api.flushPendingSave(); await Promise.resolve()
    expect(mocks.set.mock.calls).toEqual([[{ theme: 'dark' }], [{ locale: 'zh' }]])
  })
  it.each(['idle', 'failed', 'unavailable'])('explicit enablement reconciles %s without writing a stale form', async (state) => {
    mocks.sync.mockResolvedValue({ state }); mocks.set.mockResolvedValue({ theme: 'dark' })
    expect(await api.flushPendingSave(true)).toBe(true)
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith({})
  })
})
