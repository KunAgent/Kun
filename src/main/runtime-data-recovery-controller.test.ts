import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeDataRecoveryError } from './runtime-data-dir-recovery'

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  ipcMain: {
    removeHandler: vi.fn((channel: string) => electron.handlers.delete(channel)),
    handle: vi.fn((channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) => {
      electron.handlers.set(channel, handler)
    })
  }
}))

vi.mock('electron', () => ({ ipcMain: electron.ipcMain }))
vi.mock('./main-window', () => ({
  trustedWorkbenchRendererUrl: () => 'http://127.0.0.1:5173/index.html'
}))

import {
  RuntimeDataRecoveryController,
  assertTrustedRuntimeDataRecoverySender,
  publicRuntimeDataRecoveryError
} from './runtime-data-recovery-controller'

describe('Runtime data recovery IPC boundary', () => {
  const recoveryUrl = 'http://127.0.0.1:5173/index.html?runtimeMigrationRecovery=1'
  const mainFrame = { processId: 10, routingId: 20, url: recoveryUrl }
  const mainContents = { id: 1, mainFrame }
  const mainWindow = {
    isDestroyed: () => false,
    webContents: mainContents
  }
  const trustedEvent = { sender: mainContents, senderFrame: mainFrame }

  beforeEach(() => {
    electron.handlers.clear()
    vi.clearAllMocks()
  })

  it('accepts only the current top-level recovery frame', () => {
    const getMainWindow = () => mainWindow as never
    expect(() => assertTrustedRuntimeDataRecoverySender(trustedEvent as never, getMainWindow)).not.toThrow()
    expect(() => assertTrustedRuntimeDataRecoverySender({
      sender: mainContents,
      senderFrame: { processId: 10, routingId: 99, url: recoveryUrl }
    } as never, getMainWindow)).toThrow(/trusted top-level frame/)
    expect(() => assertTrustedRuntimeDataRecoverySender({
      sender: mainContents,
      senderFrame: { ...mainFrame, url: 'http://127.0.0.1:5173/index.html' }
    } as never, getMainWindow)).toThrow(/trusted top-level frame/)
    expect(() => assertTrustedRuntimeDataRecoverySender({
      sender: { id: 2 },
      senderFrame: mainFrame
    } as never, getMainWindow)).toThrow(/trusted top-level frame/)
  })

  it('rejects renderer-supplied paths before invoking the recovery engine', async () => {
    const execute = vi.fn()
    new RuntimeDataRecoveryController({
      recovery: { getStatus: vi.fn(), execute } as never,
      getMainWindow: () => mainWindow as never
    }).registerIpc()
    const handler = electron.handlers.get('runtime-data-recovery:execute')!

    await expect(handler(trustedEvent, {
      action: 'restore',
      generation: '123e4567-e89b-42d3-a456-426614174000',
      candidateId: 'a'.repeat(43),
      path: '/tmp/renderer-controlled'
    })).rejects.toThrow('invalid_request')
    expect(execute).not.toHaveBeenCalled()
  })

  it('passes only a strict opaque candidate request and schedules completion once', async () => {
    const status = {
      schemaVersion: 1,
      generation: '123e4567-e89b-42d3-a456-426614174000',
      state: 'completed',
      historicalEvidence: true,
      candidates: [],
      invalidEvidenceCount: 0,
      warnings: []
    }
    const execute = vi.fn(async () => status)
    const onCompleted = vi.fn()
    new RuntimeDataRecoveryController({
      recovery: { getStatus: vi.fn(), execute } as never,
      getMainWindow: () => mainWindow as never,
      onCompleted
    }).registerIpc()
    const handler = electron.handlers.get('runtime-data-recovery:execute')!
    const request = {
      action: 'restore',
      generation: status.generation,
      candidateId: 'b'.repeat(43)
    }

    await expect(handler(trustedEvent, request)).resolves.toEqual(status)
    expect(execute).toHaveBeenCalledWith(request)
    expect(onCompleted).toHaveBeenCalledOnce()
  })

  it('never exposes raw filesystem errors to the renderer', () => {
    expect(publicRuntimeDataRecoveryError(new Error('ENOENT: /Users/alice/.kun/data')))
      .toBe('recovery_failed: Runtime data recovery failed without changing preserved evidence.')
    expect(publicRuntimeDataRecoveryError(new RuntimeDataRecoveryError(
      'candidate_changed',
      'The selected recovery candidate changed after it was inspected.',
      { cause: new Error('/secret/path') }
    ))).not.toContain('/secret/path')
  })
})
