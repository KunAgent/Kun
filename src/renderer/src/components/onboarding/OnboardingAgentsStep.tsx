import { useEffect, useState, type ReactElement } from 'react'
import { Check, RotateCw, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { getProvider } from '../../agent/registry'
import { loadHarnesses, useHarnessStore } from '../../store/harness-store'
import { AgentIcon } from '../agent-icon'
import { OnboardingAgentCard } from './OnboardingAgentCard'
import {
  enqueueOnboardingAgent,
  onboardingAgentLists,
  onboardingAgentStatus,
  settleOnboardingAgent
} from './onboarding-agents'

export function OnboardingAgentsStep({ settings, patch, beforeCheck }: {
  settings: KunHarnessSettingsV1
  patch: (patch: Partial<KunHarnessSettingsV1>) => void
  beforeCheck: () => Promise<boolean>
}): ReactElement {
  const { t } = useTranslation('settings')
  const rows = useHarnessStore((state) => state.rows)
  const rowsLoading = useHarnessStore((state) => state.rowsLoading)
  const rowsError = useHarnessStore((state) => state.rowsError)
  const [slot, setSlot] = useState<{ queue: string[]; active: string | null }>({ queue: [], active: null })
  const [rescanning, setRescanning] = useState(false)
  const platform = typeof window === 'undefined' ? 'darwin' : window.kunGui?.platform ?? 'darwin'

  useEffect(() => {
    // Detection is cached by the runtime; a short wait lets an inflight pass settle.
    void loadHarnesses(true, { waitMs: 3_000 })
  }, [])

  const lists = onboardingAgentLists(rows, settings)
  const scanning = rescanning || (rows.length === 0 && rowsLoading) || (lists.installed.length === 0 && lists.detecting)
  const failedToList = !scanning && rows.length === 0 && Boolean(rowsError)
  const statuses = lists.installed.map((row) => onboardingAgentStatus(row, settings))
  const connected = statuses.filter((status) => status === 'connected').length
  const needLogin = statuses.filter((status) => status === 'login').length
  const connectable = lists.installed.filter((row, index) => statuses[index] === 'ready' &&
    slot.active !== row.definition.id && !slot.queue.includes(row.definition.id))

  const connect = (id: string): void => setSlot((current) => enqueueOnboardingAgent(current.queue, current.active, id))
  const settle = (id: string): void => setSlot((current) => settleOnboardingAgent(current.queue, current.active, id))

  const rescan = async (): Promise<void> => {
    setRescanning(true)
    try {
      const probe = getProvider().probeHarness
      if (probe) {
        await Promise.allSettled(lists.installed
          .filter((row, index) => statuses[index] !== 'connected')
          .map((row) => probe(row.definition.id)))
      }
      await loadHarnesses(true, { waitMs: 3_000 })
    } finally {
      setRescanning(false)
    }
  }

  const scanTitle = scanning
    ? t('onboarding.agents.scanning')
    : failedToList
      ? t('onboarding.agents.listFailed')
      : lists.installed.length
        ? t('onboarding.agents.found', { count: lists.installed.length })
        : t('onboarding.agents.none')
  const scanDetail = scanning
    ? t('onboarding.agents.scanningHint')
    : failedToList
      ? rowsError
      : [t('onboarding.agents.connectedCount', { count: connected }),
          ...(needLogin ? [t('onboarding.agents.loginCount', { count: needLogin })] : [])].join(' · ')

  return (
    <>
      <div className="kun-onb-scan" aria-live="polite">
        <span className="kun-onb-radar" data-done={scanning ? undefined : 'true'} aria-hidden="true">
          {scanning
            ? <><span className="kun-onb-radar-sweep" /><span className="kun-onb-radar-core" /></>
            : <Check size={16} strokeWidth={2.4} />}
        </span>
        <span className="kun-onb-scan-text"><b>{scanTitle}</b><span>{scanDetail}</span></span>
        <button type="button" className="kun-onb-btn" disabled={scanning} onClick={() => { void rescan() }} data-onboarding-agents-rescan>
          <RotateCw size={14} strokeWidth={2} aria-hidden="true" />{t('onboarding.agents.rescan')}
        </button>
        {lists.installed.length ? (
          <button
            type="button"
            className="kun-onb-btn is-accent"
            disabled={connectable.length === 0}
            onClick={() => connectable.forEach((row) => connect(row.definition.id))}
            data-onboarding-agents-connect-all
          >
            {t(connectable.length ? 'onboarding.agents.connectAll' : 'onboarding.agents.allConnected')}
          </button>
        ) : null}
      </div>

      {scanning && lists.installed.length === 0 ? (
        <div className="kun-onb-agents" aria-hidden="true">
          {[0, 1, 2].map((index) => (
            <span key={index} className="kun-onb-skeleton" style={{ animationDelay: `${index * 0.15}s` }} />
          ))}
        </div>
      ) : lists.installed.length ? (
        <div className="kun-onb-agents">
          {lists.installed.map((row, index) => (
            <OnboardingAgentCard
              key={row.definition.id}
              row={row}
              settings={settings}
              status={statuses[index]}
              platform={platform}
              index={index}
              active={slot.active === row.definition.id}
              queued={slot.queue.includes(row.definition.id)}
              patch={patch}
              beforeCheck={beforeCheck}
              onConnect={() => connect(row.definition.id)}
              onCancel={() => settle(row.definition.id)}
              onSettled={() => settle(row.definition.id)}
            />
          ))}
        </div>
      ) : scanning ? null : (
        <div className="kun-onb-empty">
          <span className="kun-onb-empty-icon"><Search size={20} strokeWidth={1.8} aria-hidden="true" /></span>
          <b>{t('onboarding.agents.emptyTitle')}</b>
          <span>{t('onboarding.agents.emptyBody')}</span>
        </div>
      )}

      {lists.suggestions.length && !scanning ? (
        <section>
          <div className="kun-onb-section-label">
            <span>{t('onboarding.agents.suggestions')}</span>
            <small>{t('onboarding.agents.suggestionsHint')}</small>
          </div>
          <div className="kun-onb-suggestions">
            {lists.suggestions.map((row) => (
              <span key={row.definition.id} className="kun-onb-suggestion">
                <AgentIcon harnessId={row.definition.id} size={15} />
                {row.definition.displayName}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </>
  )
}
