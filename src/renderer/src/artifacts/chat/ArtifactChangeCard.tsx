import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Columns2, Info, LocateFixed, RotateCcw, X } from 'lucide-react'
import { requestKnowledgeSourceNavigation } from '../../lib/knowledge-source-navigation'
import type { ArtifactChatNotice, ArtifactLatestChange } from './artifact-chat-session'

function clip(text: string, max = 80): string {
  const chars = Array.from(text.replace(/\s+/g, ' ').trim())
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('')
}

const pill = 'flex h-7 items-center gap-1.5 rounded-lg border border-ds-border bg-ds-card px-2.5 text-[12px] text-ds-ink hover:bg-ds-hover disabled:opacity-50'

/** What Kun's last turn did to the file, with compare, undo and jump-to. */
export function ArtifactChangeCard({ change, filePath, restoring, onCompare, onUndo, onDismiss }: {
  change: ArtifactLatestChange
  /** Absolute path the viewers subscribe to for navigation. */
  filePath: string
  restoring: boolean
  onCompare: () => void
  onUndo: () => void
  onDismiss: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const detail = change.change
  const locate = (location: Parameters<typeof requestKnowledgeSourceNavigation>[0]['location']): void =>
    requestKnowledgeSourceNavigation({ filePath, location })
  const title = detail.kind === 'presentation'
    ? detail.changedSlides.length > 0
      ? t('artifactChatChangeSlides', { slides: detail.changedSlides.join(', ') })
      : t('artifactChatChangeAddedSlides', { slides: detail.addedSlides.join(', ') })
    : detail.kind === 'word'
      ? t('artifactChatChangeWord', { number: detail.changedCount })
      : detail.kind === 'spreadsheet'
        ? t('artifactChatChangeSheet', { number: detail.cellCount })
        : t('artifactChatChangeUnknown')
  return (
    <section aria-label={title} data-artifact-change={detail.kind}
      className="mb-2 flex flex-col gap-2 rounded-xl border border-ds-border bg-ds-card px-3 py-2.5 text-[12.5px] shadow-sm">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold text-ds-ink">{title}</span>
        {detail.kind === 'word' ? (
          <span className="shrink-0 font-mono text-[11.5px] text-ds-muted">
            {t('artifactChatChangeChars', { removed: detail.removedChars, added: detail.addedChars })}
          </span>
        ) : null}
        <button type="button" onClick={onDismiss} aria-label={t('artifactChatDismiss')} title={t('artifactChatDismiss')}
          className="rounded-md p-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink">
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>
      {detail.kind === 'presentation' && detail.addedSlides.length > 0 && detail.changedSlides.length > 0 ? (
        <span className="text-ds-muted">{t('artifactChatChangeAddedSlides', { slides: detail.addedSlides.join(', ') })}</span>
      ) : null}
      {detail.kind === 'word' && detail.paragraphs[0] ? (
        <p className="m-0 leading-relaxed">
          {detail.paragraphs[0].before ? <span className="text-ds-muted line-through">{clip(detail.paragraphs[0].before)}</span> : null}
          {detail.paragraphs[0].before && detail.paragraphs[0].after ? ' ' : null}
          {detail.paragraphs[0].after ? <span className="text-accent underline underline-offset-2">{clip(detail.paragraphs[0].after)}</span> : null}
        </p>
      ) : null}
      {detail.kind === 'spreadsheet' ? (
        <div className="flex flex-wrap gap-1.5">
          {detail.sheets.flatMap((sheet) => sheet.ranges.length > 0 ? sheet.ranges.map((range) => (
            <button key={`${sheet.name}!${range}`} type="button"
              onClick={() => locate({ kind: 'spreadsheet', sheetName: sheet.name, range })}
              className="rounded-md bg-accent-soft px-2 py-0.5 font-mono text-[11.5px] text-accent hover:underline">
              {sheet.name}!{range}
            </button>
          )) : [<span key={sheet.name} className="rounded-md bg-ds-hover px-2 py-0.5 text-[11.5px] text-ds-muted">{sheet.name}</span>])}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {detail.kind === 'presentation' && (detail.changedSlides[0] ?? detail.addedSlides[0]) ? (
          <button type="button" className={pill} onClick={() => {
            const slide = detail.changedSlides[0] ?? detail.addedSlides[0]!
            locate({ kind: 'presentation', slideStart: slide, slideEnd: slide })
          }}>
            <LocateFixed className="h-3.5 w-3.5" aria-hidden />{t('artifactChatLocate')}
          </button>
        ) : detail.kind === 'word' && detail.paragraphs[0] ? (
          <button type="button" className={pill} onClick={() => {
            const paragraph = detail.paragraphs[0]!.index + 1
            locate({ kind: 'word', paragraphStart: paragraph, paragraphEnd: paragraph })
          }}>
            <LocateFixed className="h-3.5 w-3.5" aria-hidden />{t('artifactChatLocate')}
          </button>
        ) : null}
        <button type="button" className={pill} onClick={onCompare}>
          <Columns2 className="h-3.5 w-3.5" aria-hidden />{t('artifactChatCompare')}
        </button>
        <button type="button" className={pill} onClick={onUndo} disabled={restoring}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />{t('artifactChatUndo')}
        </button>
      </div>
    </section>
  )
}

/** One-line status under the timeline: no change, outside change, restored, or an error. */
export function ArtifactChatNoticeLine({ notice, onDismiss }: { notice: ArtifactChatNotice; onDismiss: () => void }): ReactElement | null {
  const { t } = useTranslation('common')
  if (!notice) return null
  const error = typeof notice === 'object'
  const text = error
    ? t('artifactChatNoticeError', { message: notice.error })
    : notice === 'no-change' ? t('artifactChatNoticeNoChange')
      : notice === 'external-change' ? t('artifactChatNoticeExternal')
        : t('artifactChatNoticeRestored')
  return (
    <div role={error ? 'alert' : 'status'} data-artifact-notice={error ? 'error' : notice}
      className={`mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] ${error ? 'bg-ds-danger-soft text-ds-danger' : 'bg-ds-hover text-ds-muted'}`}>
      <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{text}</span>
      <button type="button" onClick={onDismiss} aria-label={t('artifactChatDismiss')} className="rounded p-0.5 hover:bg-ds-card">
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  )
}
