import { Gauge, Loader2, RefreshCw } from 'lucide-react'
import { useCallback, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ProviderQuotaPanel,
  type ProviderQuotaPanelStatus
} from './ProviderQuotaPanel'
import {
  SidebarUsagePanel,
  type SidebarUsagePanelStatus
} from './SidebarUsagePanel'

type UsageQuotaTab = 'usage' | 'quota'

type Props = {
  activeThreadId: string | null
  active?: boolean
}

type TabStatus = {
  loading: boolean
  refreshedAt?: string
}

const EMPTY_STATUS: TabStatus = { loading: false }

export function UsageQuotaPanel({ activeThreadId, active = true }: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [activeTab, setActiveTab] = useState<UsageQuotaTab>('usage')
  const [usageRefreshKey, setUsageRefreshKey] = useState(0)
  const [quotaRefreshKey, setQuotaRefreshKey] = useState(0)
  const [usageStatus, setUsageStatus] = useState<TabStatus>(EMPTY_STATUS)
  const [quotaStatus, setQuotaStatus] = useState<TabStatus>(EMPTY_STATUS)
  const activeStatus = activeTab === 'usage' ? usageStatus : quotaStatus

  const handleUsageStatus = useCallback((status: SidebarUsagePanelStatus): void => {
    setUsageStatus(status)
  }, [])
  const handleQuotaStatus = useCallback((status: ProviderQuotaPanelStatus): void => {
    setQuotaStatus(status)
  }, [])

  const refresh = (): void => {
    if (activeTab === 'usage') setUsageRefreshKey((value) => value + 1)
    else setQuotaRefreshKey((value) => value + 1)
  }

  return (
    <section
      aria-label={t('usageQuotaTitle')}
      className="usage-quota-panel ds-no-drag"
      data-usage-quota-panel
    >
      <header className="usage-quota-header">
        <div className="usage-quota-heading">
          <div className="usage-quota-heading-icon">
            <Gauge aria-hidden="true" strokeWidth={1.8} />
          </div>
          <div className="usage-quota-heading-copy">
            <h2>{t('usageQuotaTitle')}</h2>
            <p>{t('usageQuotaDescription')}</p>
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={activeStatus.loading}
            className="usage-quota-refresh"
            data-loading={activeStatus.loading ? 'true' : 'false'}
            aria-label={t(activeStatus.loading ? 'usageQuotaRefreshing' : 'usageQuotaRefresh')}
            title={t(activeStatus.loading ? 'usageQuotaRefreshing' : 'usageQuotaRefresh')}
          >
            {activeStatus.loading ? (
              <Loader2 className="animate-spin" aria-hidden="true" strokeWidth={1.9} />
            ) : (
              <RefreshCw aria-hidden="true" strokeWidth={1.9} />
            )}
            <span className="usage-quota-refresh-label">
              {t(activeStatus.loading ? 'usageQuotaRefreshing' : 'usageQuotaRefresh')}
            </span>
          </button>
        </div>
        {activeStatus.refreshedAt ? (
          <p className="usage-quota-refreshed-at">
            {t('usageQuotaLastRefreshed', {
              time: formatRefreshTime(activeStatus.refreshedAt, i18n.resolvedLanguage)
            })}
          </p>
        ) : null}
        <div
          role="tablist"
          aria-label={t('usageQuotaTitle')}
          className="usage-quota-tabs"
        >
          <TabButton
            active={activeTab === 'usage'}
            id="usage"
            label={t('usageQuotaTabUsage')}
            onClick={() => setActiveTab('usage')}
          />
          <TabButton
            active={activeTab === 'quota'}
            id="quota"
            label={t('usageQuotaTabQuota')}
            onClick={() => setActiveTab('quota')}
          />
        </div>
      </header>

      <div
        id={`usage-quota-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`usage-quota-tab-${activeTab}`}
        className="usage-quota-body"
      >
        {activeTab === 'usage' ? (
          <SidebarUsagePanel
            activeThreadId={activeThreadId}
            enabled={active}
            refreshKey={usageRefreshKey}
            onStatusChange={handleUsageStatus}
          />
        ) : (
          <ProviderQuotaPanel
            embedded
            refreshKey={quotaRefreshKey}
            onStatusChange={handleQuotaStatus}
          />
        )}
      </div>
    </section>
  )
}

function TabButton({
  active,
  id,
  label,
  onClick
}: {
  active: boolean
  id: UsageQuotaTab
  label: string
  onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      id={`usage-quota-tab-${id}`}
      role="tab"
      aria-selected={active}
      aria-controls={`usage-quota-panel-${id}`}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className="usage-quota-tab"
      data-active={active ? 'true' : 'false'}
    >
      {label}
    </button>
  )
}

function formatRefreshTime(value: string, locale?: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}
