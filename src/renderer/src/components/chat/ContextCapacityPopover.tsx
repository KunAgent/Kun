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
  style?: CSSProperties
}

export function ContextCapacityPopover({ capacity, style }: Props): ReactElement {
  const { t } = useTranslation()
  const thresholdRatio = capacity.softThresholdRatio
  const accent = capacity.nativeHistoryUnknown
    ? 'var(--ds-muted)'
    : stateColor(capacity.usedRatio, thresholdRatio)

  const labelFor = (key: ContextCategoryKey): string =>
    t(`contextCapacityCat_${key}`, { defaultValue: key })

  const visibleSegments = CATEGORY_ORDER.map((key) =>
    capacity.categories.find((c) => c.key === key)
  ).filter((c): c is NonNullable<typeof c> => Boolean(c) && (c?.tokens ?? 0) > 0)

  const statusText =
    capacity.nativeHistoryUnknown
      ? t('contextCapacitySdkManagedUnknown')
      : capacity.usedRatio >= thresholdRatio
      ? t('contextCapacityOverLimit')
      : capacity.usedRatio >= thresholdRatio * 0.85
        ? t('contextCapacityNearLimit')
        : t('contextCapacityShareNote')

  return (
    <div
      className="ds-context-capacity w-[300px] max-w-[calc(100vw-1.5rem)] rounded-2xl border border-ds-border-muted bg-ds-card p-3.5 text-ds-ink shadow-[0_14px_34px_rgba(20,47,95,0.16)]"
      style={style}
      role="dialog"
      aria-label={t('contextCapacityTitle')}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13.5px] font-medium">{t('contextCapacityTitle')}</span>
        <span className="text-[12px] tabular-nums text-ds-faint">
          <span className="font-medium" style={{ color: accent }}>
            {formatCompactNumber(capacity.usedTokens)}
          </span>
          {capacity.nativeHistoryUnknown
            ? ` ${t('contextCapacitySentTokens')}`
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

      {!capacity.nativeHistoryUnknown ? <div className="relative mb-1.5 mt-3">
        <div
          className="flex h-2 overflow-hidden rounded-full"
          style={{ background: 'var(--ds-surface-subtle)' }}
          role="img"
          aria-label={t('contextCapacityBarAria', { percent: formatPercent(capacity.usedRatio) })}
        >
          {visibleSegments.map((segment) => (
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
        <span
          className="absolute -bottom-1 -top-1 w-px rounded"
          style={{ left: `${thresholdRatio * 100}%`, background: 'var(--ds-text-faint)', opacity: 0.45 }}
          title={t('contextCapacityThresholdLabel', { percent: formatPercent(thresholdRatio) })}
          aria-hidden="true"
        />
      </div> : null}

      <div className="mb-2 flex items-center justify-between text-[11px]">
        <span className="font-medium" style={{ color: accent }}>
          {statusText}
        </span>
        {!capacity.nativeHistoryUnknown ? <span className="text-ds-faint">
          {t('contextCapacityThresholdLabel', { percent: formatPercent(thresholdRatio) })}
        </span> : null}
      </div>

      <div className="flex flex-col">
        {CATEGORY_ORDER.map((key) => {
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
                {capacity.nativeHistoryUnknown ? '—' : formatPercent(category.ratio)}
              </span>
            </div>
          )
        })}

        {!capacity.nativeHistoryUnknown ? <div className="mt-1 grid grid-cols-[13px_1fr_auto_46px] items-center gap-x-2 border-t border-ds-border-muted pt-1.5">
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

      {capacity.estimated ? (
        <p className="mt-2.5 text-[10.5px] leading-snug text-ds-faint">
          {capacity.nativeHistoryUnknown
            ? t('contextCapacitySdkManagedEstimate')
            : t('contextCapacityEstimatedBreakdown')}
        </p>
      ) : null}
    </div>
  )
}
