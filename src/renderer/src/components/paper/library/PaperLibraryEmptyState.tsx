import type { ReactElement } from 'react'
import { BookOpen, FileUp, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { openPaperViewTab } from '../../../paper/paper-view'

export function PaperLibraryEmptyState({
  filtered,
  onImport,
  onClearFilters
}: {
  filtered: boolean
  onImport: () => void
  onClearFilters: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div data-testid="paper-library-empty" className="mx-auto flex w-full max-w-xl flex-col items-center px-6 py-12 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-accent-tint/15 bg-accent-tint/10 text-accent">
        <BookOpen className="h-6 w-6" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold text-ds-ink">
        {t(filtered ? 'writePaperLibraryNoMatch' : 'paperWorkspaceEmptyTitle')}
      </h2>
      <p className="mt-2 max-w-md text-[13px] leading-6 text-ds-muted">
        {t(filtered ? 'paperWorkspaceEmptyFilteredHint' : 'paperWorkspaceEmptyHint')}
      </p>
      {filtered ? (
        <button type="button" onClick={onClearFilters} className="mt-5 rounded-lg border border-ds-border-muted px-4 py-2 text-[12.5px] text-ds-ink hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          {t('paperWorkspaceClearFilters')}
        </button>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              data-testid="paper-empty-import"
              onClick={onImport}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[var(--ds-control)] px-4 py-2 text-[12.5px] font-medium text-[var(--ds-control-foreground)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <FileUp className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              {t('paperWorkspaceImportPdf')}
            </button>
            <button
              type="button"
              data-testid="paper-empty-search"
              onClick={() => openPaperViewTab('discover:search')}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-ds-border-muted px-4 py-2 text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <Search className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
              {t('paperWorkspaceSearchPapers')}
            </button>
          </div>
          <p className="mt-4 text-[11.5px] leading-5 text-ds-faint">{t('paperWorkspaceDropHint')}</p>
        </>
      )}
    </div>
  )
}
