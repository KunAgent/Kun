import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings, type AppSettingsV1 } from '../shared/app-settings'
import { createClawRuntime } from './claw-runtime'

type Internals = { server: { listening: boolean } | null; closeWebhook: () => Promise<void> }

function settingsWith(claw: { enabled: boolean; imEnabled: boolean }): AppSettingsV1 {
  const settings = normalizeAppSettings({} as unknown as AppSettingsV1)
  settings.claw.enabled = claw.enabled
  settings.claw.im.enabled = claw.imEnabled
  // Any free port; the default 18787 may be taken on the machine running the tests.
  settings.claw.im.port = 0
  return settings
}

describe('Claw IM webhook port', () => {
  const runtimes: Array<{ stop: () => Promise<void> }> = []
  afterEach(async () => { for (const runtime of runtimes.splice(0)) await runtime.stop() })

  function start(settings: AppSettingsV1) {
    const runtime = createClawRuntime({
      store: { load: async () => settings } as never,
      runtimeRequest: vi.fn() as never,
      logError: () => undefined
    })
    runtimes.push(runtime as unknown as { stop: () => Promise<void> })
    ;(runtime as unknown as { syncWebhook: (value: AppSettingsV1) => void }).syncWebhook(settings)
    return runtime as unknown as Internals & { syncWebhook: (value: AppSettingsV1) => void }
  }

  it('does not take the port while the IM webhook is off, which is the default', () => {
    expect(start(settingsWith({ enabled: true, imEnabled: false })).server).toBeNull()
    expect(start(settingsWith({ enabled: false, imEnabled: true })).server).toBeNull()
  })

  it('takes the port once the webhook is on, and gives it back when it is turned off again', async () => {
    const runtime = start(settingsWith({ enabled: true, imEnabled: true }))
    expect(runtime.server).not.toBeNull()
    runtime.syncWebhook(settingsWith({ enabled: true, imEnabled: false }))
    expect(runtime.server).toBeNull()
  })
})
