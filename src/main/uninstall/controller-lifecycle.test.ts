import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UninstallController } from './controller'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  root: '', events: [] as string[], failSpawn: false,
  spawn: vi.fn(), write: vi.fn(),
  quit: vi.fn(), relaunch: vi.fn()
}))
vi.mock('electron', () => ({ app: { getPath: () => state.root, quit: state.quit, relaunch: state.relaunch },
  ipcMain: { removeHandler: (name: string) => state.handlers.delete(name),
    handle: (name: string, handler: (...args: unknown[]) => Promise<unknown>) => state.handlers.set(name, handler) } }))
vi.mock('node:child_process', () => ({ spawn: state.spawn }))
vi.mock('./cleanup-script', () => ({ writeCleanupScripts: state.write }))
vi.mock('./paths', () => ({ assertSafeUninstallPath: (path: string) => path,
  collectUninstallPaths: () => [{ path: join(state.root, 'data') }], markExistingPaths: vi.fn(), resolveAppRemovalTarget: vi.fn() }))
vi.mock('../renderer-trust-policy', () => ({ trustedRendererSenderIsCurrent: () => true }))
vi.mock('../main-window', () => ({ trustedWorkbenchRendererUrl: () => 'http://trusted.test' }))

beforeEach(async () => {
  vi.clearAllMocks()
  state.handlers.clear()
  state.events = []
  state.failSpawn = false
  state.root = await mkdtemp(join(tmpdir(), 'kun-uninstall-controller-'))
  const markerDir = join(state.root, 'plan')
  await mkdir(markerDir)
  state.write.mockImplementation(async () => {
    state.events.push('write')
    return { markerDir, markerPath: join(markerDir, 'marker.json'), scriptPath: join(markerDir, 'cleanup.sh') }
  })
  state.spawn.mockImplementation(() => {
    state.events.push('spawn')
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    queueMicrotask(() => child.emit(state.failSpawn ? 'error' : 'spawn', new Error('spawn failed')))
    return child
  })
  state.quit.mockImplementation(() => { state.events.push('quit') })
})
afterEach(async () => { await rm(state.root, { recursive: true, force: true }) })

function controller(prepareForUninstall = async () => { state.events.push('prepare') }) {
  const controller = new UninstallController({ getMainWindow: () => null,
    getUserDataPath: () => join(state.root, 'data'), getExecPath: () => process.execPath,
    isPackaged: () => false, prepareForUninstall })
  controller.registerIpc()
  return () => state.handlers.get('uninstall:perform')!({}, { deleteAllData: true, removeApp: false })
}

describe('uninstall handoff lifecycle', () => {
  it('does not arm a helper on normal registration or Quit', () => {
    controller()
    state.quit()
    expect(state.spawn).not.toHaveBeenCalled()
    expect(state.write).not.toHaveBeenCalled()
  })

  it('prepares the entire stack before arming a helper and requesting Quit', async () => {
    const perform = controller()
    await expect(perform()).resolves.toMatchObject({ scheduled: true })
    expect(state.events).toEqual(['prepare', 'write', 'spawn', 'quit'])
    expect(state.relaunch).not.toHaveBeenCalled()
    await expect(perform()).rejects.toThrow('uninstall_in_progress')
    expect(state.spawn).toHaveBeenCalledOnce()
  })

  it('does not create a deletion plan after preparation fails and restores through one normal relaunch', async () => {
    const perform = controller(async () => { throw new Error('prepare failed') })
    await expect(perform()).rejects.toThrow('prepare failed')
    expect(state.write).not.toHaveBeenCalled()
    expect(state.spawn).not.toHaveBeenCalled()
    expect(state.relaunch).toHaveBeenCalledOnce()
    expect(state.quit).toHaveBeenCalledOnce()
    await expect(perform()).rejects.toThrow('uninstall_in_progress')
    expect(state.relaunch).toHaveBeenCalledOnce()
  })

  it('removes an unarmed plan after spawn failure and restores the stopped application', async () => {
    const perform = controller()
    state.failSpawn = true
    await expect(perform()).rejects.toThrow('spawn failed')
    await expect(stat(join(state.root, 'plan'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(state.relaunch).toHaveBeenCalledOnce()
    expect(state.quit).toHaveBeenCalledOnce()
  })

  it('still enters normal Quit if registering the recovery relaunch fails', async () => {
    const perform = controller(async () => { throw new Error('prepare failed') })
    state.relaunch.mockImplementationOnce(() => { throw new Error('relaunch failed') })
    await expect(perform()).rejects.toThrow('relaunch failed')
    expect(state.quit).toHaveBeenCalledOnce()
    expect(state.spawn).not.toHaveBeenCalled()
    expect(state.write).not.toHaveBeenCalled()
  })
})
