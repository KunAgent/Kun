import type { ReactElement } from 'react'
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

const WARN_RATIO = 0.75

function stateColor(usedRatio: number, thresholdRatio: number): string {
  if (usedRatio >= thresholdRatio) return '#d9544e'
  if (usedRatio >= WARN_RATIO) return '#d9920f'
  return 'var(--ds-accent)'
}

type Props = {
  capacity: ContextCapacity
  /** Approximate auto-compaction trigger, as a share of the window. */
  thresholdRatio?: number
}

export function ContextCapacityPopover({ capacity, thresholdRatio = 0.9 }: Props): ReactElement {
  const { t } = useTranslation()
  const accent = stateColor(capacity.usedRatio, thresholdRatio)

  const labelFor = (key: ContextCategoryKey): string =>
    t(`contextCapacityCat_${key}`, { defaultValue: key })

  const visibleSegments = CATEGORY_ORDER.map((key) =>
    capacity.categories.find((c) => c.key === key)
  ).filter((c): c is NonNullable<typeof c> => Boolean(c) && (c?.tokens ?? 0) > 0)

  const statusText =
    capacity.usedRatio >= thresholdRatio
      ? t('contextCapacityOverLimit')
      : capacity.usedRatio >= WARN_RATIO
        ? t('contextCapacityNearLimit')
        : t('contextCapacityShareNote')

  return (
    <div
      className="ds-context-capacity w-[300px] rounded-2xl border border-ds-border-muted bg-ds-card p-3.5 text-ds-ink shadow-[0_14px_34px_rgba(20,47,95,0.16)]"
      role="dialog"
      aria-label={t('contextCapacityTitle')}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13.5px] font-medium">{t('contextCapacityTitle')}</span>
        <span className="text-[12px] tabular-nums text-ds-faint">
          <span className="font-medium" style={{ color: accent }}>
            {formatCompactNumber(capacity.usedTokens)}
          </span>
          {' / '}
          {formatCompactNumber(capacity.windowTokens)}
          {' · '}
          <span className="font-medium" style={{ color: accent }}>
            {formatPercent(capacity.usedRatio)}
          </span>
        </span>
      </div>

      <div className="relative mb-1.5 mt-3">
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
      </div>

      <div className="mb-2 flex items-center justify-between text-[11px]">
        <span className="font-medium" style={{ color: accent }}>
          {statusText}
        </span>
        <span className="text-ds-faint">
          {t('contextCapacityThresholdLabel', { percent: formatPercent(thresholdRatio) })}
        </span>
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
                {formatPercent(category.ratio)}
              </span>
            </div>
          )
        })}

        <div className="mt-1 grid grid-cols-[13px_1fr_auto_46px] items-center gap-x-2 border-t border-ds-border-muted pt-1.5">
          <span className="h-[8px] w-[8px] rounded-[3px] border border-ds-faint" />
          <span className="truncate text-[12.5px] text-ds-faint">{t('contextCapacityCat_free')}</span>
          <span className="text-[12px] tabular-nums text-ds-faint">
            {formatCompactNumber(capacity.freeTokens)}
          </span>
          <span className="text-right text-[12px] tabular-nums text-ds-faint">
            {formatPercent(capacity.freeRatio)}
          </span>
        </div>
      </div>

      {capacity.estimated ? (
        <p className="mt-2.5 text-[10.5px] leading-snug text-ds-faint">
          {capacity.hasMeasuredTotal
            ? t('contextCapacityEstimatedBreakdown')
            : t('contextCapacityEstimatedAll')}
        </p>
      ) : null}
    </div>
  )
}
