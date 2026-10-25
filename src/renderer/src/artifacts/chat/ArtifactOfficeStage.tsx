import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { History, Loader2, RotateCcw, X } from 'lucide-react'
import { WorkspaceOfficePreview } from '../../components/WorkspaceOfficePreview'
import type { LibraryArtifact } from '../artifact-types'
import { formatArtifactTime } from '../artifact-view-model'
import { FallbackStage, StageMessage } from '../ArtifactViewerStages'
import type { ArtifactCompare } from './artifact-chat-session'
import type { ArtifactOfficeSession } from './use-artifact-office-session'

/**
 * The Office preview beside the chat panel: the current file, or a kept
 * version while comparing. While Kun is changing the file a banner says so;
 * the preview refreshes by itself once the file is replaced.
 */
export function ArtifactOfficeStage({ artifact, session, compare, changedSlides, editing, restoring, onRestoreCompare, onCloseCompare }: {
  artifact: LibraryArtifact
  session: ArtifactOfficeSession
  compare: ArtifactCompare | null
  changedSlides?: readonly number[]
  editing: boolean
  restoring: boolean
  onRestoreCompare: () => void
  onCloseCompare: () => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const result = session.officeResult
  if (!result) {
    return <StageMessage><Loader2 className="h-4 w-4 animate-spin" aria-hidden />{t('artifactsPreviewLoading')}</StageMessage>
  }
  if (!result.ok) return <FallbackStage artifact={artifact} detail={result.message} />
  const shown = compare ? { ...result, data: compare.data, sourceSha256: compare.sha } : result
  return (
    <div className="h-full min-h-0 overflow-hidden p-6" data-artifact-stage="office">
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-ds-border bg-ds-card shadow-[0_16px_40px_rgba(24,24,27,0.08)]"
        aria-busy={editing || undefined} data-artifact-compare={compare ? 'true' : undefined}>
        {compare ? (
          <div role="status" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ds-border bg-accent-soft px-4 py-2 text-[12.5px] text-ds-ink">
            <History className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
            <span className="min-w-0 flex-1 truncate">
              {t('artifactChatCompareBanner', { label: compare.label, time: formatArtifactTime(Date.parse(compare.createdAt), i18n.language) })}
            </span>
            <button type="button" onClick={onRestoreCompare} disabled={restoring}
              className="flex h-7 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] disabled:opacity-50">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />{t('artifactChatCompareRestore')}
            </button>
            <button type="button" onClick={onCloseCompare}
              className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-accent hover:bg-ds-hover">
              <X className="h-3.5 w-3.5" aria-hidden />{t('artifactChatCompareBack')}
            </button>
          </div>
        ) : null}
        <WorkspaceOfficePreview
          key={compare ? `compare:${compare.versionId}` : 'current'}
          result={shown}
          loading={session.officeLoading}
          refreshError={session.officeRefreshError}
          onSelectionChange={compare ? undefined : session.onSelectionChange}
          onPresentationViewChange={compare ? undefined : (view) => session.onPresentationViewChange(view)}
          onQuoteSelection={compare || result.viewer !== 'word' ? undefined : session.onQuoteSelection}
          changedSlides={compare ? undefined : changedSlides}
        />
        {editing && !compare ? (
          <>
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-white/40 dark:bg-black/30" />
            <div role="status" className="pointer-events-none absolute left-1/2 top-16 z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full border border-ds-border bg-ds-card px-3.5 py-1.5 text-[12.5px] text-ds-ink shadow-[0_8px_24px_rgba(24,24,27,0.14)]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden />
              {t('artifactChatEditing')}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
