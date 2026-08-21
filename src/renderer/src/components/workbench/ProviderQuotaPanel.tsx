import {
  AlertCircle,
  ChevronRight,
  CircleOff,
  ExternalLink,
  Gauge,
  KeyRound,
  Loader2,
  RefreshCw
} from 'lucide-react'
import { useCallback, useEffect, useId, useState, type ReactElement } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type {
  ProviderQuotaEntry,
  ProviderQuotaListResult,
  ProviderQuotaMetric,
  ProviderQuotaStatus
} from '@shared/provider-quota'
import { ProviderIcon } from '../provider-icon'
import {
  formatProviderLocalCostAmount,
  ProviderLocalCostSummaryView
} from '../provider-local-cost-summary'

type StatusPresentation = {
  labelKey: string
  className: string
  icon: typeof Gauge
}

type UnavailableProviderQuotaStatus = Exclude<ProviderQuotaStatus, 'available'>

const UNAVAILABLE_STATUS_ORDER: UnavailableProviderQuotaStatus[] = [
  'missing_credentials',
  'error',
  'unsupported'
]

const STATUS_PRESENTATION: Record<ProviderQuotaStatus, StatusPresentation> = {
  available: {
    labelKey: 'providerQuotaAvailable',
    className: 'is-success',
    icon: Gauge
  },
  unsupported: {
    labelKey: 'providerQuotaUnsupported',
    className: 'is-neutral',
    icon: CircleOff
  },
  missing_credentials: {
    labelKey: 'providerQuotaMissingCredentials',
    className: 'is-warning',
    icon: KeyRound
  },
  error: {
    labelKey: 'providerQuotaError',
    className: 'is-danger',
    icon: AlertCircle
  }
}

export type ProviderQuotaPanelStatus = {
  loading: boolean
  refreshedAt?: string
}

export type ProviderQuotaPanelProps = {
  embedded?: boolean
  refreshKey?: unknown
  onStatusChange?: (status: ProviderQuotaPanelStatus) => void
}

