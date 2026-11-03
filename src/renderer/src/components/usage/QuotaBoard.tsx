import { Gauge } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProviderQuotaListResult } from '@shared/provider-quota'
import {
  QuotaAllowanceCard,
  QuotaBalanceGrid,
  QuotaModeToggle,
  QuotaProblemList,
  QuotaSectionHead,
  QuotaUnsupportedNote,
  type QuotaCardVariant
} from './QuotaSections'
import { classifyQuotaEntries } from './quota-view-model'
import { useExpandedQuotaCards, useQuotaDisplayMode } from './use-quota-display'

export type QuotaBoardProps = {
  result: ProviderQuotaListResult
  variant: QuotaCardVariant
  retrying: boolean
  onRetry: () => void
  onOpenDashboard?: (url: string) => void
  /** Where a provider that needs signing in or a key is sent. */
  onFix?: () => void
  fixLabel?: string
  /** Shown when nothing is configured: where providers are added. */
  onAddProvider?: () => void
}

/** Two cards' outlines while the vendors answer, so the page does not jump. */
export function QuotaBoardSkeleton({ label }: { label: string }): ReactElement {
  return (
    <div className="kq-board" role="status" aria-busy="true" aria-label={label}>
      {[0, 1].map((index) => (
        <div key={index} className="kq-card kq-skeleton" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  )
}

/** Ticks once a minute so countdowns and pace lines stay current. */
function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  return now
}

/**
 * Every provider's allowance on one page, as the user reads it: the
 * subscriptions' windows first (the fullest on top), then plain balances,
 * then what needs the user, and last only the names of providers that have
 * no quota to read.
 */
export function QuotaBoard({
  result,
  variant,
  retrying,
  onRetry,
  onOpenDashboard,
  onFix,
  fixLabel,
  onAddProvider
}: QuotaBoardProps): ReactElement {
  const { t, i18n } = useTranslation('common')
  const locale = i18n.resolvedLanguage
  const [mode, setMode] = useQuotaDisplayMode()
  const [expanded, toggleExpanded] = useExpandedQuotaCards()
  const now = useMinuteClock()
  const sections = useMemo(() => classifyQuotaEntries(result.entries), [result.entries])
  const toggleMode = (): void => setMode(mode === 'used' ? 'left' : 'used')
  const shown = sections.allowances.length + sections.balances.length + sections.problems.length

  if (shown === 0) {
    return (
      <div className="kq-board" data-variant={variant}>
        <div className="kq-empty">
          <span className="kq-empty-icon"><Gauge aria-hidden="true" strokeWidth={1.7} /></span>
          <strong>{t(sections.unsupported.length ? 'usagePanelQuotaNoneReadable' : 'usagePanelQuotaEmpty')}</strong>
          <p>{t('usagePanelQuotaEmptyHint')}</p>
          {onAddProvider ? (
            <button type="button" className="kq-chip-button is-primary" onClick={onAddProvider}>
              {t('usagePanelAddProvider')}
            </button>
          ) : null}
        </div>
        {sections.unsupported.length ? <QuotaUnsupportedNote entries={sections.unsupported} locale={locale} /> : null}
      </div>
    )
  }

  return (
    <div className="kq-board" data-variant={variant}>
      {sections.allowances.length ? (
        <section className="kq-section" aria-label={t('usagePanelSubscriptions')}>
          <QuotaSectionHead label={t('usagePanelSubscriptions')}>
            <QuotaModeToggle mode={mode} onChange={setMode} />
          </QuotaSectionHead>
          {sections.allowances.map((entry) => (
            <QuotaAllowanceCard
              key={entry.providerId}
              entry={entry}
              variant={variant}
              mode={mode}
              onToggleMode={toggleMode}
              now={now}
              locale={locale}
              expanded={expanded.has(entry.providerId)}
              onToggleExpanded={() => toggleExpanded(entry.providerId)}
              onOpenDashboard={onOpenDashboard}
            />
          ))}
        </section>
      ) : null}
      {sections.balances.length ? (
        <section className="kq-section" aria-label={t('usagePanelBalances')}>
          <QuotaSectionHead label={t('usagePanelBalances')} />
          <QuotaBalanceGrid entries={sections.balances} locale={locale} onOpenDashboard={onOpenDashboard} />
        </section>
      ) : null}
      {sections.problems.length ? (
        <section className="kq-section" aria-label={t('usagePanelNeedsAttention')}>
          <QuotaSectionHead label={t('usagePanelNeedsAttention')} count={sections.problems.length} />
          <QuotaProblemList
            entries={sections.problems}
            locale={locale}
            retrying={retrying}
            onRetry={onRetry}
            onFix={onFix}
            fixLabel={fixLabel}
          />
        </section>
      ) : null}
      {sections.unsupported.length ? <QuotaUnsupportedNote entries={sections.unsupported} locale={locale} /> : null}
    </div>
  )
}
