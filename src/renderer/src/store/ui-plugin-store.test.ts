import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UiPluginHostEffect } from '@shared/ui-plugin'
import { UI_MODE_DEFAULT, UI_MODE_RETROMA } from '../lib/ui-mode'
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
})
