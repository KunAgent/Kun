import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { rendererRuntimeClient } from '../../agent/runtime-client'

function configuration(settings: KunHarnessSettingsV1): string {
  return JSON.stringify({ binaryPaths: settings.binaryPaths, custom: settings.custom, defaults: settings.defaults })
}

/** Never check an older binary/default profile while Settings is still saving. */
export async function waitForAgentSettings(expected: KunHarnessSettingsV1, signal: AbortSignal): Promise<void> {
  const desired = configuration(expected)
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    const saved = await rendererRuntimeClient.getSettings({ forceRefresh: true })
    const sync = await window.kunGui.getRuntimeSettingsSyncStatus()
    signal.throwIfAborted()
    if (configuration(getKunRuntimeSettings(saved).harnesses) === desired && sync.state === 'synced') return
    if (sync.state === 'failed' || sync.state === 'unavailable') throw new Error('agentEnablement.settingsUnavailable')
    await new Promise<void>((resolve, reject) => {
      const abort = (): void => { clearTimeout(timer); reject(new Error('agentEnablement.cancelled')) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 100)
      signal.addEventListener('abort', abort, { once: true })
    })
  }
  throw new Error('agentEnablement.settingsUnavailable')
}
