import { z } from 'zod'
import { setDesktopAnalyticsSink } from './report'
import { app, ipcMain, net } from 'electron'
import { join } from 'node:path'
import type { ArtAccountAccess } from '../art-assets/account-access'
import type { RegisterAppIpcHandlersOptions } from '../ipc/app-ipc-handler-options'
import { assertTrustedWorkbenchSender } from '../ipc/app-ipc-handler-utils'
import { isRemoteClientSender } from '../remote/remote-sender'
import { AnalyticsInput, ANALYTICS_CHANNELS } from '../../shared/product-analytics'
import { analyticsStorage } from './storage'
import { ProductAnalyticsService } from './service'
import { AnalyticsTransport } from './transport'
export function registerProductAnalytics(options: RegisterAppIpcHandlersOptions, account: ArtAccountAccess) {
  const service = new ProductAnalyticsService({
    storage: analyticsStorage(join(app.getPath('userData'), 'product-analytics', 'state.v1.json')),
    transport: new AnalyticsTransport((input, init) => net.fetch(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, init)),
    account, appVersion: app.getVersion(), platform: process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
    runtime: (path, method, body) => options.runtimeRequest(path, method, body, undefined,
      { priority: 'background', signal: AbortSignal.timeout(5000) })
  })
  for (const [channel, action] of [
    [ANALYTICS_CHANNELS.state, () => service.getState()],
    [ANALYTICS_CHANNELS.guidance, () => service.guidance()],
    [ANALYTICS_CHANNELS.consent, (value: unknown) => {
      if (typeof value !== 'boolean') throw new Error('analytics_invalid_consent')
      return service.setEnabled(value)
    }],
    [ANALYTICS_CHANNELS.track, (value: unknown) => {
      const input = z.object({ event: AnalyticsInput, epoch: z.string().uuid() }).strict().parse(value)
      return service.track(input.event, input.epoch)
    }]
  ] as const) ipcMain.handle(channel, (event, input: unknown) => {
    // Remote web must never inherit the desktop account/consent. It needs its own client authority.
    if (isRemoteClientSender(event.sender)) throw new Error('analytics_desktop_only')
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    return action(input)
  })
  setDesktopAnalyticsSink({ capture: () => service.captureEpoch(), track: (input, epoch) => service.track(input, epoch) })
  app.once('before-quit', () => { setDesktopAnalyticsSink(undefined); service.dispose() })
}
