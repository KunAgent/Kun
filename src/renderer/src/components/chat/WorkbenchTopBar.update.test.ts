import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GuiUpdateInfo, GuiUpdateState } from '@shared/gui-update'
import i18n from '../../i18n'
import { WorkbenchTopActions } from './WorkbenchTopBar'

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
  await act(async () => { renderer = create(createElement(WorkbenchTopActions)) })
}

function updateButton() {
  return renderer.root.find((node) =>
    node.type === 'button' && node.props.className.includes('border-amber-300/75'))
}

function errorText() {
  return renderer.root.findByProps({ role: 'alert' }).findAllByType('span')
    .flatMap((node) => node.children.filter((child) => typeof child === 'string')).join('')
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

describe('workbench GUI update action', () => {
  it('keeps a known update visible during a recheck and reports check failures', async () => {
    await mount()
    await act(async () => { emit({ status: 'checking', info }) })
    expect(updateButton().props.disabled).toBe(true)
    expect(updateButton().props['aria-label']).toBe('Checking for GUI updates…')
    await act(async () => {
      emit({ status: 'error', info: {
        ok: false, currentVersion: '0.3.8', channel: 'stable', message: 'feed unavailable'
      }, message: 'feed unavailable' })
    })
    expect(updateButton().props.disabled).toBe(false)
    expect(errorText()).toContain('feed unavailable')
    await act(async () => { emit({ status: 'idle' }) })
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    expect(() => updateButton()).toThrow()
  })

  it('keeps the button busy through download and install without duplicate requests', async () => {
    let finishDownload!: (result: unknown) => void
    let finishInstall!: (result: unknown) => void
    download.mockImplementation(() => new Promise((resolve) => { finishDownload = resolve }))
    install.mockImplementation(() => new Promise((resolve) => { finishInstall = resolve }))
    await mount()
    await act(async () => { updateButton().props.onClick() })
    expect(updateButton().props.disabled).toBe(true)
    await act(async () => {
      emit({ status: 'downloading', info, progress: {
        total: 100, delta: 42, transferred: 42, percent: 42, bytesPerSecond: 10
      } })
      updateButton().props.onClick()
    })
    expect(updateButton().props['aria-label']).toBe('Updating 42%')
    expect(download).toHaveBeenCalledExactlyOnceWith('stable')
    expect(install).not.toHaveBeenCalled()
    await act(async () => {
      emit({ status: 'downloaded', info: { ...info, downloaded: true } })
      finishDownload({ ok: true, paths: ['/tmp/Kun.zip'] })
    })
    expect(install).toHaveBeenCalledOnce()
    expect(updateButton().props.disabled).toBe(true)
    await act(async () => {
      emit({ status: 'installing', info })
      finishInstall({ ok: true })
    })
    expect(updateButton().props['aria-label']).toBe('Installing…')
    expect(updateButton().props.disabled).toBe(true)
  })

  it.each(['result', 'exception'])('shows a download %s failure and allows retry', async (failure) => {
    if (failure === 'result') {
      download.mockResolvedValueOnce({ ok: false, message: 'connection reset', code: 'download_failed' })
    } else {
      download.mockRejectedValueOnce(new Error('connection reset'))
    }
    await mount()
    await act(async () => { updateButton().props.onClick() })
    expect(install).not.toHaveBeenCalled()
    expect(updateButton().props.disabled).toBe(false)
    expect(updateButton().props['data-tooltip']).toContain('connection reset')
    expect(errorText()).toContain('connection reset')
    expect(updateButton().props.className).not.toContain('ds-topbar-action-button')
    await act(async () => { renderer.root.findByProps({ 'aria-label': 'Close' }).props.onClick() })
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
    expect(updateButton().props.className).toContain('ds-topbar-action-button')
    await act(async () => { updateButton().props.onClick() })
    expect(download).toHaveBeenCalledTimes(2)
    expect(install).toHaveBeenCalledOnce()
    expect(renderer.root.findAllByProps({ role: 'alert' })).toHaveLength(0)
  })

  it('reports install failures and retries a downloaded update without downloading again', async () => {
    install.mockResolvedValueOnce({ ok: false, message: 'installation deferred' })
    await mount({ status: 'downloaded', info: { ...info, downloaded: true } })
    await act(async () => { updateButton().props.onClick() })
    expect(errorText()).toContain('installation deferred')
    expect(updateButton().props.disabled).toBe(false)
    await act(async () => { updateButton().props.onClick() })
    expect(download).not.toHaveBeenCalled()
    expect(install).toHaveBeenCalledTimes(2)
  })

  it('opens manual updates without downloading or installing', async () => {
    await mount({ status: 'available', info: { ...info, manualOnly: true } })
    await act(async () => { updateButton().props.onClick() })
    expect(window.kunGui.openExternal).toHaveBeenCalledWith(info.releaseUrl)
    expect(download).not.toHaveBeenCalled()
    expect(install).not.toHaveBeenCalled()
  })
})
