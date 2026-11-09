import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  trusted: vi.fn(),
  mediaStatus: vi.fn(),
  sources: vi.fn(),
  open: vi.fn(),
  nativeStatus: vi.fn(),
  nativeScreenRequest: vi.fn()
}))
vi.mock('electron', () => ({
  systemPreferences: { isTrustedAccessibilityClient: mocks.trusted, getMediaAccessStatus: mocks.mediaStatus },
  desktopCapturer: { getSources: mocks.sources },
  shell: { openExternal: mocks.open }
}))
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const pane = (name: string) => `x-apple.systempreferences:com.apple.preference.security?Privacy_${name}`

beforeEach(() => {
  vi.resetModules()
  Object.values(mocks).forEach(mock => mock.mockReset())
  Object.defineProperty(process, 'platform', { configurable: true, value: 'darwin' })
  mocks.trusted.mockReturnValue(false)
  mocks.mediaStatus.mockReturnValue('denied')
  mocks.nativeStatus.mockReturnValue('denied')
  mocks.sources.mockResolvedValue([])
  mocks.open.mockResolvedValue(undefined)
  vi.doMock('@computer-use/node-mac-permissions', () => ({ default: {
    getAuthStatus: mocks.nativeStatus,
    askForScreenCaptureAccess: mocks.nativeScreenRequest
  } }))
})
afterEach(() => { Object.defineProperty(process, 'platform', platform) })

describe('computer use system permissions', () => {
  it('explicitly prompts for Accessibility and opens its settings even with the native module installed', async () => {
    const { requestComputerUsePermission } = await import('./computer-use-permissions')
    const result = await requestComputerUsePermission('accessibility')
    expect(mocks.trusted).toHaveBeenCalledWith(true)
    expect(mocks.open).toHaveBeenCalledWith(pane('Accessibility'))
    expect(result.accessibility).toBe('denied')
  })

  it('still opens Accessibility settings if the system prompt fails', async () => {
    mocks.trusted.mockImplementation((prompt: boolean) => { if (prompt) throw Error('prompt failed'); return false })
    const { requestComputerUsePermission } = await import('./computer-use-permissions')
    await requestComputerUsePermission('accessibility')
    expect(mocks.open).toHaveBeenCalledWith(pane('Accessibility'))
  })

  it('registers screen capture and opens settings without assuming that opening them grants access', async () => {
    const { requestComputerUsePermission } = await import('./computer-use-permissions')
    const result = await requestComputerUsePermission('screenRecording')
    expect(mocks.nativeScreenRequest).toHaveBeenCalledOnce()
    expect(mocks.sources).not.toHaveBeenCalled()
    expect(mocks.open).toHaveBeenCalledWith(pane('ScreenCapture'))
    expect(result.screenRecording).toBe('denied')
  })

  it('falls back to Electron if the native screen request rejects', async () => {
    mocks.nativeScreenRequest.mockRejectedValueOnce(Error('native request failed'))
    const { requestComputerUsePermission } = await import('./computer-use-permissions')
    await requestComputerUsePermission('screenRecording')
    expect(mocks.sources).toHaveBeenCalledWith({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } })
    expect(mocks.open).toHaveBeenCalledWith(pane('ScreenCapture'))
  })

  it('opens settings when both native loading and fallback capture fail', async () => {
    vi.doMock('@computer-use/node-mac-permissions', () => { throw Error('native addon unavailable') })
    mocks.sources.mockRejectedValueOnce(Error('screen permission required'))
    const { requestComputerUsePermission } = await import('./computer-use-permissions')
    await requestComputerUsePermission('screenRecording')
    expect(mocks.sources).toHaveBeenCalledOnce()
    expect(mocks.open).toHaveBeenCalledWith(pane('ScreenCapture'))
  })

  it('reports settings launch failures instead of silently completing authorization', async () => {
    mocks.open.mockRejectedValueOnce(Error('settings unavailable'))
    const { requestComputerUsePermission } = await import('./computer-use-permissions')
    await expect(requestComputerUsePermission('accessibility')).rejects.toThrow('settings unavailable')
  })

  it.each(['unknown', 'not-determined'])('preserves %s permission and keeps passive checks free of prompts', async status => {
    mocks.mediaStatus.mockReturnValue(status)
    const { getComputerUsePermissions } = await import('./computer-use-permissions')
    expect((await getComputerUsePermissions()).screenRecording).toBe('unknown')
    expect(mocks.trusted).toHaveBeenCalledWith(false)
    expect(mocks.trusted).not.toHaveBeenCalledWith(true)
    expect(mocks.nativeScreenRequest).not.toHaveBeenCalled()
    expect(mocks.open).not.toHaveBeenCalled()
  })

  it.each(['win32', 'linux'])('does not open macOS settings on %s', async value => {
    Object.defineProperty(process, 'platform', { configurable: true, value })
    const { requestComputerUsePermission } = await import('./computer-use-permissions')
    expect(await requestComputerUsePermission('accessibility')).toMatchObject({
      needsPermission: false, accessibility: 'granted', screenRecording: 'granted'
    })
    expect(mocks.open).not.toHaveBeenCalled()
  })
})
