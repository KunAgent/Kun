import { useState, type FormEvent, type ReactElement, type ReactNode } from 'react'
import { Loader2, RefreshCw, Star, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PaperLibraryEntry, PaperLibraryMetaPatch } from '@shared/paper/paper-library-types'
import type { PaperReadingStatus } from '@shared/paper/paper-meta-v2'
import { updatePaperEntryMeta } from '../../../paper/paper-library-row-actions'

type Form = {
  title: string
  authors: string
  year: string
  venue: string
  doi: string
  arxivId: string
  abstract: string
  tags: string
  status: PaperReadingStatus
  rating: number
}

function formFromEntry(entry: PaperLibraryEntry): Form {
  const meta = entry.meta
  return {
    title: meta.title,
    authors: meta.authors.join('\n'),
    year: meta.year ?? '',
    venue: meta.venue ?? '',
    doi: meta.doi ?? '',
    arxivId: meta.arxivId ?? '',
    abstract: meta.abstract ?? '',
    tags: (meta.tags ?? []).join(', '),
    status: meta.status ?? 'unread',
    rating: meta.rating ?? 0
  }
}

/** Only fields the user changed go into the patch (plan §PM2 patch semantics). */
function patchFromForm(before: Form, after: Form): PaperLibraryMetaPatch {
  const patch: PaperLibraryMetaPatch = {}
  const text = (key: 'year' | 'venue' | 'doi' | 'arxivId' | 'abstract'): void => {
    if (after[key].trim() !== before[key].trim()) patch[key] = after[key].trim() || null
  }
  if (after.title.trim() && after.title.trim() !== before.title.trim()) patch.title = after.title.trim()
  if (after.authors !== before.authors) {
    patch.authors = after.authors.split('\n').map((line) => line.trim()).filter(Boolean)
  }
  text('year')
  text('venue')
  text('doi')
  text('arxivId')
  text('abstract')
  if (after.tags !== before.tags) {
    patch.tags = after.tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean)
  }
  if (after.status !== before.status) patch.status = after.status
  if (after.rating !== before.rating) patch.rating = after.rating || null
  return patch
}

/**
 * Edit a library entry's `paper.json` (title, authors, ids, tags, status,
 * rating). The DOI refresh button fetches authoritative metadata into the
 * form only; nothing is written until Save.
 */
export function PaperMetaEditDialog({
  entry,
  onClose
}: {
  entry: PaperLibraryEntry
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [initial] = useState(() => formFromEntry(entry))
  const [form, setForm] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof Form>(key: K, value: Form[K]): void => setForm((f) => ({ ...f, [key]: value }))

  const refreshFromDoi = async (): Promise<void> => {
    const doi = form.doi.trim()
    if (!doi || typeof window.kunGui?.paperResolveDoi !== 'function') return
    setRefreshing(true)
    setError('')
    try {
      const result = await window.kunGui.paperResolveDoi({ doi })
      if (!result.ok) {
        setError(result.message)
        return
      }
      const meta = result.meta
      setForm((f) => ({
        ...f,
        title: meta.title || f.title,
        authors: meta.authors.length ? meta.authors.join('\n') : f.authors,
        year: meta.year ?? f.year,
        venue: meta.venue ?? f.venue,
        abstract: meta.abstract ?? f.abstract,
        arxivId: meta.arxivId ?? f.arxivId
      }))
    } finally {
      setRefreshing(false)
    }
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const patch = patchFromForm(initial, form)
    if (Object.keys(patch).length === 0) {
      onClose()
      return
    }
    setSaving(true)
    const ok = await updatePaperEntryMeta(entry, patch, t)
    setSaving(false)
    if (ok) onClose()
  }

  const input = 'w-full rounded-lg border border-ds-border-muted bg-ds-main px-2.5 py-1.5 text-[13px] text-ds-ink outline-none focus:border-accent/50'
  return (
    <div
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={() => { if (!saving) onClose() }}
    >
      <form
        role="dialog"
        aria-label={t('writePaperEditMeta')}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
        className="flex max-h-[86vh] w-full max-w-xl flex-col rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)]"
      >
        <div className="mb-3 flex items-center gap-2">
          <h2 className="flex-1 text-[15px] font-semibold text-ds-ink">{t('writePaperEditMeta')}</h2>
          <button type="button" aria-label={t('close')} onClick={onClose} className="rounded-full p-1 text-ds-faint hover:bg-ds-hover">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-2.5 overflow-auto pr-1">
          <Field label={t('writePaperColTitle')}>
            <input className={input} value={form.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <Field label={t('writePaperMetaAuthors')}>
            <textarea className={`${input} min-h-[64px]`} value={form.authors} onChange={(e) => set('authors', e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={t('writePaperColYear')}>
              <input className={input} value={form.year} onChange={(e) => set('year', e.target.value)} />
            </Field>
            <Field label={t('writePaperColVenue')}>
              <input className={input} value={form.venue} onChange={(e) => set('venue', e.target.value)} />
            </Field>
            <Field label="DOI">
              <div className="flex gap-1">
                <input className={input} value={form.doi} onChange={(e) => set('doi', e.target.value)} />
                <button
                  type="button"
                  title={t('writePaperMetaRefreshDoi')}
                  aria-label={t('writePaperMetaRefreshDoi')}
                  disabled={!form.doi.trim() || refreshing}
                  onClick={() => void refreshFromDoi()}
                  className="inline-flex h-[34px] w-9 shrink-0 items-center justify-center rounded-lg border border-ds-border-muted text-ds-muted hover:bg-ds-hover disabled:opacity-50"
                >
                  {refreshing
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                    : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />}
                </button>
              </div>
            </Field>
            <Field label="arXiv">
              <input className={input} value={form.arxivId} onChange={(e) => set('arxivId', e.target.value)} />
            </Field>
          </div>
          <Field label={t('writePaperMetaTags')}>
            <input className={input} value={form.tags} placeholder="agent, code-llm" onChange={(e) => set('tags', e.target.value)} />
          </Field>
          <div className="flex items-center gap-4">
            <Field label={t('writePaperColStatus')}>
              <select className={input} value={form.status} onChange={(e) => set('status', e.target.value as PaperReadingStatus)}>
                <option value="unread">{t('writePaperFilterUnread')}</option>
                <option value="reading">{t('writePaperFilterReading')}</option>
                <option value="read">{t('writePaperFilterRead')}</option>
              </select>
            </Field>
            <Field label={t('writePaperMetaRating')}>
              <div className="flex h-[34px] items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={`${value}`}
                    onClick={() => set('rating', form.rating === value ? 0 : value)}
                    className="p-0.5"
                  >
                    <Star
                      className={`h-4 w-4 ${value <= form.rating ? 'fill-amber-400 text-amber-400' : 'text-ds-faint'}`}
                      strokeWidth={1.8}
                    />
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <Field label={t('writePaperMetaAbstract')}>
            <textarea className={`${input} min-h-[96px]`} value={form.abstract} onChange={(e) => set('abstract', e.target.value)} />
          </Field>
          {error ? <p className="text-[12px] text-red-600 dark:text-red-300">{error}</p> : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 rounded-full px-4 text-[12.5px] text-ds-muted hover:bg-ds-hover">
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={saving || !form.title.trim()}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : null}
            {t('writePaperReaderSave')}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <label className="block min-w-0 flex-1">
      <span className="mb-1 block text-[11.5px] font-medium text-ds-faint">{label}</span>
      {children}
    </label>
  )
}
