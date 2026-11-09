import { afterEach, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => any>(),
  trust: vi.fn(), ready: vi.fn(), operation: vi.fn(), status: vi.fn(() => ({phase: 'not_installed'})) }))
vi.mock('electron', () => ({ipcMain: {handle: (name: string, run: (...args: any[]) => any) => h.handlers.set(name, run)}}))
vi.mock('../ipc/app-ipc-handler-utils', () => ({assertTrustedWorkbenchSender: h.trust}))
vi.mock('../control-host/runtime-host', () => ({controlRuntimeHost: () => ({ready: h.ready, packageOperation: h.operation, manager: {status: h.status}})}))
import { registerControlPackage } from './register'
afterEach(() => {h.handlers.clear(); vi.clearAllMocks()})
it('routes passive status/check through the package API without demanding a runtime', async () => {
  registerControlPackage({getMainWindow: () => undefined} as any)
  const event = {}
  expect(await h.handlers.get('control-package:status')!(event)).toEqual({phase: 'not_installed'})
  await h.handlers.get('control-package:check')!(event)
  expect(h.operation).toHaveBeenCalledWith('check')
  expect(h.ready).not.toHaveBeenCalled()
  expect(h.operation).not.toHaveBeenCalledWith('install')
  await h.handlers.get('control-package:install')!(event)
  expect(h.operation).toHaveBeenCalledWith('install')
})
