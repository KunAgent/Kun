import { AlertCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { PROVIDER_QUOTA_LIST_KEY, providerQuotaListCache, readProviderQuotaList } from '../../hooks/provider-quota-list-cache'
import { useQuotaCacheEntry } from '../../hooks/use-quota-cache-entry'
import { useChatStore } from '../../store/chat-store'
import { QuotaBoard, QuotaBoardSkeleton } from '../usage/QuotaBoard'

export type ProviderQuotaPanelStatus = {
  loading: boolean
  refreshedAt?: string
}

export type ProviderQuotaPanelProps = {
  refreshKey?: unknown
  /** Reads again on its own while shown, as the vendors' windows move. */
  active?: boolean
  onStatusChange?: (status: ProviderQuotaPanelStatus) => void
}

const AUTO_REFRESH_MS = 3 * 60_000

export function ProviderQuotaPanel({
  refreshKey,
  active = true,
  onStatusChange
}: ProviderQuotaPanelProps = {}): ReactElement {
  const { t } = useTranslation('common')
  // The answer lives in the cache every quota surface shares: it is shown at
  // once when held, and only read again when it is no longer fresh.
  const entry = useQuotaCacheEntry(providerQuotaListCache, PROVIDER_QUOTA_LIST_KEY)
  const result = entry?.value ?? null
  const [loading, setLoading] = useState(!entry)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const firstRefreshKey = useRef(refreshKey)
  // Read through a ref so a language change does not count as a refresh.
  const tRef = useRef(t)
  tRef.current = t

  const refresh = useCallback(async (manual = false): Promise<void> => {
    if (manual) setRefreshing(true)
    else if (!providerQuotaListCache.peek(PROVIDER_QUOTA_LIST_KEY)) setLoading(true)
    setError('')
    try {
      if (typeof window.kunGui?.listProviderQuotas !== 'function') {
        throw new Error(tRef.current('providerQuotaUnavailable'))
      }
      await readProviderQuotaList({ force: manual })
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : tRef.current('providerQuotaLoadFailed'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  // The header's refresh asks the vendors again; mounting reads what Kun has.
  useEffect(() => {
    const manual = firstRefreshKey.current !== refreshKey
    firstRefreshKey.current = refreshKey
    void refresh(manual)
  }, [refresh, refreshKey])

  // Another surface refreshed the vendors: what is held is older than Kun's now.
  const stale = entry?.stale ?? false
  useEffect(() => {
    if (active && stale) void refresh()
  }, [active, refresh, stale])

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, AUTO_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [active, refresh])

  useEffect(() => {
    onStatusChange?.({
      loading: loading || refreshing,
      ...(result?.refreshedAt ? { refreshedAt: result.refreshedAt } : {})
    })
  }, [loading, onStatusChange, refreshing, result?.refreshedAt])

  const openDashboard = (url: string): void => {
    if (typeof window.kunGui?.openExternal === 'function') void window.kunGui.openExternal(url)
  }
  const openProviders = (): void => useChatStore.getState().openSettings('providers')

  return (
    <section
      aria-label={t('usagePanelTabQuota')}
      className="provider-quota-panel ds-no-drag"
      data-provider-quota-panel
    >
      <div
        data-provider-quota-scroller
        className="usage-panel-scroller"
        onWheel={(event) => event.stopPropagation()}
      >
        {loading && !result ? (
          <QuotaBoardSkeleton label={t('providerQuotaLoading')} />
        ) : error && !result ? (
          <div role="alert" className="usage-panel-alert">
            <AlertCircle aria-hidden="true" strokeWidth={1.8} />
            <span>{error}</span>
          </div>
        ) : result ? (
          <>
            {error ? (
              <div role="alert" className="usage-panel-alert is-inline" title={error}>
                <AlertCircle aria-hidden="true" strokeWidth={1.8} />
                <span>{t('usagePanelStaleData')}</span>
              </div>
            ) : null}
            <QuotaBoard
              result={result}
              variant="bars"
              retrying={refreshing}
              onRetry={() => void refresh(true)}
              onOpenDashboard={openDashboard}
              onFix={openProviders}
              fixLabel={t('usagePanelOpenProviders')}
              onAddProvider={openProviders}
            />
          </>
        ) : null}
      </div>
    </section>
  )
}
