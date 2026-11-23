import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DesktopShareIndicator } from './indicator'

const state = vi.hoisted(() => {
  type MenuEntry = { label?: string; enabled?: boolean; click?: () => void }
  const trays: FakeTray[] = []
  class FakeTray {
    readonly setToolTip = vi.fn()
    readonly destroy = vi.fn()
    readonly on = vi.fn()
    readonly popUpContextMenu = vi.fn()
    readonly setContextMenu = vi.fn((entries: MenuEntry[]) => { this.entries = entries })
    entries: MenuEntry[] = []

    constructor() { trays.push(this) }
  }

  return { FakeTray, trays, getLocale: vi.fn(), buildFromTemplate: vi.fn((entries: MenuEntry[]) => entries) }
})

vi.mock('electron', () => ({
  app: { getLocale: state.getLocale },
  Menu: { buildFromTemplate: state.buildFromTemplate },
  Tray: state.FakeTray
}))

vi.mock('../app-icon', () => ({
  createMultiScaleIcon: vi.fn(() => ({})),
  prepareTrayIcon: vi.fn(icon => icon)
}))

const display = { peer: '23086712678', display: '内建视网膜显示器' }

describe('DesktopShareIndicator', () => {
  beforeEach(() => {
    state.trays.length = 0
    state.getLocale.mockReturnValue('zh-CN')
  })

  it('puts the active display, mode and stop action in one native tray menu', () => {
    const indicator = new DesktopShareIndicator()
    const end = vi.fn()
    indicator.show({ ...display, mode: 'view' }, end)

    const [tray] = state.trays
    expect(tray.setToolTip).toHaveBeenCalledWith('Kun · 远程桌面')
    expect(tray.entries[0]).toEqual({ label: '正在查看 · 内建视网膜显示器 · 23086712', enabled: false })

    indicator.update({ ...display, mode: 'control' })
    expect(state.trays).toEqual([tray])
    expect(tray.entries[0].label).toBe('正在控制 · 内建视网膜显示器 · 23086712')
    tray.entries.find(entry => entry.label === '结束远控')?.click?.()
    expect(end).toHaveBeenCalledOnce()
  })

  it('clears the tray on disconnect and ignores actions from the previous session', () => {
    state.getLocale.mockReturnValue('en-US')
    const indicator = new DesktopShareIndicator()
    const endPrevious = vi.fn()
    indicator.show({ ...display, mode: 'control' }, endPrevious)
    const [previous] = state.trays
    const stopPrevious = previous.entries.find(entry => entry.label === 'End remote session')!.click!

    const endCurrent = vi.fn()
    indicator.show({ ...display, mode: 'view' }, endCurrent)
    expect(previous.destroy).toHaveBeenCalledOnce()
    stopPrevious()
    expect(endPrevious).not.toHaveBeenCalled()
    expect(endCurrent).not.toHaveBeenCalled()

    const current = state.trays[1]
    indicator.hide()
    indicator.hide()
    indicator.update({ ...display, mode: 'control' })
    expect(current.destroy).toHaveBeenCalledOnce()
    expect(current.setContextMenu).toHaveBeenCalledOnce()
  })
})
