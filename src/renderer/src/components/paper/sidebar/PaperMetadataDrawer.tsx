import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from 'react'
import {
  BookOpen,
  Calendar,
  ExternalLink,
  FileText,
  ImageDown,
  Info,
  Library,
  Pencil,
  Sparkles,
  Tag,
  Users,
  X,
  Zap
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { usePaperStore } from '../../../write/paper/paper-store'
import { openPaperInterpretation } from '../../../write/paper/paper-open-layout'
import { fetchCoolNotes, interpretPaper, preprocessPaper } from '../../../write/paper/paper-actions'
import { updatePaperEntryMeta } from '../../../paper/paper-library-row-actions'
import { PaperMetaEditDialog } from '../library/PaperMetaEditDialog'
import { PaperTitleText } from '../PaperTitleText'
import { pathInsidePaperUnit } from './PaperTree'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'

type Translate = (key: string, opts?: Record<string, unknown>) => string

function copyText(text: string, label: string, t: Translate): void {
  void navigator.clipboard?.writeText(text).then(
    () => usePaperStore.getState().setNotice({ tone: 'success', message: t('writePaperInfoCopied', { label }) }),
    () => undefined
  )
}

function MetaRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-start gap-2 px-3 py-1.5">
      <span className="mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center text-ds-faint" aria-hidden>{icon}</span>
      <div className="min-w-0 flex-1">
        <span className="sr-only">{label}</span>
        <div className="text-[13px] leading-snug text-ds-ink">{children}</div>
      </div>
    </div>
  )
}

/** Click-to-copy value (title, authors, venue). */
function CopyValue({ text, label, t, children }: { text: string; label: string; t: Translate; children?: ReactNode }): ReactElement {
  return (
    <button
      type="button"
      title={t('writePaperInfoCopyHint', { label })}
      onClick={() => copyText(text, label, t)}
      className="line-clamp-2 w-full cursor-copy text-left transition hover:text-ds-muted"
    >
      {children ?? text}
    </button>
  )
}

function LinkChip({ href, label, color }: { href: string; label: string; color: string }): ReactElement {
  return (
    <button
      type="button"
      title={href}
      onClick={() => void window.kunGui?.openExternal?.(href)}
      className="inline-flex h-6 min-w-0 flex-1 items-center justify-center gap-1 rounded-md border border-ds-border-muted bg-ds-main px-1.5 text-[11.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <span className="min-w-0 truncate">{label}</span>
      <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" strokeWidth={2} />
    </button>
  )
}

function TagsEditor({ entry, t }: { entry: PaperLibraryEntry; t: Translate }): ReactElement {
  const [draft, setDraft] = useState('')
  const tags = entry.meta.tags ?? []
  const save = (next: string[]): void => {
    void updatePaperEntryMeta(entry, { tags: next }, t)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key !== 'Enter' && event.key !== ',') return
    event.preventDefault()
    const value = draft.trim()
    if (!value || tags.includes(value)) {
      setDraft('')
      return
    }
    save([...tags, value])
    setDraft('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="group/tag inline-flex h-5 items-center gap-0.5 rounded-md border border-ds-border-muted bg-ds-subtle pl-1.5 pr-0.5 text-[11.5px] text-ds-muted"
        >
          {tag}
          <button
            type="button"
            aria-label={t('writePaperTagRemove', { tag })}
            onClick={() => save(tags.filter((item) => item !== tag))}
            className="rounded p-px text-ds-faint opacity-0 transition hover:text-ds-ink group-hover/tag:opacity-100"
          >
            <X className="h-2.5 w-2.5" strokeWidth={2.2} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={t('writePaperTagAddPlaceholder')}
        className="h-5 w-24 min-w-0 flex-1 rounded-md border border-dashed border-ds-border-muted bg-transparent px-1.5 text-[11.5px] text-ds-ink outline-none placeholder:text-ds-faint focus:border-[var(--ds-accent)]"
      />
    </div>
  )
}

function ActionButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-7 min-w-0 items-center justify-center gap-1 rounded-md border border-ds-border-muted bg-ds-main px-2 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
    >
      <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

