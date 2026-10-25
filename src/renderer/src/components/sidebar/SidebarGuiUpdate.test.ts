import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuiUpdateInfo, GuiUpdateState } from '@shared/gui-update'
import i18n from '../../i18n'
import { SidebarGuiUpdate } from './SidebarGuiUpdate'

const info: Extract<GuiUpdateInfo, { ok: true }> = {
  ok: true, currentVersion: '0.3.8', latestVersion: '0.3.9', hasUpdate: true,
  releaseUrl: 'https://example.test/releases/0.3.9', channel: 'stable'
}
let renderer: ReactTestRenderer
let emit: (state: GuiUpdateState) => void
let download: ReturnType<typeof vi.fn>
let install: ReturnType<typeof vi.fn>

async function mount(initial: GuiUpdateState = { status: 'available', info }): Promise<void> {
  vi.stubGlobal('window', { kunGui: {
    getGuiUpdateState: vi.fn(async () => initial),
    onGuiUpdateState: (listener: typeof emit) => { emit = listener; return vi.fn() },
    downloadGuiUpdate: download,
    installGuiUpdate: install,
    logError: vi.fn(async () => undefined),
    openExternal: vi.fn(async () => undefined)
  } })
  await act(async () => { renderer = create(createElement(SidebarGuiUpdate)) })
}

function chip(): ReactTestInstance {
  return renderer.root.find((node) => node.type === 'button' && node.props.className === 'ds-sidebar-update-chip')
}

function cards(): ReactTestInstance[] {
  return renderer.root.findAll((node) => node.type === 'div' && node.props.role === 'dialog')
}

async function openCard(): Promise<void> {
  if (cards().length === 0) await act(async () => { chip().props.onClick() })
}

function primary(): ReactTestInstance {
  return renderer.root.find((node) => node.type === 'button' && node.props['data-primary'] === 'true')
}

function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textOf(child)).join('')
}

function errorText(): string {
  return textOf(renderer.root.findByProps({ role: 'alert' }))
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  await i18n.changeLanguage('en')
  download = vi.fn(async () => ({ ok: true, paths: ['/tmp/Kun.zip'] }))
  install = vi.fn(async () => ({ ok: true }))
})

afterEach(() => {
  act(() => renderer?.unmount())
  vi.unstubAllGlobals()
})

