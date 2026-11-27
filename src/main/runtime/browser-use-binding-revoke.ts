import type { AppSettingsV1 } from '../../shared/app-settings'
import { logWarn } from '../logger'
import {
  getRuntimeBaseUrlForSettings,
  kunRuntimeAdapter,
  runtimeAuthHeaders
} from './kun-adapter'

type BrowserUseBindingRevokeOptions = {
  fetch?: typeof fetch
  runtimeIsLive?: () => boolean
  timeoutMs?: number
}

type BrowserUseBindingOwner = {
  url: string
  token: string
  approvalSigningKey: string
}

/**
 * Revoke only the desktop-owned ephemeral Browser authority before its Runtime
 * drains. Matching the old binding keeps a late response from revoking a
 * replacement authority or replaying the GUI's full settings snapshot.
 */
export async function revokeManagedRuntimeBrowserUseBinding(
  settings: AppSettingsV1,
  owner: BrowserUseBindingOwner | undefined,
  options: BrowserUseBindingRevokeOptions = {}
): Promise<boolean> {
  if (!owner) return false
  const runtimeIsLive = options.runtimeIsLive ?? (() => kunRuntimeAdapter.isChildRunning())
  if (!runtimeIsLive()) return false

  const fetchImpl = options.fetch ?? fetch
  const headers = runtimeAuthHeaders(settings)
  headers.set('content-type', 'application/json')
  try {
    const response = await fetchImpl(
      `${getRuntimeBaseUrlForSettings(settings)}/v1/runtime/config/apply`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          browserUseHostBinding: null,
          browserUseHostBindingRevoke: {
            bridgeUrl: owner.url,
            bridgeToken: owner.token,
            approvalSigningKey: owner.approvalSigningKey
          }
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 2_000)
      }
    )
    const payload = await response.json().catch(() => null) as { ok?: unknown } | null
    if (response.ok && payload?.ok === true) return true
    logWarn(
      'browser-use-shutdown',
      `Kun Browser Use authority revoke was not applied (HTTP ${response.status}).`
    )
  } catch (error) {
    logWarn('browser-use-shutdown', 'Kun Browser Use authority revoke failed closed', {
      message: error instanceof Error ? error.message : String(error)
    })
  }
  return false
}
