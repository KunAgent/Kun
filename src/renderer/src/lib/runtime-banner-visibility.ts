import type { KunRuntimeStatusPayload } from '@shared/kun-gui-api'
import { isAppQuitting } from './app-quitting'

export function shouldSuppressRuntimeErrorBanner(
  status: KunRuntimeStatusPayload | null | undefined,
  appQuitting = isAppQuitting()
): boolean {
  return appQuitting || status?.state === 'restarting' || status?.state === 'crashed'
}
