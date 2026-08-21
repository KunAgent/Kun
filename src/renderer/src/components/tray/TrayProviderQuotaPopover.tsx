import {
  AlertCircle,
  CircleOff,
  Clock3,
  ExternalLink,
  Gauge,
  Info,
  KeyRound,
  LayoutGrid,
  LoaderCircle,
  MonitorUp,
  Plus,
  RefreshCw
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type WheelEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ProviderQuotaEntry,
  ProviderQuotaListResult,
  ProviderQuotaMetric,
  ProviderQuotaStatus
} from '@shared/provider-quota'
import type { KunTrayProviderQuotaApi } from '@shared/tray-provider-quota'
import { ProviderIcon } from '../provider-icon'
import { ProviderLocalCostSummaryView } from '../provider-local-cost-summary'

type Selection = 'overview' | string

const STATUS_ICONS = {
  available: Gauge,
  unsupported: CircleOff,
  missing_credentials: KeyRound,
  error: AlertCircle
} satisfies Record<ProviderQuotaStatus, typeof Gauge>

const STATUS_LABEL_KEYS: Record<ProviderQuotaStatus, string> = {
  available: 'providerQuotaAvailable',
  unsupported: 'providerQuotaUnsupported',
  missing_credentials: 'providerQuotaMissingCredentials',
  error: 'providerQuotaError'
}

type TrayProviderQuotaPopoverProps = {
  api?: KunTrayProviderQuotaApi
}

function handleProviderSwitcherWheel(event: WheelEvent<HTMLElement>): void {
  const switcher = event.currentTarget
  if (switcher.scrollWidth <= switcher.clientWidth) return

  // Horizontal trackpad gestures already scroll this native overflow area.
  // Map only a conventional vertical mouse wheel so React's passive wheel
  // listener never needs preventDefault().
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.deltaY === 0) return

  const deltaScale = event.deltaMode === 1
    ? 24
    : event.deltaMode === 2
      ? switcher.clientWidth
      : 1
  switcher.scrollLeft += event.deltaY * deltaScale
}

