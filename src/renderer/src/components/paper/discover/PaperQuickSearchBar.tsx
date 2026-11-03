import type { ReactElement, ReactNode, Ref } from 'react'
import { ArrowRight, Loader2, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Quick-search input: a large hero field on the empty page, a compact one
 * docked above results. Enter searches; the trailing button does the same.
 */
export function PaperQuickSearchBar({
  value,
  onChange,
  onSubmit,
  busy,
  size,
  inputRef,
  scope
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  busy: boolean
  size: 'hero' | 'compact'
  inputRef?: Ref<HTMLInputElement>
  /** Scope pill shown inside the box, before the search button. */
  scope?: ReactNode
}): ReactElement {
  const { t } = useTranslation('common')
  const hero = size === 'hero'
  return (
    <div
      className={`flex items-center gap-2 border border-ds-border bg-ds-main shadow-sm transition focus-within:border-[var(--ds-accent)] ${
        hero ? 'h-14 rounded-[18px] pl-4 pr-2' : 'h-11 rounded-2xl pl-3.5 pr-1.5'
      }`}
    >
      <Search className={`shrink-0 text-ds-faint ${hero ? 'h-5 w-5' : 'h-4 w-4'}`} strokeWidth={1.9} />
      <input
        ref={inputRef}
        value={value}
        autoFocus={hero}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) onSubmit()
        }}
        placeholder={t('writePaperSearchQueryPlaceholder')}
        aria-label={t('writePaperSearchQueryPlaceholder')}
        className={`min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-ds-ink shadow-none outline-none ring-0 placeholder:text-ds-faint focus:border-0 focus:shadow-none focus:outline-none focus:ring-0 focus-visible:outline-none ${hero ? 'text-[15px]' : 'text-[13.5px]'}`}
      />
      {value ? (
        <button
          type="button"
          aria-label={t('clearSearch')}
          onClick={() => onChange('')}
          className="rounded p-1 text-ds-faint hover:text-ds-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      ) : null}
      {scope ? <div className="min-w-0 shrink">{scope}</div> : null}
      <button
        type="button"
        onClick={onSubmit}
        disabled={!value.trim() || busy}
        aria-label={t('writePaperSearchRun')}
        title={t('writePaperSearchRun')}
        className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-[var(--ds-control)] text-[var(--ds-control-foreground)] transition hover:opacity-90 disabled:opacity-40 ${
          hero ? 'h-10 w-10' : 'h-7 w-7'
        }`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" strokeWidth={2.2} />}
      </button>
    </div>
  )
}