export function ProviderQuotaPanel({
  embedded = false,
  refreshKey,
  onStatusChange
}: ProviderQuotaPanelProps = {}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [result, setResult] = useState<ProviderQuotaListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const primaryEntries = result?.entries.filter(
    (entry) => entry.status === 'available' || entry.localCost !== undefined
  ) ?? []
  const unavailableEntries = result?.entries.filter(
    (entry) => entry.status !== 'available' && entry.localCost === undefined
  ) ?? []

  const refresh = useCallback(async (manual = false): Promise<void> => {
    if (manual) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      if (typeof window.kunGui?.listProviderQuotas !== 'function') {
        throw new Error(t('providerQuotaUnavailable'))
      }
      setResult(await window.kunGui.listProviderQuotas())
    } catch (cause) {
      setError(cause instanceof Error && cause.message
        ? cause.message
        : t('providerQuotaLoadFailed'))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [t])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  useEffect(() => {
    onStatusChange?.({
      loading: loading || refreshing,
      ...(result?.refreshedAt ? { refreshedAt: result.refreshedAt } : {})
    })
  }, [loading, onStatusChange, refreshing, result?.refreshedAt])

  const openDashboard = (url: string): void => {
    if (typeof window.kunGui?.openExternal === 'function') {
      void window.kunGui.openExternal(url)
    }
  }

  return (
    <section
      aria-label={t('providerQuotaTitle')}
      className={`provider-quota-panel ds-no-drag ${embedded ? 'is-embedded' : ''}`}
      data-provider-quota-panel
      data-embedded={embedded ? 'true' : 'false'}
    >
      {!embedded ? <header className="provider-quota-header">
        <div className="provider-quota-heading">
          <div className="provider-quota-heading-icon">
            <Gauge aria-hidden="true" strokeWidth={1.8} />
          </div>
          <div className="provider-quota-heading-copy">
            <h2>{t('providerQuotaTitle')}</h2>
            <p>{t('providerQuotaDescription')}</p>
          </div>
          <button
            type="button"
            onClick={() => void refresh(true)}
            disabled={loading || refreshing}
            className="provider-quota-refresh"
            data-loading={loading || refreshing ? 'true' : 'false'}
            aria-label={refreshing ? t('providerQuotaRefreshing') : t('providerQuotaRefresh')}
            title={refreshing ? t('providerQuotaRefreshing') : t('providerQuotaRefresh')}
          >
            <RefreshCw
              className={loading || refreshing ? 'animate-spin' : ''}
              aria-hidden="true"
              strokeWidth={1.9}
            />
            <span className="provider-quota-refresh-label">
              {t(refreshing ? 'providerQuotaRefreshing' : 'providerQuotaRefresh')}
            </span>
          </button>
        </div>
        {result?.refreshedAt ? (
          <p className="provider-quota-refreshed-at">
            {t('providerQuotaLastRefreshed', {
              time: formatQuotaDate(result.refreshedAt, i18n.resolvedLanguage)
            })}
          </p>
        ) : null}
      </header> : null}

      <div
        data-provider-quota-scroller
        className="provider-quota-scroller h-0 min-h-0 flex-1 touch-pan-y overscroll-contain overflow-y-auto overflow-x-hidden"
        onWheel={(event) => event.stopPropagation()}
      >
        {loading && !result ? (
          <div role="status" className="provider-quota-state">
            <Loader2 className="animate-spin" aria-hidden="true" strokeWidth={1.8} />
            <p>{t('providerQuotaLoading')}</p>
          </div>
        ) : error && !result ? (
          <div role="alert" className="provider-quota-error">
            <div>
              <AlertCircle aria-hidden="true" strokeWidth={1.8} />
              <span>{error}</span>
            </div>
          </div>
        ) : result && result.entries.length === 0 ? (
          <div className="provider-quota-state provider-quota-empty">
            <CircleOff aria-hidden="true" strokeWidth={1.6} />
            <strong>{t('providerQuotaEmpty')}</strong>
            <p>{t('providerQuotaEmptyHint')}</p>
          </div>
        ) : (
          <div className="provider-quota-list">
            {error ? (
              <div role="alert" className="provider-quota-inline-error">
                {error}
              </div>
            ) : null}
            {primaryEntries.map((entry) => (
              <ProviderQuotaCard
                key={entry.providerId}
                entry={entry}
                locale={i18n.resolvedLanguage}
                onOpenDashboard={openDashboard}
              />
            ))}
            {UNAVAILABLE_STATUS_ORDER.map((status) => {
              const entries = unavailableEntries.filter((entry) => entry.status === status)
              return entries.length > 0 ? (
                <UnavailableProviderGroup
                  key={status}
                  status={status}
                  entries={entries}
                  locale={i18n.resolvedLanguage}
                  onOpenDashboard={openDashboard}
                />
              ) : null
            })}
          </div>
        )}
      </div>
    </section>
  )
}

function UnavailableProviderGroup({
  status,
  entries,
  locale,
  onOpenDashboard
}: {
  status: UnavailableProviderQuotaStatus
  entries: ProviderQuotaEntry[]
  locale?: string
  onOpenDashboard: (url: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const presentation = STATUS_PRESENTATION[status]
  const StatusIcon = presentation.icon
  const statusLabel = t(presentation.labelKey)

  return (
    <section
      data-provider-quota-status-group={status}
      className="provider-quota-status-group"
    >
      <button
        type="button"
        data-provider-quota-status-group-toggle={status}
        aria-expanded={expanded}
        aria-controls={detailsId}
        aria-label={t(
          expanded ? 'providerQuotaCollapseStatusGroup' : 'providerQuotaExpandStatusGroup',
          { status: statusLabel, count: entries.length }
        )}
        onClick={() => setExpanded((value) => !value)}
        className="provider-quota-status-group-toggle"
      >
        <ChevronRight
          aria-hidden="true"
          className="provider-quota-chevron"
          data-expanded={expanded ? 'true' : 'false'}
          strokeWidth={1.9}
        />
        <span className={`provider-quota-status-icon ${presentation.className}`}>
          <StatusIcon aria-hidden="true" strokeWidth={2} />
        </span>
        <span className="provider-quota-status-group-label">
          {statusLabel}
        </span>
        <span className="provider-quota-status-count">
          {entries.length}
        </span>
      </button>

      {expanded ? (
        <div
          id={detailsId}
          data-provider-quota-status-group-details={status}
          className="provider-quota-status-group-details"
        >
          {entries.map((entry) => (
            <ProviderQuotaCard
              key={entry.providerId}
              entry={entry}
              locale={locale}
              onOpenDashboard={onOpenDashboard}
            />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function ProviderQuotaCard({
  entry,
  locale,
  onOpenDashboard
}: {
  entry: ProviderQuotaEntry
  locale?: string
  onOpenDashboard: (url: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const presentation = STATUS_PRESENTATION[entry.status]
  const StatusIcon = presentation.icon
  const compactSummary = providerQuotaCompactSummary(entry, locale, t)
  return (
    <article
      data-provider-quota-status={entry.status}
      className="provider-quota-card"
    >
      <div className="provider-quota-card-row">
        <button
          type="button"
          data-provider-quota-toggle={entry.providerId}
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={t(
            expanded ? 'providerQuotaCollapseDetails' : 'providerQuotaExpandDetails',
            { provider: entry.providerName }
          )}
          onClick={() => setExpanded((value) => !value)}
          className="provider-quota-card-toggle"
        >
          <ChevronRight
            aria-hidden="true"
            className="provider-quota-chevron"
            data-expanded={expanded ? 'true' : 'false'}
            strokeWidth={1.9}
          />
          <span className="provider-quota-monogram">
            <ProviderIcon
              presetId={entry.presetId}
              providerId={entry.providerId}
              size={17}
            />
          </span>
          <div className="provider-quota-card-copy">
            <div className="provider-quota-card-title">
              <h3
                title={entry.providerName}
              >
                {entry.providerName}
              </h3>
              <span
                className={`provider-quota-status-pill ${presentation.className}`}
                title={t(presentation.labelKey)}
              >
                <StatusIcon aria-hidden="true" strokeWidth={2} />
                <span>{t(presentation.labelKey)}</span>
              </span>
            </div>
            <div className="provider-quota-card-meta">
              <p className="provider-quota-provider-id">{entry.providerId}</p>
              <span aria-hidden="true">·</span>
              <p title={compactSummary} className="provider-quota-compact-summary">
                {compactSummary}
              </p>
            </div>
          </div>
        </button>
        {entry.dashboardUrl ? (
          <button
            type="button"
            onClick={() => onOpenDashboard(entry.dashboardUrl!)}
            className="provider-quota-dashboard"
            aria-label={t('providerQuotaOpenDashboard', { provider: entry.providerName })}
          >
            <ExternalLink aria-hidden="true" strokeWidth={1.8} />
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div
          id={detailsId}
          data-provider-quota-details={entry.providerId}
          className="provider-quota-details"
        >
          {entry.summary ? (
            <p className="provider-quota-summary">{entry.summary}</p>
          ) : null}

          {entry.localCost ? (
            <ProviderLocalCostSummaryView
              summary={entry.localCost}
              locale={locale}
              variant="workbench"
            />
          ) : null}

          {entry.status === 'available' ? (
            entry.metrics.length > 0 ? (
              <div className={`provider-quota-metrics ${entry.summary ? 'has-summary' : ''}`}>
                {entry.metrics.map((metric) => (
                  <QuotaMetric key={metric.id} metric={metric} locale={locale} />
                ))}
              </div>
            ) : (
              <p className="provider-quota-detail-message">{t('providerQuotaNoMetrics')}</p>
            )
          ) : (
            <p className="provider-quota-detail-message">
              {entry.status === 'unsupported'
                ? t('providerQuotaUnsupportedHint')
                : entry.status === 'missing_credentials'
                  ? entry.message || t('providerQuotaMissingCredentialsHint')
                  : entry.message || t(presentation.labelKey)}
              </p>
          )}

          <div className="provider-quota-source">
            <span>{entry.source || t('providerQuotaUnsupportedSource')}</span>
            {entry.updatedAt ? (
              <span>{t('providerQuotaUpdated', {
                time: formatQuotaDate(entry.updatedAt, locale)
              })}</span>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  )
}

function providerQuotaCompactSummary(
  entry: ProviderQuotaEntry,
  locale: string | undefined,
  t: TFunction
): string {
  if (entry.status !== 'available') {
    if (entry.localCost) {
      const today = entry.localCost.today
      const amount = today.amount === null || today.coverage === 'unavailable'
        ? t('providerQuotaLocalCostUnavailable')
        : formatProviderLocalCostAmount(today.amount, locale)
      return `${t('providerQuotaLocalCostToday')}: ${amount}`
    }
    if (entry.message) return entry.message
    if (entry.status === 'unsupported') return t('providerQuotaUnsupportedHint')
    if (entry.status === 'missing_credentials') return t('providerQuotaMissingCredentialsHint')
    return t('providerQuotaError')
  }

  const metric = entry.metrics[0]
  if (metric) {
    if (metric.remaining !== undefined) {
      return `${formatQuotaValue(metric.remaining, metric.unit, locale)} ${t('providerQuotaRemaining')}`
    }
    if (metric.usedPercent !== undefined) {
      return `${Math.round(clampPercent(metric.usedPercent))}% ${t('providerQuotaUsed')}`
    }
    if (metric.used !== undefined && metric.limit !== undefined) {
      return `${formatQuotaValue(metric.used, metric.unit, locale)} / ${
        formatQuotaValue(metric.limit, metric.unit, locale)
      }`
    }
    if (metric.used !== undefined) {
      return `${formatQuotaValue(metric.used, metric.unit, locale)} ${t('providerQuotaUsed')}`
    }
    if (metric.limit !== undefined) {
      return `${formatQuotaValue(metric.limit, metric.unit, locale)} ${t('providerQuotaLimit')}`
    }
  }
  return entry.summary || t('providerQuotaNoMetrics')
}

function QuotaMetric({
  metric,
  locale
}: {
  metric: ProviderQuotaMetric
  locale?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const usedPercent = metric.usedPercent === undefined
    ? undefined
    : clampPercent(metric.usedPercent)
  const usageLevel = usedPercent === undefined
    ? undefined
    : usedPercent >= 90
      ? 'danger'
      : usedPercent >= 75
        ? 'warning'
        : 'neutral'
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
  ].filter((item): item is { label: string; value: number } => item !== null)

  return (
    <div
      className="provider-quota-metric"
      data-provider-quota-metric={metric.id}
    >
      <div className="provider-quota-metric-heading">
        <h4>{metric.label}</h4>
        {usedPercent !== undefined ? (
          <span>
            {Math.round(usedPercent)}%
          </span>
        ) : null}
      </div>
      {usedPercent !== undefined ? (
        <div
          role="progressbar"
          aria-label={metric.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(usedPercent)}
          className="provider-quota-progress"
        >
          <span
            className="provider-quota-progress-fill"
            data-level={usageLevel}
            style={{ width: `${usedPercent}%` }}
          />
        </div>
      ) : null}
      {values.length > 0 ? (
        <dl className="provider-quota-values" data-count={values.length}>
          {values.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>
                {formatQuotaValue(item.value, metric.unit, locale)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {metric.resetsAt ? (
        <p className="provider-quota-reset">
          {t('providerQuotaResetsAt', { time: formatQuotaDate(metric.resetsAt, locale) })}
        </p>
      ) : null}
    </div>
  )
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, value))
}

export function formatQuotaValue(value: number, unit: string, locale?: string): string {
  const compact = Math.abs(value) >= 100_000
  const formatted = new Intl.NumberFormat(locale, {
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 4
  }).format(value)
  return `${formatted} ${unit}`
}

function formatQuotaDate(value: string, locale?: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}
