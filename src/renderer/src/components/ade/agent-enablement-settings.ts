import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { normalizeKunHarnessSettings } from '@shared/app-settings-kun-harness'
import { harnessProfileEnabled } from '@shared/harness-enablement'
import type { KunHarnessEnabledProfileV1 } from '@shared/app-settings'
import { AgentEnablementError, abortableAgentOperation, agentConfigurationKey, waitForAgentPoll } from './agent-enablement-operation'

// Main's hot-apply request allows 120s; leave time for acknowledgment delivery.
export const AGENT_SETTINGS_TIMEOUT_MS = 125_000

function configuration(value: KunHarnessSettingsV1, id?: string): string {
  const settings = normalizeKunHarnessSettings(value)
  return agentConfigurationKey(id
    ? { binary: settings.binaryPaths[id], custom: settings.custom.find((entry) => entry.id === id), defaults: settings.defaults[id] }
    : { binaryPaths: settings.binaryPaths, custom: settings.custom, defaults: settings.defaults })
}

/** Never check an older binary/default profile while Settings is still saving. */
export async function waitForAgentSettings(expected: KunHarnessSettingsV1, signal: AbortSignal, options: {
  harnessId?: string; enabledProfile?: KunHarnessEnabledProfileV1; timeoutMs?: number
} = {}): Promise<void> {
  const desired = configuration(expected, options.harnessId)
  const deadline = Date.now() + (options.timeoutMs ?? AGENT_SETTINGS_TIMEOUT_MS)
  while (Date.now() < deadline) {
    signal.throwIfAborted()
    const saved = await abortableAgentOperation(rendererRuntimeClient.getSettings({ forceRefresh: true }), signal)
    const sync = await abortableAgentOperation(window.kunGui.getRuntimeSettingsSyncStatus(), signal)
    signal.throwIfAborted()
    const settings = getKunRuntimeSettings(saved).harnesses
    if (configuration(settings, options.harnessId) === desired && sync.state === 'synced' &&
      (!options.enabledProfile || harnessProfileEnabled(settings, options.enabledProfile))) return
    if (sync.state === 'failed') throw new AgentEnablementError('agentEnablement.settingsApplyFailed', sync.message)
    if (sync.state === 'unavailable') throw new AgentEnablementError('agentEnablement.unavailable', sync.message)
    await waitForAgentPoll(signal)
  }
  throw new AgentEnablementError('agentEnablement.settingsTimeout')
}
