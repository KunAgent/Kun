import { useState, type ReactElement } from 'react'
import { Loader2, RefreshCw, Save } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { editPaperNotesDraft, reloadPaperNotesDraft, savePaperNotesDraft, usePaperNotesDraftStore } from '../../../paper/paper-notes-draft'

export function PapersNotesPane({ draftKey, translated }: {
  draftKey: string
  translated?: { path: string; text: string } | null
}): ReactElement {
  const { t } = useTranslation('common')
  const draft = usePaperNotesDraftStore((state) => state.drafts[draftKey])
  const [view, setView] = useState<'edit' | 'preview'>('edit')
  const dirty = Boolean(draft && draft.text !== draft.saved)
  return (
    <aside className="papers-notes-pane">
      <header className="papers-notes-header">
        <span>NOTES.md{dirty ? <span className="papers-notes-dirty" aria-label={t('paperSpaceNotesUnsaved')}> ·</span> : null}</span>
        <div className="papers-notes-actions">
          <button type="button" className="papers-icon-button" disabled={draft?.saving} onClick={() => void reloadPaperNotesDraft(draftKey)} aria-label={t('paperSpaceNotesReload')} title={t('paperSpaceNotesReload')}><RefreshCw size={14} /></button>
          <button type="button" className="papers-text-button" disabled={!dirty || draft?.saving || draft?.status !== 'ready'} onClick={() => void savePaperNotesDraft(draftKey)}>
            <Save size={14} />{t(draft?.saving ? 'mobileWorkPaperNotesSaving' : 'paperSpaceNotesSave')}
          </button>
        </div>
      </header>
      {!draft || draft.status === 'loading' ? <div className="papers-reader-state" role="status"><Loader2 size={16} className="animate-spin" />{t('mobileWorkPaperNotesLoading')}</div> : draft.status === 'error' ? (
        <div className="papers-reader-state" role="alert"><p>{draft.error}</p><button type="button" className="papers-button" onClick={() => void reloadPaperNotesDraft(draftKey)}>{t('mobileWorkPaperNotesRetry')}</button></div>
      ) : <>
        {draft.error ? <div className="papers-notes-error" role="alert">{draft.error}</div> : null}
        <div className="papers-notes-tabs" role="tablist" aria-label={t('paperSpaceNotesView')}>
          <button type="button" role="tab" aria-selected={view === 'edit'} className={view === 'edit' ? 'is-active' : ''} onClick={() => setView('edit')}>{t('paperSpaceNotesEdit')}</button>
          <button type="button" role="tab" aria-selected={view === 'preview'} className={view === 'preview' ? 'is-active' : ''} onClick={() => setView('preview')}>{t('paperSpaceNotesPreview')}</button>
        </div>
        {view === 'edit' ? <textarea className="papers-notes-editor" value={draft.text} spellCheck={false} aria-label={t('paperSpaceNotesEditor')}
          placeholder={t('paperSpaceNotesPlaceholder')} onChange={(event) => editPaperNotesDraft(draftKey, event.target.value)} /> : (
          <div className="papers-notes-preview markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml
            components={{ img: ({ alt }) => <span>{alt}</span> }}>{draft.text}</ReactMarkdown></div>
        )}
        {translated ? <details className="papers-translation-preview" open><summary>{t('paperSpaceTranslation')}</summary><div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{ img: ({ alt }) => <span>{alt}</span> }}>{translated.text}</ReactMarkdown></div></details> : null}
      </>}
    </aside>
  )
}
