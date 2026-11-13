import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LatexToolchainState } from '../../shared/latex-toolchain'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { registerAppLatexIpcHandlers } from './register-app-latex-ipc-handlers'

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => Promise<unknown>>(),
  install: vi.fn(async () => ({ phase: 'ready' })), status: vi.fn(async () => ({ tools: {} })), cancel: vi.fn(), stop: vi.fn(), buildStop: vi.fn(),
  showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/existing/tex/bin'] })), send: vi.fn(),
  onState: null as null | ((state: LatexToolchainState) => void), onQuit: null as null | (() => void)
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/kun-data', once: (_event: string, listener: () => void) => { mock.onQuit = listener } },
  dialog: { showOpenDialog: mock.showOpenDialog }, net: { fetch: vi.fn() },
  ipcMain: { handle: (name: string, handler: (event: unknown, input: unknown) => Promise<unknown>) => mock.handlers.set(name, handler) }
}))
vi.mock('./app-ipc-handler-utils', () => ({ assertTrustedWorkbenchSender: (event: { trusted: boolean }) => {
  if (!event.trusted) throw new Error('Untrusted workbench frame')
} }))
vi.mock('../services/latex/build', () => ({ LatexBuildService: class { stop = mock.buildStop } }))
vi.mock('../services/latex/toolchain-install', () => ({ LatexToolchainInstaller: class {
  constructor(_root: string, options: { onState: (state: LatexToolchainState) => void }) { mock.onState = options.onState }
  install = mock.install
  status = mock.status
  cancel = mock.cancel
  stop = mock.stop
} }))
beforeEach(() => {
  vi.clearAllMocks(); mock.handlers.clear()
  registerAppLatexIpcHandlers({ getMainWindow: () => ({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: mock.send } }) } as unknown as RegisterAppIpcHandlersOptions)
})
describe('TeX installation IPC boundary', () => {
  it('rejects untrusted callers and arbitrary installer URLs before starting a job', async () => {
    await expect(mock.handlers.get('latex:install-tools')!({ trusted: false }, {})).rejects.toThrow('Untrusted')
    await expect(mock.handlers.get('latex:install-tools')!({ trusted: true }, { url: 'https://untrusted.example/install' })).resolves.toMatchObject({ ok: false })
    expect(mock.install).not.toHaveBeenCalled()
    await expect(mock.handlers.get('latex:install-tools')!({ trusted: true }, {})).resolves.toMatchObject({ ok: true, state: { phase: 'ready' } })
    expect(mock.install).toHaveBeenCalledOnce()
  })
  it('validates engine and cancellation IDs and uses the native directory picker', async () => {
    await mock.handlers.get('latex:toolchain-status')!({ trusted: true }, { engine: 'xelatex', toolDirectory: '/tex' })
    expect(mock.status).toHaveBeenCalledWith('xelatex', '/tex')
    await mock.handlers.get('latex:cancel-tool-install')!({ trusted: true }, { jobId: 'current-job' })
    expect(mock.cancel).toHaveBeenCalledWith('current-job')
    await expect(mock.handlers.get('latex:cancel-tool-install')!({ trusted: true }, { jobId: '../other' })).resolves.toMatchObject({ ok: false })
    await expect(mock.handlers.get('latex:choose-tool-directory')!({ trusted: true }, {})).resolves.toEqual({ ok: true, toolDirectory: '/existing/tex/bin' })
  })
  it('emits progress to the workbench and cancels installation on app shutdown', () => {
    const state = { phase: 'downloading', jobId: 'install' } as LatexToolchainState
    mock.onState!(state)
    expect(mock.send).toHaveBeenCalledWith('latex:toolchain-state', state)
    mock.onQuit!()
    expect(mock.stop).toHaveBeenCalledOnce()
    expect(mock.buildStop).toHaveBeenCalledOnce()
  })
})
