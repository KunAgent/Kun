import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { relativeTime } from '../usage/quota-view-model'
import {
  ProviderQuotaPanel,
  type ProviderQuotaPanelStatus
} from './ProviderQuotaPanel'
import {
  SidebarUsagePanel,
  type SidebarUsagePanelStatus
} from './SidebarUsagePanel'

type UsageQuotaTab = 'quota' | 'usage'

const TABS: UsageQuotaTab[] = ['quota', 'usage']
const TAB_KEY = 'kun.usagePanel.tab'

type Props = {
  activeThreadId: string | null
  active?: boolean
}

type TabStatus = {
  loading: boolean
  refreshedAt?: string
}

const EMPTY_STATUS: TabStatus = { loading: false }

function readTab(): UsageQuotaTab {
  try {
    return window.localStorage.getItem(TAB_KEY) === 'usage' ? 'usage' : 'quota'
  } catch {
    return 'quota'
  }
}

/** Re-renders every half minute so "updated 2 min ago" keeps counting. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

export function UsageQuotaPanel({ activeThreadId, active = true }: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const [activeTab, setActiveTab] = useState<UsageQuotaTab>(readTab)
  const [usageRefreshKey, setUsageRefreshKey] = useState(0)
  const [quotaRefreshKey, setQuotaRefreshKey] = useState(0)
  const [usageStatus, setUsageStatus] = useState<TabStatus>(EMPTY_STATUS)
  const [quotaStatus, setQuotaStatus] = useState<TabStatus>(EMPTY_STATUS)
  const activeStatus = activeTab === 'usage' ? usageStatus : quotaStatus
  const now = useNow()

  const handleUsageStatus = useCallback((status: SidebarUsagePanelStatus): void => setUsageStatus(status), [])
  const handleQuotaStatus = useCallback((status: ProviderQuotaPanelStatus): void => setQuotaStatus(status), [])

  const selectTab = (tab: UsageQuotaTab): void => {
    setActiveTab(tab)
    try {
      window.localStorage.setItem(TAB_KEY, tab)
    } catch {
      // Remembered for this session only.
    }
  }
  const refresh = (): void => {
    if (activeTab === 'usage') setUsageRefreshKey((value) => value + 1)
    else setQuotaRefreshKey((value) => value + 1)
  }
  const refreshLabel = t(activeStatus.loading ? 'usageQuotaRefreshing' : 'usageQuotaRefresh')
  const updated = activeStatus.refreshedAt ? Date.parse(activeStatus.refreshedAt) : Number.NaN

  return (
    <section
      aria-label={t('usagePanelTitle')}
      className="usage-quota-panel ds-no-drag"
      data-usage-quota-panel
    >
      <header className="usage-quota-header">
        <div className="usage-quota-heading">
          <div
            role="tablist"
            aria-label={t('usagePanelTitle')}
            className="kq-seg usage-quota-tabs"
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              selectTab(activeTab === 'quota' ? 'usage' : 'quota')
            }}
          >
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                id={`usage-quota-tab-${tab}`}
                role="tab"
                aria-selected={activeTab === tab}
                aria-controls={`usage-quota-panel-${tab}`}
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => selectTab(tab)}
                className="usage-quota-tab"
                data-active={activeTab === tab ? 'true' : 'false'}
              >
                {t(tab === 'quota' ? 'usagePanelTabQuota' : 'usagePanelTabUsage')}
              </button>
            ))}
          </div>
          <span className="kq-grow" />
          {Number.isFinite(updated) ? (
            <span
              className="usage-quota-refreshed-at"
              title={new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: 'medium', timeStyle: 'short' }).format(updated)}
            >
              {t('usagePanelUpdated', {
                time: now - updated < 60_000 ? t('usagePanelJustNow') : relativeTime(updated - now, i18n.resolvedLanguage)
              })}
            </span>
          ) : null}
          <button
            type="button"
            onClick={refresh}
            disabled={activeStatus.loading}
            className="kq-icon-button usage-quota-refresh"
            data-loading={activeStatus.loading ? 'true' : 'false'}
            aria-label={refreshLabel}
            title={refreshLabel}
          >
            <RefreshCw className={activeStatus.loading ? 'kq-spin' : undefined} aria-hidden="true" strokeWidth={1.9} />
          </button>
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
            active={active}
            refreshKey={quotaRefreshKey}
            onStatusChange={handleQuotaStatus}
          />
        )}
      </div>
    </section>
  )
}
