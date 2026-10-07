import { AlertCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProviderQuotaListResult } from '@shared/provider-quota'
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
  const [result, setResult] = useState<ProviderQuotaListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const firstRefreshKey = useRef(refreshKey)
  // Read through a ref so a language change does not count as a refresh.
  const tRef = useRef(t)
  tRef.current = t

  const refresh = useCallback(async (manual = false): Promise<void> => {
    if (manual) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      if (typeof window.kunGui?.listProviderQuotas !== 'function') {
        throw new Error(tRef.current('providerQuotaUnavailable'))
      }
      const next = await window.kunGui.listProviderQuotas(manual ? { forceRefresh: true } : undefined)
      if (next) setResult(next)
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
