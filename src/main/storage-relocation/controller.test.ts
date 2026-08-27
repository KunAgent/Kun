import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() }
}))

vi.mock('../main-window', () => ({
  trustedWorkbenchRendererUrl: () => 'http://127.0.0.1:5173/index.html'
}))

import { StorageRelocationController, assertTrustedStorageRelocationSender } from './controller'

describe('storage relocation IPC sender boundary', () => {
  const trustedUrl = 'http://127.0.0.1:5173/index.html?storageRelocation=1'
  const workbenchUrl = 'http://127.0.0.1:5173/index.html'
  const mainFrame = { processId: 10, routingId: 20, url: trustedUrl }
  const mainContents = { id: 1, mainFrame }
  const getMainWindow = () => ({
    isDestroyed: () => false,
    webContents: mainContents
  }) as never

  it('accepts only the current top-level workbench frame', () => {
    expect(() => assertTrustedStorageRelocationSender({
      sender: mainContents,
      senderFrame: mainFrame
    } as never, getMainWindow)).not.toThrow()
    expect(() => assertTrustedStorageRelocationSender({
      sender: mainContents,
      senderFrame: { processId: 10, routingId: 99, url: trustedUrl }
    } as never, getMainWindow)).toThrow(/trusted top-level frame/)
    expect(() => assertTrustedStorageRelocationSender({
      sender: mainContents,
      senderFrame: { ...mainFrame, url: 'https://example.com' }
    } as never, getMainWindow)).toThrow(/trusted top-level frame/)
    expect(() => assertTrustedStorageRelocationSender({
      sender: { id: 9 },
      senderFrame: mainFrame
    } as never, getMainWindow)).toThrow(/trusted top-level frame/)
  })

  it('also accepts the normal workbench settings surface', () => {
    expect(() => assertTrustedStorageRelocationSender({
      sender: mainContents,
      senderFrame: { ...mainFrame, url: workbenchUrl }
    } as never, getMainWindow)).not.toThrow()
  })
})

describe('storage relocation scheduling boundary', () => {
  it('persists, enters draining, and invokes the restart coordinator in order', async () => {
    const operationId = '123e4567-e89b-42d3-a456-426614174000'
    const events: string[] = []
    const journal = {
      schemaVersion: 1 as const,
      operationId,
      kind: 'move' as const,
      phase: 'prepared' as const,
      sourceHome: 'C:\\Users\\Alice',
      destinationRoot: 'D:\\KunData',
      controlRoot: 'C:\\Users\\Alice\\AppData\\Roaming\\Kun\\storage-relocation',
      roots: [],
      uniqueBytes: 0,
      requiredBytes: 5 * 1024 * 1024 * 1024,
      startedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z'
    }
    const fakeEngine = {
      schedule: vi.fn(async () => { events.push('persisted'); return journal }),
      markDraining: vi.fn(async () => { events.push('draining'); return { ...journal, phase: 'draining' as const } }),
      status: vi.fn(async () => ({ state: 'pending' }))
    }
    const controller = new StorageRelocationController({
      engine: fakeEngine as never,
      getMainWindow: () => null,
      prepareForRestart: async () => { events.push('restart') }
    })
    const plan = {
      operationId,
      kind: 'move' as const,
      destinationRoot: 'D:\\KunData',
      targetRoots: { '.kun': 'D:\\KunData\\.kun', '.deepseekgui': 'D:\\KunData\\.deepseekgui' },
      sources: [],
      uniqueBytes: 0,
      requiredBytes: 5 * 1024 * 1024 * 1024,
      availableBytes: 10 * 1024 * 1024 * 1024,
      expectedReleasedBytes: 0,
      activeWork: [],
      warnings: [],
      createdAt: '2026-08-01T00:00:00.000Z'
    }
    await expect((controller as unknown as {
      schedule: (value: typeof plan, interrupt: boolean) => Promise<unknown>
    }).schedule(plan, false)).resolves.toEqual({ state: 'pending' })
    expect(events).toEqual(['persisted', 'draining', 'restart'])
  })
})
