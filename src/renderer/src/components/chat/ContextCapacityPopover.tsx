import type { CSSProperties, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ContextCapacity, ContextCategoryKey } from '../../lib/context-capacity'
import { formatCompactNumber, formatPercent } from '../../hooks/use-thread-usage'

const CATEGORY_COLORS: Record<ContextCategoryKey, string> = {
  tools: '#3b82d8',
  system: '#8b7be8',
  skills: '#1d9e75',
  messages: '#e0673a',
  other: '#d8910d'
}

const CATEGORY_ORDER: ContextCategoryKey[] = ['tools', 'system', 'skills', 'messages', 'other']

function stateColor(usedRatio: number, thresholdRatio: number): string {
  if (usedRatio >= thresholdRatio) return '#d9544e'
  if (usedRatio >= thresholdRatio * 0.85) return '#d9920f'
  return 'var(--ds-accent)'
}

type Props = {
  capacity: ContextCapacity
  /** Display name of the Agent that owns an Agent-managed context. */
  agentName?: string
  style?: CSSProperties
  embedded?: boolean
}

export function ContextCapacityPopover({ capacity, agentName, style, embedded = false }: Props): ReactElement {
  const { t } = useTranslation()
  const agent = agentName?.trim() || t('contextCapacityAgentFallback')
  const occupancyUnknown = capacity.nativeHistoryUnknown || capacity.windowUnknown
  const thresholdRatio = capacity.alertRatio
  // An Agent's bare total is one figure; only its own split earns category rows.
  const agentTotalOnly = capacity.agentReported && !capacity.agentBreakdown
  const accent = occupancyUnknown
    ? 'var(--ds-text-muted)'
    : stateColor(capacity.usedRatio, thresholdRatio)

  const labelFor = (key: ContextCategoryKey): string =>
    t(`contextCapacityCat_${key}`, { defaultValue: key })

  const visibleSegments = CATEGORY_ORDER.map((key) =>
    capacity.categories.find((c) => c.key === key)
  ).filter((c): c is NonNullable<typeof c> => Boolean(c) && (c?.tokens ?? 0) > 0)

  // Kun compacts only its own context; an Agent-managed one is the Agent's call.
  const statusText =
    capacity.windowUnknown
      ? t('contextCapacityWindowPending')
      : occupancyUnknown
      ? t('contextCapacitySdkManagedUnknown')
      : capacity.usedRatio >= thresholdRatio
      ? t(capacity.agentManaged ? 'contextCapacityAgentOverLimit' : 'contextCapacityOverLimit', { agent })
      : capacity.usedRatio >= thresholdRatio * 0.85
        ? t('contextCapacityNearLimit')
        : capacity.agentReported
          ? t('contextCapacityAgentReported', { agent })
          : t('contextCapacityShareNote')
  const thresholdLabel = capacity.agentManaged
    ? t('contextCapacityAgentThresholdLabel', { percent: formatPercent(thresholdRatio), agent })
    : t('contextCapacityThresholdLabel', { percent: formatPercent(thresholdRatio) })
  const showThreshold = !occupancyUnknown && capacity.thresholdKnown

  return (
    <div
      className="ds-context-capacity w-[300px] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-ds-border-muted bg-ds-card p-3.5 text-ds-ink shadow-[0_14px_34px_rgba(20,47,95,0.16)]"
      style={style}
      role={embedded ? undefined : 'dialog'}
      aria-label={embedded ? undefined : t('contextCapacityTitle')}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13.5px] font-medium">{t('contextCapacityTitle')}</span>
        <span className="text-[12px] tabular-nums text-ds-faint">
          <span className="font-medium" style={{ color: accent }}>
            {formatCompactNumber(capacity.usedTokens)}
          </span>
          {occupancyUnknown
            ? ` ${t(capacity.agentReported ? 'contextCapacityReportedTokens' : 'contextCapacitySentTokens')}`
            : (
                <>
                  {' / '}
                  {formatCompactNumber(capacity.windowTokens)}
                  {' · '}
                  <span className="font-medium" style={{ color: accent }}>
                    {formatPercent(capacity.usedRatio)}
                  </span>
                </>
              )}
        </span>
      </div>

      {capacity.maxInputTokens ? <p className="mt-1 text-[11px] text-ds-faint">{t('contextCapacityInputLimit', { input: formatCompactNumber(capacity.maxInputTokens), context: formatCompactNumber(capacity.totalWindowTokens) })}</p> : null}

      {!occupancyUnknown ? <div className="relative mb-1.5 mt-3">
        <div
          className="flex h-2 overflow-hidden rounded-full"
          style={{ background: 'var(--ds-surface-subtle)' }}
          role="img"
          aria-label={t('contextCapacityBarAria', { percent: formatPercent(capacity.usedRatio) })}
        >
          {agentTotalOnly
            ? <span style={{ width: `${capacity.usedRatio * 100}%`, background: accent }} data-context-agent-segment />
            : visibleSegments.map((segment) => (
              <span
                key={segment.key}
                style={{
                  width: `${segment.ratio * 100}%`,
                  minWidth: segment.key === 'messages' ? undefined : 2,
                  background: CATEGORY_COLORS[segment.key]
                }}
              />
            ))}
        </div>
        {showThreshold ? <span
          className="absolute -bottom-1 -top-1 w-px rounded"
          style={{ left: `${thresholdRatio * 100}%`, background: 'var(--ds-text-faint)', opacity: 0.45 }}
          title={thresholdLabel}
          aria-hidden="true"
        /> : null}
      </div> : null}

      <div className="mb-2 flex items-center justify-between gap-2 text-[11px]">
        <span className="min-w-0 truncate font-medium" style={{ color: accent }} title={statusText}>
          {statusText}
        </span>
        {showThreshold ? <span className="shrink-0 whitespace-nowrap text-ds-faint" data-context-threshold-label>{thresholdLabel}</span> : null}
      </div>

      <div className="flex flex-col">
        {agentTotalOnly ? (
          <div className="grid grid-cols-[13px_1fr_auto_46px] items-center gap-x-2 py-[3px]" data-context-agent-row>
            <span className="h-[9px] w-[9px] rounded-[3px]" style={{ background: accent }} />
            <span className="truncate text-[12.5px] text-ds-muted">{t('contextCapacityAgentUsed', { agent })}</span>
            <span className="text-[12px] tabular-nums text-ds-ink">{formatCompactNumber(capacity.usedTokens)}</span>
            <span className="text-right text-[12px] tabular-nums text-ds-faint">{occupancyUnknown ? '—' : formatPercent(capacity.usedRatio)}</span>
          </div>
        ) : CATEGORY_ORDER.map((key) => {
          const category = capacity.categories.find((c) => c.key === key)
          if (!category) return null
          return (
            <div key={key} className="grid grid-cols-[13px_1fr_auto_46px] items-center gap-x-2 py-[3px]">
              <span
                className="h-[9px] w-[9px] rounded-[3px]"
                style={{ background: CATEGORY_COLORS[key] }}
              />
              <span className="truncate text-[12.5px] text-ds-muted">{labelFor(key)}</span>
              <span className="text-[12px] tabular-nums text-ds-ink">
                {formatCompactNumber(category.tokens)}
              </span>
              <span className="text-right text-[12px] tabular-nums text-ds-faint">
                {occupancyUnknown ? '—' : formatPercent(category.ratio)}
              </span>
            </div>
          )
        })}

        {!occupancyUnknown ? <div className="mt-1 grid grid-cols-[13px_1fr_auto_46px] items-center gap-x-2 border-t border-ds-border-muted pt-1.5">
          <span className="h-[8px] w-[8px] rounded-[3px] border border-ds-faint" />
          <span className="truncate text-[12.5px] text-ds-faint">{t('contextCapacityCat_free')}</span>
          <span className="text-[12px] tabular-nums text-ds-faint">
            {formatCompactNumber(capacity.freeTokens)}
          </span>
          <span className="text-right text-[12px] tabular-nums text-ds-faint">
            {formatPercent(capacity.freeRatio)}
          </span>
        </div> : null}
      </div>

      <p className="mt-2.5 text-[10.5px] leading-snug text-ds-faint">
        {capacity.windowUnknown
          ? `${capacity.agentReported ? '' : t('contextCapacityEstimatedBreakdown') + ' '}${t('contextCapacityWindowPendingNote')}`
          : occupancyUnknown
          ? t('contextCapacitySdkManagedEstimate')
          : capacity.agentBreakdown
            ? t('contextCapacityAgentBreakdownNote', { agent })
          : capacity.agentReported
            ? t('contextCapacityAgentReportedNote', { agent })
            : t('contextCapacityEstimatedBreakdown')}
      </p>
    </div>
  )
}
