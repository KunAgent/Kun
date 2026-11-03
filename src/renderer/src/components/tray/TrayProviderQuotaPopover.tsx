import {
  AlertCircle,
  MonitorUp,
  Plus,
  RefreshCw
} from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProviderQuotaListResult } from '@shared/provider-quota'
import type { KunTrayProviderQuotaApi } from '@shared/tray-provider-quota'
import { QuotaBoard, QuotaBoardSkeleton } from '../usage/QuotaBoard'
import { relativeTime } from '../usage/quota-view-model'

type TrayProviderQuotaPopoverProps = {
  api?: KunTrayProviderQuotaApi
}

/**
 * The menu-bar popover: every provider's allowance on one scrolling page,
 * each subscription's windows as bars, balances as tiles, and what needs
 * the user at the foot. A click on any figure turns every meter between used
 * and left, as in the right panel.
 */
export function TrayProviderQuotaPopover({
  api = window.kunTrayQuota
}: TrayProviderQuotaPopoverProps): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [result, setResult] = useState<ProviderQuotaListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [contextReady, setContextReady] = useState(false)

  const syncContext = useCallback(async (): Promise<void> => {
    const context = await api.context()
    document.documentElement.lang = context.locale
    document.documentElement.dataset.theme = context.colorMode
    document.documentElement.dataset.platform = context.platform
    document.documentElement.style.setProperty('--kun-dark-ui-background', context.darkUiColors.background)
    document.documentElement.style.setProperty('--kun-dark-ui-border', context.darkUiColors.border)
    document.documentElement.style.setProperty('--kun-dark-ui-panel', context.darkUiColors.panel)
    if (i18n.resolvedLanguage !== context.locale) {
      await i18n.changeLanguage(context.locale)
    }
  }, [api, i18n])

  const refresh = useCallback(async (manual = false): Promise<void> => {
    if (manual) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      setResult(await api.list())
    } catch (cause) {
      setError(cause instanceof Error && cause.message
        ? cause.message
        : i18n.t('providerQuotaLoadFailed'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [api, i18n])

  useEffect(() => {
    let active = true
    void syncContext()
      .catch(() => undefined)
      .finally(() => {
        if (active) setContextReady(true)
      })
    void refresh()
    const unsubscribe = api.onRefresh(() => {
      if (!active) return
      void syncContext().catch(() => undefined)
      void refresh()
    })
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') void api.action('close')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      active = false
      unsubscribe()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [api, refresh, syncContext])

  const busy = loading || refreshing
  const refreshedAt = result?.refreshedAt ? Date.parse(result.refreshedAt) : Number.NaN
  const updated = Number.isFinite(refreshedAt)
    ? t('usagePanelUpdated', {
        time: Date.now() - refreshedAt < 60_000
          ? t('usagePanelJustNow')
          : relativeTime(refreshedAt - Date.now(), i18n.resolvedLanguage)
      })
    : ''

  return (
    <main
      className="tray-quota-popover"
      data-context-ready={contextReady ? 'true' : 'false'}
    >
      <header className="tray-quota-header">
        <div className="tray-quota-heading-copy">
          <h1>{t('usagePanelTabQuota')}</h1>
          {updated ? <span>{updated}</span> : null}
        </div>
        <button
          type="button"
          className="kq-icon-button tray-icon-button"
          disabled={busy}
          aria-label={refreshing ? t('providerQuotaRefreshing') : t('providerQuotaRefresh')}
          title={refreshing ? t('providerQuotaRefreshing') : t('providerQuotaRefresh')}
          onClick={() => void refresh(true)}
        >
          <RefreshCw className={busy ? 'is-spinning' : ''} aria-hidden="true" />
        </button>
      </header>

      <section
        className="tray-quota-content"
        data-tray-quota-scroller
        onWheel={(event) => event.stopPropagation()}
      >
        {loading && !result ? (
          <QuotaBoardSkeleton label={t('providerQuotaLoading')} />
        ) : error && !result ? (
          <div className="tray-quota-error" role="alert">
            <AlertCircle aria-hidden="true" />
            <p>{error}</p>
          </div>
        ) : result ? (
          <>
            {error ? (
              <div className="tray-quota-error tray-quota-stale" role="alert" title={error}>
                <AlertCircle aria-hidden="true" />
                <p>{t('usagePanelStaleData')}: {error}</p>
              </div>
            ) : null}
            <QuotaBoard
              result={result}
              variant="bars"
              retrying={refreshing}
              onRetry={() => void refresh(true)}
              onOpenDashboard={(url) => void api.openExternal(url)}
              onFix={() => void api.action('open-app')}
              fixLabel={t('usagePanelOpenKun')}
              onAddProvider={() => void api.action('open-app')}
            />
          </>
        ) : null}
      </section>

      <footer className="tray-quota-footer">
        <button type="button" onClick={() => void api.action('open-app')}>
          <MonitorUp aria-hidden="true" />
          {t('usagePanelOpenKun')}
        </button>
        <button type="button" className="is-primary" onClick={() => void api.action('new-chat')}>
          <Plus aria-hidden="true" />
          {t('newChat')}
        </button>
      </footer>
    </main>
  )
}