/**
 * Paper metadata drawer: the old sidebar info panel moved into the editor
 * column as a right-side overlay (320px, capped at 85% of the column). Icon
 * rows for title / authors / date / venue / tags, brand link chips, paper
 * actions, and "edit metadata". Keeps showing the last focused paper while
 * notes or other files are open. Closes on Escape or outside pointer down.
 */
export function PaperMetadataDrawer({ onClose }: { onClose: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useWriteWorkspaceStore((s) => s.workspaceRoot)
  const activeFilePath = useWriteWorkspaceStore((s) => s.activeFilePath)
  const entries = usePaperModeStore((s) => s.entries)
  const infoUnitDir = usePaperModeStore((s) => s.infoUnitDir)
  const [editing, setEditing] = useState(false)
  const lastEntryRef = useRef<PaperLibraryEntry | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [onClose])

  const current = useMemo(() => {
    const byDir = (dir: string | null | undefined): PaperLibraryEntry | undefined =>
      dir ? entries.find((item) => item.unitDir === dir) : undefined
    return byDir(infoUnitDir)
      ?? entries.find((item) => pathInsidePaperUnit(activeFilePath, workspaceRoot, item.unitDir))
      ?? null
  }, [entries, infoUnitDir, activeFilePath, workspaceRoot])
  if (current) lastEntryRef.current = current
  const entry = current
    ?? (lastEntryRef.current && entries.some((item) => item.unitDir === lastEntryRef.current?.unitDir)
      ? entries.find((item) => item.unitDir === lastEntryRef.current?.unitDir) ?? null
      : null)

  const meta = entry?.meta
  const settings = (): ReturnType<typeof useWriteWorkspaceStore.getState>['paperReading'] =>
    useWriteWorkspaceStore.getState().paperReading
  const interpretation = meta?.interpretations?.at(-1)

  return (
    <div
      ref={rootRef}
      role="complementary"
      aria-label={t('writePaperInfoTitle')}
      className="ds-no-drag absolute inset-y-0 right-0 z-20 flex w-[320px] max-w-[85%] min-w-0 flex-col border-l border-ds-border-muted bg-ds-card shadow-[0_18px_48px_rgba(20,47,95,0.18)]"
    >
      <div className="flex h-9 min-h-9 shrink-0 items-center gap-1.5 border-b border-ds-border-muted pl-3 pr-2">
        <Info className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.9} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ds-ink">
          {t('writePaperInfoTitle')}
        </span>
        {meta?.arxivId ? (
          <button
            type="button"
            title={t('writePaperInfoCopyHint', { label: 'arXiv ID' })}
            onClick={() => copyText(meta.arxivId as string, 'arXiv ID', t)}
            className="max-w-[45%] truncate px-1 text-[11px] tabular-nums text-ds-faint transition hover:text-ds-ink"
          >
            {meta.arxivId}
          </button>
        ) : null}
        <button
          type="button"
          aria-label={t('close')}
          title={t('close')}
          onClick={onClose}
          className="rounded-full p-1 text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {!entry || !meta ? (
          <p className="px-3 py-3 text-[12px] leading-snug text-ds-faint">{t('writePaperInfoEmpty')}</p>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2 pt-1 [scrollbar-width:thin]">
            <MetaRow icon={<BookOpen className="h-3.5 w-3.5" strokeWidth={1.8} />} label={t('writePaperColTitle')}>
              <CopyValue text={meta.title} label={t('writePaperColTitle')} t={t}>
                <PaperTitleText title={meta.title} className="font-medium" />
              </CopyValue>
            </MetaRow>
            {meta.authors.length ? (
              <MetaRow icon={<Users className="h-3.5 w-3.5" strokeWidth={1.8} />} label={t('writePaperMetaAuthorsShort')}>
                <CopyValue text={meta.authors.join(', ')} label={t('writePaperMetaAuthorsShort')} t={t} />
              </MetaRow>
            ) : null}
            {meta.year ? (
              <MetaRow icon={<Calendar className="h-3.5 w-3.5" strokeWidth={1.8} />} label={t('writePaperColYear')}>
                {meta.year}
                {entry.pageCount ? (
                  <span className="ml-2 text-[11.5px] tabular-nums text-ds-faint">
                    {t('writePaperInfoProgress', { page: entry.lastPage ?? 0, total: entry.pageCount })}
                  </span>
                ) : null}
              </MetaRow>
            ) : null}
            <MetaRow icon={<Library className="h-3.5 w-3.5" strokeWidth={1.8} />} label={t('writePaperColVenue')}>
              {meta.venue ? (
                <CopyValue text={meta.venue} label={t('writePaperColVenue')} t={t} />
              ) : (
                <span className="text-ds-faint">-</span>
              )}
            </MetaRow>
            <MetaRow icon={<Tag className="h-3.5 w-3.5" strokeWidth={1.8} />} label={t('writePaperMetaTagsShort')}>
              <TagsEditor entry={entry} t={t} />
            </MetaRow>

            {meta.arxivId || meta.doi || meta.coolPapers ? (
              <div className="flex items-center gap-1.5 px-3 pt-1.5">
                {meta.arxivId ? <LinkChip href={`https://arxiv.org/pdf/${meta.arxivId}`} label="arXiv" color="#B31B1B" /> : null}
                {meta.arxivId ? <LinkChip href={`https://modelscope.cn/papers/${meta.arxivId}`} label={t('writePaperLinkModelScope')} color="#624AFF" /> : null}
                {meta.arxivId ? <LinkChip href={`https://www.alphaxiv.org/abs/${meta.arxivId}`} label="alphaXiv" color="#B33131" /> : null}
                {!meta.arxivId && meta.doi ? <LinkChip href={`https://doi.org/${meta.doi}`} label="DOI" color="#2563EB" /> : null}
                {!meta.arxivId && meta.coolPapers ? (
                  <LinkChip
                    href={`https://papers.cool/${meta.coolPapers.branch}/${meta.coolPapers.id}`}
                    label="papers.cool"
                    color="#16A34A"
                  />
                ) : null}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-1.5 px-3 pt-2">
              <ActionButton
                icon={<Zap className="h-3.5 w-3.5" strokeWidth={1.9} />}
                label={t('writePaperInterpret')}
                onClick={() => {
                  const bridge = usePaperModeStore.getState().composerBridge
                  void interpretPaper({
                    workspaceRoot,
                    settings: settings(),
                    t,
                    unitDir: entry.unitDir,
                    meta,
                    input: bridge?.input ?? '',
                    setInput: bridge?.setInput ?? (() => undefined),
                    onSubmitPrompt: bridge?.submit
                  })
                }}
              />
              <ActionButton
                icon={<Sparkles className="h-3.5 w-3.5" strokeWidth={1.9} />}
                label={t('writePaperAiDigest')}
                onClick={() => void fetchCoolNotes({ workspaceRoot, settings: settings(), t, unitDir: entry.unitDir })}
              />
              <ActionButton
                icon={<ImageDown className="h-3.5 w-3.5" strokeWidth={1.8} />}
                label={t('writePaperPreprocess')}
                onClick={() => void preprocessPaper({ workspaceRoot, settings: settings(), t, unitDir: entry.unitDir })}
              />
              {interpretation ? (
                <ActionButton
                  icon={<FileText className="h-3.5 w-3.5" strokeWidth={1.8} />}
                  label={t('writePaperOpenInterpretation')}
                  onClick={() => void openPaperInterpretation({ workspaceRoot, unitDir: entry.unitDir, path: interpretation.path })}
                />
              ) : null}
            </div>
            <div className="px-3 pt-1.5">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-ds-border-muted bg-ds-main px-2 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <Pencil className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                <span className="truncate">{t('writePaperEditMeta')}</span>
              </button>
            </div>
          </div>
        )}
      </div>
      {editing && entry ? (
        <PaperMetaEditDialog entry={entry} libraryRoot={workspaceRoot} onClose={() => setEditing(false)} />
      ) : null}
    </div>
  )
}
