import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComposerSubscriptionQuotaRequest, ComposerSubscriptionQuotaResult } from '@shared/composer-subscription-quota'
import { readComposerSubscriptionQuota, subscriptionQuotaSelectionKey } from './composer-subscription-quota-cache'

export const COMPOSER_SUBSCRIPTION_REFRESH_MS = 3 * 60_000
type Snapshot = { key: string; result: ComposerSubscriptionQuotaResult | null; refreshing: boolean; verifyingIdentity: boolean }
const visible = (): boolean => typeof document !== 'undefined' && document.visibilityState !== 'hidden'

/** Scope the displayed answer to the exact composer route, never to the last request to finish. */
export function useComposerSubscriptionQuota(selection: ComposerSubscriptionQuotaRequest | undefined, routeKey: string) {
  const requestRef = useRef(selection)
  requestRef.current = selection
  const key = selection ? `${routeKey}:${subscriptionQuotaSelectionKey(selection)}` : ''
  const [snapshot, setSnapshot] = useState<Snapshot>({ key: '', result: null, refreshing: false, verifyingIdentity: false })
  const refreshRef = useRef<(force?: boolean, reset?: boolean) => Promise<void>>(async () => undefined)

  useEffect(() => {
    let active = true
    let generation = 0
    const refresh = async (force = false, reset = false): Promise<void> => {
      const request = requestRef.current
      if (!active || !key || !request || !visible()) return
      const revision = ++generation
      setSnapshot((current) => ({ key, result: reset || current.key !== key ? null : current.result, refreshing: true, verifyingIdentity: reset }))
      try {
        const result = await readComposerSubscriptionQuota({ ...request, ...(force ? { forceRefresh: true } : {}) })
        if (active && revision === generation) setSnapshot({ key, result, refreshing: false, verifyingIdentity: false })
      } catch {
        if (active && revision === generation) setSnapshot({ key, result: null, refreshing: false, verifyingIdentity: false })
      }
    }
    refreshRef.current = refresh
    setSnapshot({ key, result: null, refreshing: false, verifyingIdentity: false })
    if (!key) return () => { active = false }
    void refresh(false, true)
    const onVisibility = (): void => { if (visible()) void refresh(false, true) }
    const timer = window.setInterval(() => { void refresh() }, COMPOSER_SUBSCRIPTION_REFRESH_MS)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false; generation += 1
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [key])

  const refresh = useCallback(() => { void refreshRef.current(true, true) }, [])
  const revalidate = useCallback(() => { void refreshRef.current(false, true) }, [])
  const current = snapshot.key === key ? snapshot : null
  return { result: current?.result ?? null, refreshing: current?.refreshing ?? false,
    verifyingIdentity: current?.verifyingIdentity ?? false, refresh, revalidate }
}