export function TrayProviderQuotaPopover({
  api = window.kunTrayQuota
}: TrayProviderQuotaPopoverProps): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [result, setResult] = useState<ProviderQuotaListResult | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [contextReady, setContextReady] = useState(false)
  const copy = supplementalCopy(i18n.resolvedLanguage)

  const syncContext = useCallback(async (): Promise<void> => {
    const context = await api.context()
    document.documentElement.lang = context.locale
    document.documentElement.dataset.theme = context.colorMode
    document.documentElement.dataset.platform = context.platform
    if (i18n.resolvedLanguage !== context.locale) {
      await i18n.changeLanguage(context.locale)
    }
  }, [api, i18n])

  const refresh = useCallback(async (manual = false): Promise<void> => {
    if (manual) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const next = await api.list()
      setResult(next)
      setSelection((current) => {
        if (current === 'overview') return current
        if (current && next.entries.some((entry) => entry.providerId === current)) return current
        return next.entries[0]?.providerId ?? 'overview'
      })
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

  const selectedEntry = useMemo(
    () => selection && selection !== 'overview'
      ? result?.entries.find((entry) => entry.providerId === selection) ?? null
      : null,
    [result, selection]
  )

  return (
    <main
      className="tray-quota-popover"
      data-context-ready={contextReady ? 'true' : 'false'}
    >
      <section
        className="tray-quota-switcher"
        aria-label={copy.providers}
        onWheel={handleProviderSwitcherWheel}
      >
        <div className="tray-quota-tabs" role="tablist">
          <ProviderTab
            active={selection === 'overview'}
            label={copy.overview}
            status="available"
            onClick={() => setSelection('overview')}
            icon={<LayoutGrid aria-hidden="true" />}
          />
          {result?.entries.map((entry) => (
            <ProviderTab
              key={entry.providerId}
              active={selection === entry.providerId}
              label={shortProviderName(entry.providerName)}
              title={entry.providerName}
              status={entry.status}
              onClick={() => setSelection(entry.providerId)}
              icon={(
                <ProviderIcon
                  presetId={entry.presetId}
                  providerId={entry.providerId}
                  size={15}
                />
              )}
            />
          ))}
        </div>
      </section>

      <header className="tray-quota-header">
        <div className="tray-quota-heading-icon">
          {selectedEntry
            ? (
                <ProviderIcon
                  presetId={selectedEntry.presetId}
                  providerId={selectedEntry.providerId}
                  size={18}
                />
              )
            : <Gauge aria-hidden="true" />}
        </div>
        <div className="tray-quota-heading-copy">
          <div className="tray-quota-title-row">
            <h1>{selectedEntry?.providerName ?? t('providerQuotaTitle')}</h1>
            {selectedEntry ? <StatusPill status={selectedEntry.status} /> : null}
          </div>
          <p>
            {selectedEntry?.summary ||
              (selectedEntry ? selectedEntry.providerId : t('providerQuotaDescription'))}
          </p>
          {result?.refreshedAt ? (
            <span>
              {t('providerQuotaLastRefreshed', {
                time: formatQuotaDate(result.refreshedAt, i18n.resolvedLanguage)
              })}
            </span>
          ) : null}
        </div>
        <div className="tray-quota-header-actions">
          {selectedEntry?.dashboardUrl ? (
            <button
              type="button"
              className="tray-icon-button"
              aria-label={t('providerQuotaOpenDashboard', { provider: selectedEntry.providerName })}
              onClick={() => void api.openExternal(selectedEntry.dashboardUrl!)}
            >
              <ExternalLink aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="tray-icon-button"
            disabled={loading || refreshing}
            aria-label={refreshing ? t('providerQuotaRefreshing') : t('providerQuotaRefresh')}
            onClick={() => void refresh(true)}
          >
            <RefreshCw className={loading || refreshing ? 'is-spinning' : ''} aria-hidden="true" />
          </button>
        </div>
      </header>

      <section
        className="tray-quota-content"
        data-tray-quota-scroller
        onWheel={(event) => event.stopPropagation()}
      >
        {loading && !result ? (
          <div className="tray-quota-state" role="status">
            <LoaderCircle className="is-spinning" aria-hidden="true" />
            <p>{t('providerQuotaLoading')}</p>
          </div>
        ) : error && !result ? (
          <div className="tray-quota-error" role="alert">
            <AlertCircle aria-hidden="true" />
            <p>{error}</p>
          </div>
        ) : result && result.entries.length === 0 ? (
          <div className="tray-quota-state">
            <CircleOff aria-hidden="true" />
            <strong>{t('providerQuotaEmpty')}</strong>
            <p>{t('providerQuotaEmptyHint')}</p>
          </div>
        ) : (
          <>
            {error ? (
              <div className="tray-quota-error tray-quota-stale" role="alert">
                <AlertCircle aria-hidden="true" />
                <p>{copy.stale}: {error}</p>
              </div>
            ) : null}
            {selection === 'overview' || !selectedEntry ? (
              <QuotaOverview
                entries={result?.entries ?? []}
                locale={i18n.resolvedLanguage}
                onSelect={setSelection}
              />
            ) : (
              <ProviderQuotaDetails
                entry={selectedEntry}
                locale={i18n.resolvedLanguage}
                onOpenDashboard={(url) => void api.openExternal(url)}
              />
            )}
          </>
        )}
      </section>

      <footer className="tray-quota-footer">
        <button type="button" onClick={() => void api.action('open-app')}>
          <MonitorUp aria-hidden="true" />
          {copy.openKun}
        </button>
        <button type="button" className="is-primary" onClick={() => void api.action('new-chat')}>
          <Plus aria-hidden="true" />
          {t('newChat')}
        </button>
      </footer>
    </main>
  )
}

function ProviderTab({
  active,
  label,
  title,
  status,
  onClick,
  icon
}: {
  active: boolean
  label: string
  title?: string
  status: ProviderQuotaStatus
  onClick: () => void
  icon: ReactElement
}): ReactElement {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`tray-provider-tab ${active ? 'is-active' : ''}`}
      title={title}
      data-status={status}
      onClick={onClick}
    >
      <span className="tray-provider-tab-icon">{icon}</span>
      <span className="tray-provider-tab-label">{label}</span>
    </button>
  )
}

function QuotaOverview({
  entries,
  locale,
  onSelect
}: {
  entries: ProviderQuotaEntry[]
  locale?: string
  onSelect: (selection: Selection) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="tray-quota-overview">
      {entries.map((entry) => {
        const StatusIcon = STATUS_ICONS[entry.status]
        return (
          <button
            type="button"
            className="tray-quota-provider-card"
            key={entry.providerId}
            aria-label={`${entry.providerName}: ${t(STATUS_LABEL_KEYS[entry.status])}`}
            onClick={() => onSelect(entry.providerId)}
          >
            <div className="tray-quota-provider-card-title">
              <span className="tray-provider-card-monogram">
                <ProviderIcon
                  presetId={entry.presetId}
                  providerId={entry.providerId}
                  size={16}
                />
              </span>
              <span>
                <strong>{entry.providerName}</strong>
                <small>{entry.providerId}</small>
              </span>
              <StatusIcon className={`status-${entry.status}`} aria-hidden="true" />
            </div>
            {entry.status === 'available' && entry.metrics.length > 0 ? (
              <div className="tray-quota-overview-metrics">
                {entry.metrics.slice(0, 2).map((metric) => (
                  <div key={metric.id}>
                    <small>{metric.label}</small>
                    <strong>{metricSummary(metric, locale)}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p>
                {entry.message ||
                  (entry.status === 'unsupported'
                    ? t('providerQuotaUnsupportedHint')
                    : t(STATUS_LABEL_KEYS[entry.status]))}
              </p>
            )}
            {entry.localCost ? (
              <ProviderLocalCostSummaryView
                summary={entry.localCost}
                locale={locale}
                variant="tray-overview"
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

function ProviderQuotaDetails({
  entry,
  locale,
  onOpenDashboard
}: {
  entry: ProviderQuotaEntry
  locale?: string
  onOpenDashboard: (url: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  if (entry.status !== 'available') {
    const StatusIcon = STATUS_ICONS[entry.status]
    return (
      <div className="tray-quota-details">
        <div className={`tray-quota-state tray-quota-state-${entry.status} ${entry.localCost ? 'has-local-cost' : ''}`}>
          <StatusIcon aria-hidden="true" />
          <strong>{t(STATUS_LABEL_KEYS[entry.status])}</strong>
          <p>
            {entry.message ||
              (entry.status === 'unsupported'
                ? t('providerQuotaUnsupportedHint')
                : entry.status === 'missing_credentials'
                  ? t('providerQuotaMissingCredentialsHint')
                  : t('providerQuotaLoadFailed'))}
          </p>
          {entry.dashboardUrl ? (
            <button
              type="button"
              className="tray-quota-dashboard-button"
              onClick={() => onOpenDashboard(entry.dashboardUrl!)}
            >
              <ExternalLink aria-hidden="true" />
              {t('providerQuotaOpenDashboard', { provider: entry.providerName })}
            </button>
          ) : null}
        </div>
        {entry.localCost ? (
          <ProviderLocalCostSummaryView
            summary={entry.localCost}
            locale={locale}
            variant="tray"
          />
        ) : null}
      </div>
    )
  }

  return (
    <div className="tray-quota-details">
      {entry.metrics.length > 0 ? (
        entry.metrics.map((metric) => (
          <QuotaMetricDetail key={metric.id} metric={metric} locale={locale} />
        ))
      ) : (
        <div className="tray-quota-state">
          <CircleOff aria-hidden="true" />
          <p>{t('providerQuotaNoMetrics')}</p>
        </div>
      )}
      {entry.localCost ? (
        <ProviderLocalCostSummaryView
          summary={entry.localCost}
          locale={locale}
          variant="tray"
        />
      ) : null}
      <div className="tray-quota-source">
        <span>
          {entry.source || t('providerQuotaUnsupportedSource')}
          <Info aria-hidden="true" />
        </span>
        {entry.updatedAt ? (
          <span>
            {t('providerQuotaUpdated', { time: formatQuotaDate(entry.updatedAt, locale) })}
          </span>
        ) : null}
      </div>
    </div>
  )
}

function QuotaMetricDetail({
  metric,
  locale
}: {
  metric: ProviderQuotaMetric
  locale?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const values = [
    metric.remaining === undefined
      ? null
      : { label: t('providerQuotaRemaining'), value: metric.remaining },
    metric.used === undefined
      ? null
      : { label: t('providerQuotaUsed'), value: metric.used },
    metric.limit === undefined
      ? null
      : { label: t('providerQuotaLimit'), value: metric.limit }
  ].filter((value): value is { label: string; value: number } => value !== null)

  return (
    <article className="tray-quota-metric">
      <div className="tray-quota-metric-heading">
        <h2>{metric.label}</h2>
        {metric.usedPercent !== undefined ? (
          <strong>{Math.round(metric.usedPercent)}% {t('providerQuotaUsed')}</strong>
        ) : metric.remaining !== undefined ? (
          <strong>{formatQuotaValue(metric.remaining, metric.unit, locale)}</strong>
        ) : null}
      </div>
      {metric.usedPercent !== undefined ? (
        <div
          className="tray-quota-progress"
          role="progressbar"
          aria-label={metric.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(metric.usedPercent)}
        >
          <span style={{ width: `${clampPercent(metric.usedPercent)}%` }} />
        </div>
      ) : null}
      {values.length > 0 ? (
        <dl className="tray-quota-values">
          {values.map((value) => (
            <div key={value.label}>
              <dt>{value.label}</dt>
              <dd>{formatQuotaValue(value.value, metric.unit, locale)}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {metric.resetsAt ? (
        <p className="tray-quota-reset">
          <Clock3 aria-hidden="true" />
          {t('providerQuotaResetsAt', { time: formatQuotaDate(metric.resetsAt, locale) })}
        </p>
      ) : null}
    </article>
  )
}

function StatusPill({ status }: { status: ProviderQuotaStatus }): ReactElement {
  const { t } = useTranslation('common')
  const Icon = STATUS_ICONS[status]
  return (
    <span className="tray-quota-status" data-status={status}>
      <Icon aria-hidden="true" />
      {t(STATUS_LABEL_KEYS[status])}
    </span>
  )
}

export function formatQuotaValue(value: number, unit: string, locale?: string): string {
  const compact = Math.abs(value) >= 100_000
  const formatted = new Intl.NumberFormat(locale, {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 4
  }).format(value)
  return `${formatted} ${unit}`.trim()
}

function metricSummary(metric: ProviderQuotaMetric, locale?: string): string {
  if (metric.remaining !== undefined) return formatQuotaValue(metric.remaining, metric.unit, locale)
  if (metric.usedPercent !== undefined) return `${Math.round(metric.usedPercent)}%`
  if (metric.limit !== undefined) return formatQuotaValue(metric.limit, metric.unit, locale)
  if (metric.used !== undefined) return formatQuotaValue(metric.used, metric.unit, locale)
  return '—'
}

function formatQuotaDate(value: string, locale?: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

function shortProviderName(name: string): string {
  const trimmed = name.trim()
  return trimmed.length > 9 ? `${trimmed.slice(0, 8)}…` : trimmed
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

function supplementalCopy(locale?: string): {
  overview: string
  providers: string
  openKun: string
  stale: string
} {
  if (locale?.startsWith('zh')) {
    return {
      overview: '概览',
      providers: '供应商',
      openKun: '打开 Kun',
      stale: '显示的是上次成功刷新的数据'
    }
  }
  return {
    overview: 'Overview',
    providers: 'Providers',
    openKun: 'Open Kun',
    stale: 'Showing the last successful refresh'
  }
}
