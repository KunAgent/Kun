import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PET_IPC, type PetOverlayBootstrap } from '../../shared/pets'
import { PetStore } from './pet-store'
import { shutdownDesktopPets, startDesktopPets } from './pet-service'

const host = vi.hoisted(() => ({
  root: '', open: vi.fn(), close: vi.fn(), send: vi.fn(),
  handlers: new Map<string, (...args: unknown[]) => unknown>()
}))
vi.mock('electron', () => ({
  app: { isPackaged: false, getPath: () => path.join(host.root, 'profile'), getAppPath: () => host.root },
  BrowserWindow: vi.fn(), screen: {}, shell: {},
  ipcMain: {
    on: vi.fn(), handle: (channel: string, handler: (...args: unknown[]) => unknown) => host.handlers.set(channel, handler),
    removeHandler: (channel: string) => host.handlers.delete(channel), removeAllListeners: vi.fn()
  }
}))
vi.mock('../main-app-context', () => ({ mainState: { mainWindow: null }, developmentRendererUrl: () => undefined }))
vi.mock('../main-paths', () => ({ resolveNamedPreloadPath: vi.fn() }))
vi.mock('../main-runtime-settings', () => ({ runtimeRequest: vi.fn() }))
vi.mock('./pet-window', () => ({
  PetWindowController: class {
    setSpriteWidth() {}
    openAtSaved = host.open
    close = host.close
    send = host.send
    senderId() { return 77 }
    isOpen() { return true }
    mode() { return 'passthrough' }
    policy = { note: null }
  }
}))

beforeEach(async () => {
  host.root = await mkdtemp(path.join(tmpdir(), 'kun-pet-startup-'))
  host.open.mockReset()
  host.close.mockReset()
  host.send.mockReset()
  vi.stubEnv('CODEX_HOME', path.join(host.root, 'codex'))
})
afterEach(async () => {
  await shutdownDesktopPets()
  await rm(host.root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

async function copyDefault() {
  const destination = path.join(host.root, 'resources', 'pets', 'xiao-kun')
  await mkdir(path.dirname(destination), { recursive: true })
  await cp(path.resolve('resources/pets/xiao-kun'), destination, { recursive: true })
  return destination
}

describe('desktop pet startup', () => {
  it('imports the default before opening one populated overlay', async () => {
    await copyDefault()
    await startDesktopPets({ isFreshInstall: true })
    expect(host.open).toHaveBeenCalledTimes(1)
    const notification = host.send.mock.calls.find(([channel]) => channel === PET_IPC.overlayBootstrapChanged)
    expect(notification?.[1] as PetOverlayBootstrap).toMatchObject({
      petId: 'kun:xiao-kun', displayName: '小 Kun', isOpen: true, welcomedPetIds: [],
      spritesheetUrl: expect.stringContaining('kun-pet://asset/kun%3Axiao-kun/')
    })
    const settings = JSON.parse(await readFile(path.join(host.root, 'profile', 'pets', 'settings.json'), 'utf8'))
    expect(settings).toMatchObject({ selectedPetId: 'kun:xiao-kun', overlayOpen: true })
  })

  it.each(['missing', 'corrupt'])('never opens a blank overlay with a %s bundled asset', async (kind) => {
    if (kind === 'corrupt') {
      const destination = await copyDefault()
      await writeFile(path.join(destination, 'spritesheet.webp'), 'not an image')
    }
    await startDesktopPets({ isFreshInstall: true })
    expect(host.open).not.toHaveBeenCalled()
    expect(host.close).toHaveBeenCalled()
  })

  it('does not apply a first-run default from a cached copy when this import fails', async () => {
    const destination = await copyDefault()
    const store = new PetStore(path.join(host.root, 'profile', 'pets'))
    await store.initialize()
    await store.importOrUpdate({
      source: 'kun-builtin', sourceId: 'xiao-kun', displayName: 'Kun', description: 'Cached',
      spriteVersionNumber: 1, sourcePath: destination,
      spritesheetSourcePath: path.join(destination, 'spritesheet.webp')
    })
    await writeFile(path.join(destination, 'spritesheet.webp'), 'broken replacement')
    await startDesktopPets({ isFreshInstall: true })
    expect(host.open).not.toHaveBeenCalled()
  })

  it('defaults to preserving an existing installation', async () => {
    await copyDefault()
    await startDesktopPets()
    expect(host.open).not.toHaveBeenCalled()
  })
})
