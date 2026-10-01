import { expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
const electronMock = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn() }))
vi.mock('electron', () => ({ app: { ...electronMock, getAppPath: () => '/app' } }))
vi.mock('../main-app-context', () => ({ appEnvironment: {
  flavor: 'development', appName: 'kun-dv', appId: 'test', runtimeFlavor: 'development',
  profilePath: '/tmp', isPackaged: false
} }))
import { RemoteAccessService } from './remote-access-service'
import { markProtectedWindowContents } from '../protected-window-contents'
import type { AppSettingsV1 } from '../../shared/app-settings'

it('never mirrors protected window payloads, including windows marked after their creation event', () => {
  const service = new RemoteAccessService({ getSettings: async () => ({}) as AppSettingsV1,
    persistRemotePatch: async () => undefined, getMainWindow: () => null, logError: () => undefined })
  const hub = (service as unknown as { hub: { broadcast(channel: string, payload: unknown): void } }).hub
  const broadcast = vi.spyOn(hub, 'broadcast')
  service.attachWindowMirroring()
  const onCreated = electronMock.on.mock.calls.find(([name]) => name === 'browser-window-created')![1]
  for (const markAfterCreation of [false, true]) {
    const send = vi.fn()
    const contents = { send }
    if (!markAfterCreation) markProtectedWindowContents(contents)
    onCreated({}, { webContents: contents } as unknown as BrowserWindow)
    if (markAfterCreation) markProtectedWindowContents(contents)
    contents.send('private-consent', { nonce: 'private' })
    expect(send).toHaveBeenCalledWith('private-consent', { nonce: 'private' })
    expect(broadcast).not.toHaveBeenCalled()
  }
  const send = vi.fn()
  const contents = { send }
  onCreated({}, { webContents: contents } as unknown as BrowserWindow)
  contents.send('public-workbench', { ready: true })
  expect(broadcast).toHaveBeenCalledWith('public-workbench', { ready: true })
})