describe('sidebar GUI update entry', () => {
  it('stays hidden without a pending update', async () => {
    await mount({ status: 'not_available', info: { ...info, hasUpdate: false } })
    expect(renderer.toJSON()).toBeNull()
  })

  it('opens a card instead of updating on the first click', async () => {
    await mount()
    expect(chip().props['data-phase']).toBe('available')
    expect(textOf(chip())).toContain('Update')
    await openCard()
    expect(chip().props['aria-expanded']).toBe(true)
    expect(textOf(cards()[0])).toContain('Kun 0.3.9 is available')
    expect(textOf(cards()[0])).toContain('Current 0.3.8')
    expect(download).not.toHaveBeenCalled()
    await act(async () => { chip().props.onClick() })
    expect(cards()).toHaveLength(0)
  })

  it('keeps a known update visible during a recheck and reports check failures', async () => {
    await mount()
    await openCard()
    await act(async () => { emit({ status: 'checking', info }) })
    expect(primary().props.disabled).toBe(true)
    await act(async () => {
      emit({ status: 'error', info: {
        ok: false, currentVersion: '0.3.8', channel: 'stable', message: 'feed unavailable'
      }, message: 'feed unavailable' })
    })
    expect(chip().props['data-phase']).toBe('error')
    expect(primary().props.disabled).toBe(false)
    expect(errorText()).toContain('feed unavailable')
    await act(async () => { emit({ status: 'idle' }) })
    expect(renderer.toJSON()).toBeNull()
  })

  it('stays busy through download and install without duplicate requests', async () => {
    let finishDownload!: (result: unknown) => void
    let finishInstall!: (result: unknown) => void
    download.mockImplementation(() => new Promise((resolve) => { finishDownload = resolve }))
    install.mockImplementation(() => new Promise((resolve) => { finishInstall = resolve }))
    await mount()
    await openCard()
    await act(async () => { primary().props.onClick() })
    expect(chip().props['data-phase']).toBe('downloading')
    await act(async () => {
      emit({ status: 'downloading', info, progress: {
        total: 100, delta: 42, transferred: 42, percent: 42, bytesPerSecond: 10
      } })
    })
    expect(textOf(chip())).toContain('42%')
    expect(renderer.root.findByProps({ role: 'progressbar' }).props['aria-valuenow']).toBe(42)
    expect(download).toHaveBeenCalledExactlyOnceWith('stable')
    expect(install).not.toHaveBeenCalled()
    await act(async () => {
      emit({ status: 'downloaded', info: { ...info, downloaded: true } })
      finishDownload({ ok: true, paths: ['/tmp/Kun.zip'] })
    })
    expect(install).toHaveBeenCalledOnce()
    expect(chip().props['data-phase']).toBe('installing')
    await act(async () => {
      emit({ status: 'installing', info })
      finishInstall({ ok: true })
    })
    expect(chip().props['data-phase']).toBe('installing')
    expect(download).toHaveBeenCalledOnce()
  })

  it.each(['result', 'exception'])('shows a download %s failure and allows retry', async (failure) => {
    if (failure === 'result') {
      download.mockResolvedValueOnce({ ok: false, message: 'connection reset', code: 'download_failed' })
    } else {
      download.mockRejectedValueOnce(new Error('connection reset'))
    }
    await mount()
    await openCard()
    await act(async () => { primary().props.onClick() })
    expect(install).not.toHaveBeenCalled()
    expect(chip().props['data-phase']).toBe('error')
    expect(chip().props['aria-label']).toContain('connection reset')
    expect(errorText()).toContain('connection reset')
    expect(textOf(primary())).toBe('Retry')
    await act(async () => { primary().props.onClick() })
    expect(download).toHaveBeenCalledTimes(2)
    expect(install).toHaveBeenCalledOnce()
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })

  it('clears a failure when the card is closed', async () => {
    download.mockResolvedValueOnce({ ok: false, message: 'connection reset', code: 'download_failed' })
    await mount()
    await openCard()
    await act(async () => { primary().props.onClick() })
    expect(chip().props['data-phase']).toBe('error')
    await act(async () => { renderer.root.findByProps({ 'aria-label': 'Close' }).props.onClick() })
    expect(cards()).toHaveLength(0)
    expect(chip().props['data-phase']).toBe('available')
  })

  it('reports install failures and retries a downloaded update without downloading again', async () => {
    install.mockResolvedValueOnce({ ok: false, message: 'installation deferred' })
    await mount({ status: 'downloaded', info: { ...info, downloaded: true } })
    expect(chip().props['data-phase']).toBe('downloaded')
    await openCard()
    expect(textOf(primary())).toBe('Restart now')
    await act(async () => { primary().props.onClick() })
    expect(errorText()).toContain('installation deferred')
    expect(primary().props.disabled).toBe(false)
    await act(async () => { primary().props.onClick() })
    expect(download).not.toHaveBeenCalled()
    expect(install).toHaveBeenCalledTimes(2)
  })

  it('opens manual updates without downloading or installing', async () => {
    await mount({ status: 'available', info: { ...info, manualOnly: true } })
    expect(chip().props['data-phase']).toBe('manual')
    await openCard()
    await act(async () => { primary().props.onClick() })
    expect(window.kunGui.openExternal).toHaveBeenCalledWith(info.releaseUrl)
    expect(download).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
  })

  it('opens the release notes from the card', async () => {
    await mount()
    await openCard()
    const notes = renderer.root.find((node) =>
      node.type === 'button' && node.props.className === 'ds-sidebar-update-button' && textOf(node).includes('Release notes'))
    await act(async () => { notes.props.onClick() })
    expect(window.kunGui.openExternal).toHaveBeenCalledWith(info.releaseUrl)
  })
})
