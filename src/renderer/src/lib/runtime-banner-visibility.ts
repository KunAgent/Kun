import type { KunRuntimeStatusPayload } from '@shared/kun-gui-api'

export function shouldSuppressRuntimeErrorBanner(
  status: KunRuntimeStatusPayload | null | undefined
): boolean {
  return status?.state === 'degraded' || status?.state === 'restarting' || status?.state === 'crashed'
}
