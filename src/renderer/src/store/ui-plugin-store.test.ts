import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UiPluginHostEffect } from '@shared/ui-plugin'
import {
  UI_MODE_DEFAULT,
  UI_MODE_RETROMA,
  UI_MODE_STORAGE_KEY
} from '../lib/ui-mode'
import { useUiPluginStore } from './ui-plugin-store'

const hostEffect: UiPluginHostEffect = {
  kind: 'shuimo-yijing',
  hexagram: {
    ordinal: 10,
    glyph: '䷉',
    name: '履',
    statement: '履虎尾不咥人亨',
    statementCommentary: '本义',
    movingLine: 4,
    movingLineLabel: '九四',
    movingLineText: '履虎尾愔愔終吉',
    movingLineCommentary: '本义爻注'
  }
}

function success(id: string, effect?: UiPluginHostEffect) {
  return {
    ok: true as const,
    manifest: { id, name: id, version: '1.0.0', figures: {} },
    figures: {},
    ...(effect ? { hostEffect: effect } : {})
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function installBrowserFakes() {
  const storage = new Map<string, string>()
  const attributes = new Map<string, string>()
  const localStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => storage.set(key, value))
  }
  const documentElement = {
    setAttribute: vi.fn((key: string, value: string) => attributes.set(key, value)),
    removeAttribute: vi.fn((key: string) => attributes.delete(key))
  }
  vi.stubGlobal('document', {
    documentElement,
    getElementById: vi.fn(() => null)
  })
  return { attributes, localStorage, storage }
}

