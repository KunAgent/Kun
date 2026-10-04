import { BrowserWindow } from 'electron'
import {
  getModelProviderSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import type { KunRuntimeSettingsSyncStatusPayload } from '../../shared/kun-gui-api'
import {
  getRuntimeBaseUrlForSettings,
  kunRuntimeAdapter,
  runtimeAuthHeaders
} from './kun-adapter'
import { mainState, runtimeSettingsIntents } from '../main-app-context'
import { applySettingsPatchToSnapshot } from '../settings-store-foundation'
import { logInfo, logWarn } from '../logger'

export const LOCAL_GATEWAY_SECTION = 'localModelGateway'
const REQUEST_TIMEOUT_MS = 10_000

export type LocalGatewayCredentialReconcile =
  | { outcome: 'unchanged' }
  | { outcome: 'key_ensured' }
  | { outcome: 'disabled'; settings: AppSettingsV1; message: string }

function publishGatewaySectionStatus(message: string): void {
  const payload: KunRuntimeSettingsSyncStatusPayload = {
    state: 'synced',
    generation: runtimeSettingsIntents.currentGeneration,
    message,
    sections: {
      [LOCAL_GATEWAY_SECTION]: { code: 'gateway_disabled', message }
    },
    at: new Date().toISOString()
  }
  mainState.runtimeSettingsSyncStatus = payload
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('runtime:settings-sync-status', payload)
  }
}

/**
 * P4-04 migration: persisted settings may enable the local model gateway
 * while Kun's credential store has no active client or shared key. When the runtime is
 * reachable, ensure the key exists; if creation fails, disable the gateway
 * in durable settings so every later hot apply is not rejected by it.
 */
export async function reconcileLocalGatewayCredential(
  settings: AppSettingsV1,
  source: string
): Promise<LocalGatewayCredentialReconcile> {
  if (!getModelProviderSettings(settings).localGateway.enabled) return { outcome: 'unchanged' }
  if (!kunRuntimeAdapter.isChildRunning()) return { outcome: 'unchanged' }
  const base = getRuntimeBaseUrlForSettings(settings)
  const headers = runtimeAuthHeaders(settings)
  headers.set('content-type', 'application/json')

  const statusResponse = await fetch(`${base}/v1/model-gateway/credential/status`, {
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (statusResponse.ok) {
    const status = JSON.parse(await statusResponse.text()) as {
      credential?: { configured?: boolean }
      activeCredentials?: boolean
    }
    if (status.activeCredentials === true || status.credential?.configured === true) return { outcome: 'unchanged' }
  }

  const ensured = await fetch(`${base}/v1/model-gateway/credential/ensure`, {
    method: 'POST',
    headers,
    body: '{}',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })
  if (ensured.ok) {
    logInfo(source, 'Generated the missing local model gateway API key.')
    return { outcome: 'key_ensured' }
  }
  const detail = `credential ensure failed (HTTP ${ensured.status})`
  const patched = await mainState.store.updateIf(
    (current) => getModelProviderSettings(current).localGateway.enabled,
    (current) =>
      applySettingsPatchToSnapshot(current, {
        provider: { localGateway: { enabled: false } }
      })
  )
  if (!patched.applied) return { outcome: 'unchanged' }
  const message =
    `The local model gateway was turned off because Kun could not create its API key (${detail}).`
  logWarn(source, `Local model gateway disabled: ${detail}`)
  return { outcome: 'disabled', settings: patched.settings, message }
}

export function scheduleLocalGatewayCredentialReconcile(
  settings: AppSettingsV1,
  source: string
): void {
  void reconcileLocalGatewayCredential(settings, source)
    .then((reconcile) => {
      if (reconcile.outcome === 'disabled') publishGatewaySectionStatus(reconcile.message)
    })
    .catch((error) => {
      logWarn(source, 'Local model gateway credential reconcile failed.', {
        message: error instanceof Error ? error.message : String(error)
      })
    })
}
