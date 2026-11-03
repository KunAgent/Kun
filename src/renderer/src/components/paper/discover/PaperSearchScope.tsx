import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Agent research / quick search switch: two text tabs above the search box
 * (the active one underlined) and a one-line note on what the mode does.
 */
export function PaperSearchTabs({
  tab,
  onChange
}: {
  tab: 'direct' | 'agent'
  onChange: (tab: 'direct' | 'agent') => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div role="tablist" aria-label={t('paperSearchModeLabel')} className="flex items-end gap-5 px-2">
      {(['agent', 'direct'] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={tab === value}
          onClick={() => onChange(value)}
          className={`h-8 border-b-2 px-0.5 text-[14px] transition ${
            tab === value
              ? 'border-ds-ink font-semibold text-ds-ink'
              : 'border-transparent font-medium text-ds-faint hover:text-ds-ink'
          }`}
        >
          {t(value === 'direct' ? 'writePaperSearchTabDirect' : 'writePaperSearchTabAgent')}
        </button>
      ))}
      <span className="min-w-0 flex-1 truncate pb-2 text-right text-[12px] text-ds-faint">
        {t(tab === 'agent' ? 'paperSearchModeHint_agent' : 'paperSearchModeHint_direct')}
      </span>
    </div>
  )
}