describe('ui-plugin-store host effect lifecycle', () => {
  beforeEach(() => {
    useUiPluginStore.setState({
      uiMode: UI_MODE_DEFAULT,
      installed: [],
      activeRuntime: null,
      busy: false,
      initialized: false,
      lastError: null
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retains the trusted effect only in the matching successful plugin runtime', async () => {
    const loadUiPlugin = vi.fn()
      .mockResolvedValueOnce(success('shuimo-yijing', hostEffect))
      .mockResolvedValueOnce(success('starlight'))
    vi.stubGlobal('window', { kunGui: { loadUiPlugin } })

    await useUiPluginStore.getState().activateUiMode('shuimo-yijing')
    expect(useUiPluginStore.getState().activeRuntime?.hostEffect).toBe(hostEffect)

    await useUiPluginStore.getState().activateUiMode('starlight')
    expect(useUiPluginStore.getState().activeRuntime).toEqual({
      manifest: { id: 'starlight', name: 'starlight', version: '1.0.0', figures: {} },
      figures: {}
    })
  })

  it('drops a malformed host effect at the renderer IPC boundary', async () => {
    const loadUiPlugin = vi.fn().mockResolvedValue({
      ...success('shuimo-yijing'),
      hostEffect: { kind: 'shuimo-yijing' }
    })
    vi.stubGlobal('window', { kunGui: { loadUiPlugin } })

    await useUiPluginStore.getState().activateUiMode('shuimo-yijing')

    expect(useUiPluginStore.getState().activeRuntime?.hostEffect).toBeUndefined()
  })

  it.each([UI_MODE_DEFAULT, UI_MODE_RETROMA])('clears the effect when switching to %s', async (mode) => {
    const loadUiPlugin = vi.fn().mockResolvedValue(success('shuimo-yijing', hostEffect))
    vi.stubGlobal('window', { kunGui: { loadUiPlugin } })
    await useUiPluginStore.getState().activateUiMode('shuimo-yijing')

    await useUiPluginStore.getState().activateUiMode(mode)

    expect(useUiPluginStore.getState().activeRuntime).toBeNull()
  })

  it('clears the effect when a later plugin load fails or throws', async () => {
    const loadUiPlugin = vi.fn()
      .mockResolvedValueOnce(success('shuimo-yijing', hostEffect))
      .mockResolvedValueOnce({ ok: false, error: 'missing' })
      .mockResolvedValueOnce(success('shuimo-yijing', hostEffect))
      .mockRejectedValueOnce(new Error('load crashed'))
    vi.stubGlobal('window', { kunGui: { loadUiPlugin } })

    await useUiPluginStore.getState().activateUiMode('shuimo-yijing')
    await useUiPluginStore.getState().activateUiMode('missing-plugin')
    expect(useUiPluginStore.getState().activeRuntime).toBeNull()

    await useUiPluginStore.getState().activateUiMode('shuimo-yijing')
    await useUiPluginStore.getState().activateUiMode('broken-plugin')
    expect(useUiPluginStore.getState().activeRuntime).toBeNull()
  })

  it('clears the effect before removing the active plugin', async () => {
    const removeUiPlugin = vi.fn().mockResolvedValue({ ok: true })
    const listUiPlugins = vi.fn().mockResolvedValue({ plugins: [] })
    const loadUiPlugin = vi.fn().mockResolvedValue(success('shuimo-yijing', hostEffect))
    vi.stubGlobal('window', { kunGui: { loadUiPlugin, removeUiPlugin, listUiPlugins } })
    await useUiPluginStore.getState().activateUiMode('shuimo-yijing')

    await useUiPluginStore.getState().removeUiPluginById('shuimo-yijing')

    expect(useUiPluginStore.getState().activeRuntime).toBeNull()
    expect(removeUiPlugin).toHaveBeenCalledWith('shuimo-yijing')
  })

  it.each([UI_MODE_DEFAULT, UI_MODE_RETROMA])(
    'ignores a plugin load that resolves after switching to %s',
    async (mode) => {
      const pending = deferred<ReturnType<typeof success>>()
      const loadUiPlugin = vi.fn(() => pending.promise)
      const { attributes, localStorage, storage } = installBrowserFakes()
      vi.stubGlobal('window', { kunGui: { loadUiPlugin }, localStorage })

      const staleActivation = useUiPluginStore.getState().activateUiMode('shuimo-yijing')
      await useUiPluginStore.getState().activateUiMode(mode)
      pending.resolve(success('shuimo-yijing', hostEffect))
      await staleActivation

      expect(useUiPluginStore.getState()).toMatchObject({
        uiMode: mode,
        activeRuntime: null,
        busy: false,
        lastError: null
      })
      expect(storage.get(UI_MODE_STORAGE_KEY)).toBe(mode)
      expect(attributes.get('data-ui-plugin')).toBeUndefined()
      expect(attributes.get('data-retroma-mode')).toBe(mode === UI_MODE_RETROMA ? 'on' : 'off')
    }
  )

  it('ignores the first of two plugin loads when it resolves last', async () => {
    const first = deferred<ReturnType<typeof success>>()
    const second = deferred<ReturnType<typeof success>>()
    const loadUiPlugin = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { attributes, localStorage, storage } = installBrowserFakes()
    vi.stubGlobal('window', { kunGui: { loadUiPlugin }, localStorage })

    const staleActivation = useUiPluginStore.getState().activateUiMode('shuimo-yijing')
    const currentActivation = useUiPluginStore.getState().activateUiMode('starlight')
    second.resolve(success('starlight'))
    await currentActivation
    first.resolve(success('shuimo-yijing', hostEffect))
    await staleActivation

    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: 'starlight',
      activeRuntime: { manifest: { id: 'starlight' }, figures: {} },
      busy: false,
      lastError: null
    })
    expect(useUiPluginStore.getState().activeRuntime?.hostEffect).toBeUndefined()
    expect(storage.get(UI_MODE_STORAGE_KEY)).toBe('starlight')
    expect(attributes.get('data-ui-plugin')).toBe('starlight')
  })

  it('ignores a stale rejection after a newer plugin activation succeeds', async () => {
    const first = deferred<ReturnType<typeof success>>()
    const loadUiPlugin = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(success('starlight'))
    const { attributes, localStorage, storage } = installBrowserFakes()
    vi.stubGlobal('window', { kunGui: { loadUiPlugin }, localStorage })

    const staleActivation = useUiPluginStore.getState().activateUiMode('shuimo-yijing')
    await useUiPluginStore.getState().activateUiMode('starlight')
    first.reject(new Error('stale load crashed'))
    await staleActivation

    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: 'starlight',
      activeRuntime: { manifest: { id: 'starlight' }, figures: {} },
      busy: false,
      lastError: null
    })
    expect(storage.get(UI_MODE_STORAGE_KEY)).toBe('starlight')
    expect(attributes.get('data-ui-plugin')).toBe('starlight')
  })

  it('does not restore a pending plugin after that plugin is removed', async () => {
    const pending = deferred<ReturnType<typeof success>>()
    const loadUiPlugin = vi.fn(() => pending.promise)
    const removeUiPlugin = vi.fn().mockResolvedValue({ ok: true })
    const listUiPlugins = vi.fn().mockResolvedValue({ plugins: [] })
    const { attributes, localStorage, storage } = installBrowserFakes()
    storage.set(UI_MODE_STORAGE_KEY, UI_MODE_DEFAULT)
    vi.stubGlobal('window', {
      kunGui: { loadUiPlugin, removeUiPlugin, listUiPlugins },
      localStorage
    })

    const staleActivation = useUiPluginStore.getState().activateUiMode('shuimo-yijing')
    await useUiPluginStore.getState().removeUiPluginById('shuimo-yijing')
    pending.resolve(success('shuimo-yijing', hostEffect))
    await staleActivation

    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: UI_MODE_DEFAULT,
      activeRuntime: null,
      busy: false,
      lastError: null
    })
    expect(storage.get(UI_MODE_STORAGE_KEY)).toBe(UI_MODE_DEFAULT)
    expect(attributes.get('data-ui-plugin')).toBeUndefined()
    expect(removeUiPlugin).toHaveBeenCalledWith('shuimo-yijing')
  })

  it('keeps an unrelated pending activation when the previous active plugin is removed', async () => {
    const pending = deferred<ReturnType<typeof success>>()
    const loadUiPlugin = vi.fn()
      .mockResolvedValueOnce(success('starlight'))
      .mockReturnValueOnce(pending.promise)
    const removeUiPlugin = vi.fn().mockResolvedValue({ ok: true })
    const listUiPlugins = vi.fn().mockResolvedValue({ plugins: [] })
    const { attributes, localStorage, storage } = installBrowserFakes()
    vi.stubGlobal('window', {
      kunGui: { loadUiPlugin, removeUiPlugin, listUiPlugins },
      localStorage
    })
    await useUiPluginStore.getState().activateUiMode('starlight')

    const currentActivation = useUiPluginStore.getState().activateUiMode('shuimo-yijing')
    await useUiPluginStore.getState().removeUiPluginById('starlight')
    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: UI_MODE_DEFAULT,
      activeRuntime: null,
      busy: true
    })
    pending.resolve(success('shuimo-yijing', hostEffect))
    await currentActivation

    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: 'shuimo-yijing',
      activeRuntime: { manifest: { id: 'shuimo-yijing' }, hostEffect },
      busy: false,
      lastError: null
    })
    expect(storage.get(UI_MODE_STORAGE_KEY)).toBe('shuimo-yijing')
    expect(attributes.get('data-ui-plugin')).toBe('shuimo-yijing')
    expect(removeUiPlugin).toHaveBeenCalledWith('starlight')
  })

  it('clears a matching activation that succeeds while removal is in flight', async () => {
    const removal = deferred<{ ok: boolean }>()
    const loadUiPlugin = vi.fn().mockResolvedValue(success('shuimo-yijing', hostEffect))
    const removeUiPlugin = vi.fn(() => removal.promise)
    const listUiPlugins = vi.fn().mockResolvedValue({ plugins: [] })
    const { attributes, localStorage, storage } = installBrowserFakes()
    storage.set(UI_MODE_STORAGE_KEY, UI_MODE_DEFAULT)
    vi.stubGlobal('window', {
      kunGui: { loadUiPlugin, removeUiPlugin, listUiPlugins },
      localStorage
    })

    const removeTask = useUiPluginStore.getState().removeUiPluginById('shuimo-yijing')
    await useUiPluginStore.getState().activateUiMode('shuimo-yijing')
    removal.resolve({ ok: true })
    await removeTask

    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: UI_MODE_DEFAULT,
      activeRuntime: null,
      busy: false,
      lastError: null
    })
    expect(storage.get(UI_MODE_STORAGE_KEY)).toBe(UI_MODE_DEFAULT)
    expect(attributes.get('data-ui-plugin')).toBeUndefined()
  })

  it('cancels a matching pending activation when removal completes', async () => {
    const removal = deferred<{ ok: boolean }>()
    const activation = deferred<ReturnType<typeof success>>()
    const loadUiPlugin = vi.fn(() => activation.promise)
    const removeUiPlugin = vi.fn(() => removal.promise)
    const listUiPlugins = vi.fn().mockResolvedValue({ plugins: [] })
    const { attributes, localStorage, storage } = installBrowserFakes()
    storage.set(UI_MODE_STORAGE_KEY, UI_MODE_DEFAULT)
    vi.stubGlobal('window', {
      kunGui: { loadUiPlugin, removeUiPlugin, listUiPlugins },
      localStorage
    })

    const removeTask = useUiPluginStore.getState().removeUiPluginById('shuimo-yijing')
    const staleActivation = useUiPluginStore.getState().activateUiMode('shuimo-yijing')
    removal.resolve({ ok: true })
    await removeTask
    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: UI_MODE_DEFAULT,
      activeRuntime: null,
      busy: false
    })
    activation.resolve(success('shuimo-yijing', hostEffect))
    await staleActivation

    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: UI_MODE_DEFAULT,
      activeRuntime: null,
      busy: false,
      lastError: null
    })
    expect(storage.get(UI_MODE_STORAGE_KEY)).toBe(UI_MODE_DEFAULT)
    expect(attributes.get('data-ui-plugin')).toBeUndefined()
  })

  it('does not clear an unrelated activation that succeeds while removal is in flight', async () => {
    const removal = deferred<{ ok: boolean }>()
    const loadUiPlugin = vi.fn().mockResolvedValue(success('starlight'))
    const removeUiPlugin = vi.fn(() => removal.promise)
    const listUiPlugins = vi.fn().mockResolvedValue({ plugins: [] })
    const { attributes, localStorage, storage } = installBrowserFakes()
    vi.stubGlobal('window', {
      kunGui: { loadUiPlugin, removeUiPlugin, listUiPlugins },
      localStorage
    })

    const removeTask = useUiPluginStore.getState().removeUiPluginById('shuimo-yijing')
    await useUiPluginStore.getState().activateUiMode('starlight')
    removal.resolve({ ok: true })
    await removeTask

    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: 'starlight',
      activeRuntime: { manifest: { id: 'starlight' } },
      busy: false,
      lastError: null
    })
    expect(storage.get(UI_MODE_STORAGE_KEY)).toBe('starlight')
    expect(attributes.get('data-ui-plugin')).toBe('starlight')
  })

  it('does not cancel an unrelated pending activation when removal completes', async () => {
    const removal = deferred<{ ok: boolean }>()
    const activation = deferred<ReturnType<typeof success>>()
    const loadUiPlugin = vi.fn(() => activation.promise)
    const removeUiPlugin = vi.fn(() => removal.promise)
    const listUiPlugins = vi.fn().mockResolvedValue({ plugins: [] })
    const { attributes, localStorage, storage } = installBrowserFakes()
    vi.stubGlobal('window', {
      kunGui: { loadUiPlugin, removeUiPlugin, listUiPlugins },
      localStorage
    })

    const removeTask = useUiPluginStore.getState().removeUiPluginById('shuimo-yijing')
    const activateTask = useUiPluginStore.getState().activateUiMode('starlight')
    removal.resolve({ ok: true })
    await removeTask
    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: UI_MODE_DEFAULT,
      activeRuntime: null,
      busy: true
    })
    activation.resolve(success('starlight'))
    await activateTask

    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: 'starlight',
      activeRuntime: { manifest: { id: 'starlight' } },
      busy: false
    })
    expect(storage.get(UI_MODE_STORAGE_KEY)).toBe('starlight')
    expect(attributes.get('data-ui-plugin')).toBe('starlight')
  })

  it('keeps a matching activation when removal reports failure', async () => {
    const removal = deferred<{ ok: boolean }>()
    const loadUiPlugin = vi.fn().mockResolvedValue(success('shuimo-yijing', hostEffect))
    const removeUiPlugin = vi.fn(() => removal.promise)
    const listUiPlugins = vi.fn().mockResolvedValue({ plugins: [] })
    const { attributes, localStorage, storage } = installBrowserFakes()
    vi.stubGlobal('window', {
      kunGui: { loadUiPlugin, removeUiPlugin, listUiPlugins },
      localStorage
    })

    const removeTask = useUiPluginStore.getState().removeUiPluginById('shuimo-yijing')
    await useUiPluginStore.getState().activateUiMode('shuimo-yijing')
    removal.resolve({ ok: false })
    await removeTask

    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: 'shuimo-yijing',
      activeRuntime: { manifest: { id: 'shuimo-yijing' }, hostEffect },
      busy: false
    })
    expect(storage.get(UI_MODE_STORAGE_KEY)).toBe('shuimo-yijing')
    expect(attributes.get('data-ui-plugin')).toBe('shuimo-yijing')
  })

  it('preserves a pre-existing active plugin when removal reports failure', async () => {
    const loadUiPlugin = vi.fn().mockResolvedValue(success('shuimo-yijing', hostEffect))
    const removeUiPlugin = vi.fn().mockResolvedValue({ ok: false })
    const listUiPlugins = vi.fn().mockResolvedValue({ plugins: [] })
    const { attributes, localStorage, storage } = installBrowserFakes()
    vi.stubGlobal('window', {
      kunGui: { loadUiPlugin, removeUiPlugin, listUiPlugins },
      localStorage
    })
    await useUiPluginStore.getState().activateUiMode('shuimo-yijing')

    await useUiPluginStore.getState().removeUiPluginById('shuimo-yijing')

    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: 'shuimo-yijing',
      activeRuntime: { manifest: { id: 'shuimo-yijing' }, hostEffect },
      busy: false,
      lastError: null
    })
    expect(storage.get(UI_MODE_STORAGE_KEY)).toBe('shuimo-yijing')
    expect(attributes.get('data-ui-plugin')).toBe('shuimo-yijing')
  })

  it('preserves a pre-existing pending activation when removal reports failure', async () => {
    const activation = deferred<ReturnType<typeof success>>()
    const loadUiPlugin = vi.fn(() => activation.promise)
    const removeUiPlugin = vi.fn().mockResolvedValue({ ok: false })
    const listUiPlugins = vi.fn().mockResolvedValue({ plugins: [] })
    const { attributes, localStorage, storage } = installBrowserFakes()
    vi.stubGlobal('window', {
      kunGui: { loadUiPlugin, removeUiPlugin, listUiPlugins },
      localStorage
    })

    const activateTask = useUiPluginStore.getState().activateUiMode('shuimo-yijing')
    await useUiPluginStore.getState().removeUiPluginById('shuimo-yijing')
    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: UI_MODE_DEFAULT,
      activeRuntime: null,
      busy: true
    })
    activation.resolve(success('shuimo-yijing', hostEffect))
    await activateTask

    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: 'shuimo-yijing',
      activeRuntime: { manifest: { id: 'shuimo-yijing' }, hostEffect },
      busy: false,
      lastError: null
    })
    expect(storage.get(UI_MODE_STORAGE_KEY)).toBe('shuimo-yijing')
    expect(attributes.get('data-ui-plugin')).toBe('shuimo-yijing')
  })

  it('preserves the active plugin and reports a thrown removal error', async () => {
    const loadUiPlugin = vi.fn().mockResolvedValue(success('shuimo-yijing', hostEffect))
    const removeUiPlugin = vi.fn().mockRejectedValue(new Error('remove crashed'))
    const listUiPlugins = vi.fn().mockResolvedValue({ plugins: [] })
    const { attributes, localStorage, storage } = installBrowserFakes()
    vi.stubGlobal('window', {
      kunGui: { loadUiPlugin, removeUiPlugin, listUiPlugins },
      localStorage
    })
    await useUiPluginStore.getState().activateUiMode('shuimo-yijing')

    await expect(
      useUiPluginStore.getState().removeUiPluginById('shuimo-yijing')
    ).rejects.toThrow('remove crashed')

    expect(useUiPluginStore.getState()).toMatchObject({
      uiMode: 'shuimo-yijing',
      activeRuntime: { manifest: { id: 'shuimo-yijing' }, hostEffect },
      busy: false,
      lastError: null
    })
    expect(storage.get(UI_MODE_STORAGE_KEY)).toBe('shuimo-yijing')
    expect(attributes.get('data-ui-plugin')).toBe('shuimo-yijing')
  })
})
