import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComposerSubscriptionQuotaRequest } from '@shared/composer-subscription-quota'
import {
  composerSubscriptionQuotaCache,
  readComposerSubscriptionQuota,
  subscriptionQuotaSelectionKey
} from './composer-subscription-quota-cache'
import { useQuotaCacheEntry } from './use-quota-cache-entry'

export const COMPOSER_SUBSCRIPTION_REFRESH_MS = 3 * 60_000
type Activity = { key: string; fetching: boolean; manual: boolean }
const IDLE: Activity = { key: '', fetching: false, manual: false }
const visible = (): boolean => typeof document !== 'undefined' && document.visibilityState !== 'hidden'

/**
 * The subscription limits of one exact composer selection, from the quota cache
 * every surface shares. A held answer is shown at once and only re-read once it
 * is no longer fresh, so opening the popover costs nothing; the answer is never
 * borrowed from another selection, and one that cannot be re-verified is dropped.
 */
export function useComposerSubscriptionQuota(selection: ComposerSubscriptionQuotaRequest | undefined, routeKey: string) {
  const requestRef = useRef(selection)
  requestRef.current = selection
  const key = selection ? subscriptionQuotaSelectionKey(selection) : ''
  const entry = useQuotaCacheEntry(composerSubscriptionQuotaCache, key)
  const [activity, setActivity] = useState<Activity>(IDLE)
  const runRef = useRef<(force: boolean) => Promise<void>>(async () => undefined)

  useEffect(() => {
    let active = true
    let generation = 0
    const run = async (force: boolean): Promise<void> => {
      const request = requestRef.current
      if (!active || !key || !request || !visible()) return
      const held = composerSubscriptionQuotaCache.peek(key)
      if (!force && held && composerSubscriptionQuotaCache.isFresh(held)) return
      const revision = ++generation
      setActivity({ key, fetching: true, manual: force })
      try {
        await readComposerSubscriptionQuota(request, { force })
      } catch {
        // An account that cannot be read is not shown from an older answer.
        composerSubscriptionQuotaCache.drop(key)
      } finally {
        if (active && revision === generation) setActivity({ key, fetching: false, manual: false })
      }
    }
    runRef.current = run
    setActivity(IDLE)
    if (!key) return () => { active = false }
    void run(false)
    const onVisibility = (): void => { if (visible()) void run(false) }
    const timer = window.setInterval(() => { void run(false) }, COMPOSER_SUBSCRIPTION_REFRESH_MS)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false; generation += 1
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [key, routeKey])

  // Another surface forced a refresh: what is held is older than what Kun has now.
  const stale = entry?.stale ?? false
  useEffect(() => { if (stale) void runRef.current(false) }, [stale])

  const refresh = useCallback(() => { void runRef.current(true) }, [])
  const revalidate = useCallback(() => { void runRef.current(false) }, [])
  const current = activity.key === key ? activity : IDLE
  return {
    result: entry?.value ?? null,
    refreshing: current.fetching && current.manual,
    /** Only while there is nothing to show: a held answer is shown, not hidden, as it is re-read. */
    verifyingIdentity: current.fetching && !entry,
    refresh,
    revalidate
  }
}
