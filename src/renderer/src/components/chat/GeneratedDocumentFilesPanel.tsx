import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ExternalLink,
  FileText,
  FolderOpen,
  Loader2,
  Presentation,
  Sheet,
  type LucideIcon
} from 'lucide-react'
import {
  openWorkspaceFileWithSystemDefault,
  revealWorkspaceFileInFileManager
} from '../../lib/open-workspace-path'
import {
  MAX_INLINE_GENERATED_DOCUMENTS,
  type GeneratedDocumentArtifact
} from './generated-document-artifacts'

type DocumentAction = 'open' | 'reveal'

function formatByteSize(byteSize: number | undefined): string {
  if (typeof byteSize !== 'number' || !Number.isFinite(byteSize) || byteSize <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let value = byteSize
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`
}

function documentKindLabelKey(file: GeneratedDocumentArtifact): string {
  if (file.kind === 'word') return 'generatedDocumentKindWord'
  if (file.kind === 'spreadsheet') return 'generatedDocumentKindSpreadsheet'
  if (file.kind === 'pdf') return 'generatedDocumentKindPdf'
  if (file.kind === 'kun-html') return 'generatedDocumentKindKunPpt'
  return 'generatedDocumentKindPresentation'
}

function documentIcon(file: GeneratedDocumentArtifact): LucideIcon {
  if (file.kind === 'spreadsheet') return Sheet
  if (file.kind === 'presentation' || file.kind === 'kun-html') return Presentation
  return FileText
}

function iconTone(file: GeneratedDocumentArtifact): string {
  if (file.kind === 'spreadsheet') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
  if (file.kind === 'presentation' || file.kind === 'kun-html') {
    return 'bg-orange-500/10 text-orange-600 dark:text-orange-300'
  }
  if (file.kind === 'pdf') return 'bg-red-500/10 text-red-600 dark:text-red-300'
  return 'bg-blue-500/10 text-blue-600 dark:text-blue-300'
}

function GeneratedDocumentCard({
  file,
  workspaceRoot,
  onPreview
}: {
  file: GeneratedDocumentArtifact
  workspaceRoot: string
  onPreview?: (file: GeneratedDocumentArtifact) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [menuOpen, setMenuOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<DocumentAction | null>(null)
  const [failedAction, setFailedAction] = useState<DocumentAction | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const Icon = documentIcon(file)

  useEffect(() => {
    if (!menuOpen) return
    const closeIfOutside = (event: PointerEvent): void => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeIfOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const runAction = async (action: DocumentAction): Promise<void> => {
    if (busyAction) return
    setMenuOpen(false)
    setBusyAction(action)
    setFailedAction(null)
    try {
      const result = action === 'open'
        ? await openWorkspaceFileWithSystemDefault(file.path, workspaceRoot, file.contentSha256)
        : await revealWorkspaceFileInFileManager(file.path, workspaceRoot, file.contentSha256)
      if (!result.ok) {
        setFailedAction(action)
        void window.kunGui?.logError?.('generated-document-open', 'Failed to open generated document', {
          action,
          message: result.message.slice(0, 1000),
          path: file.path.slice(0, 1000)
        })?.catch(() => undefined)
      }
    } catch (error) {
      setFailedAction(action)
      void window.kunGui?.logError?.('generated-document-open', 'Failed to open generated document', {
        action,
        message: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
        path: file.path.slice(0, 1000)
      })?.catch(() => undefined)
    } finally {
      setBusyAction(null)
    }
  }

  const details = [
    t(documentKindLabelKey(file)),
    file.extension,
    formatByteSize(file.byteSize)
  ].filter(Boolean).join(' · ')

  return (
    <article
      data-generated-document-card
      className="relative flex min-w-0 items-center gap-3 rounded-[18px] border border-ds-border-muted bg-ds-card/90 px-4 py-3 shadow-[0_12px_30px_rgba(54,74,116,0.08)]"
      title={file.path}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] ${iconTone(file)}`}>
        <Icon className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-ds-ink">{file.name}</span>
        <span className="mt-0.5 block truncate text-[12px] text-ds-muted">{details}</span>
        {failedAction ? (
          <span className="mt-1 block text-[11.5px] text-red-600 dark:text-red-300">
            {t(failedAction === 'reveal'
              ? 'generatedDocumentRevealFailed'
              : 'generatedDocumentOpenFailed')}
          </span>
        ) : null}
      </span>

      <div ref={menuRef} className="relative flex shrink-0">
        <button
          type="button"
          disabled={!onPreview}
          aria-label={t('generatedDocumentPreviewNamed', { name: file.name })}
          onClick={() => onPreview?.(file)}
          className="inline-flex h-9 items-center rounded-l-xl border border-r-0 border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
        >
          {t('generatedDocumentPreview')}
        </button>
        <button
          type="button"
          disabled={busyAction !== null}
          aria-label={t('generatedDocumentOpenOptions')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-r-xl border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busyAction ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.9} />
          )}
        </button>

        {menuOpen ? (
          <div
            role="menu"
            className="absolute right-0 top-11 z-30 min-w-[220px] overflow-hidden rounded-xl border border-ds-border bg-ds-card p-1.5 shadow-[0_18px_45px_rgba(26,39,72,0.2)]"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => void runAction('open')}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover"
            >
              <ExternalLink className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.9} />
              {t('generatedDocumentOpenSystem')}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void runAction('reveal')}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[12.5px] text-ds-ink transition hover:bg-ds-hover"
            >
              <FolderOpen className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.9} />
              {t('fileTreeRevealInFileManager')}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  )
}

function AllGeneratedDocumentsCard({
  count,
  onOpen
}: {
  count: number
  onOpen?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <button
      type="button"
      data-generated-document-all
      disabled={!onOpen}
      onClick={onOpen}
      className="flex min-w-0 items-center gap-3 rounded-[18px] border border-ds-border-muted bg-ds-card/90 px-4 py-3 text-left shadow-[0_12px_30px_rgba(54,74,116,0.08)] transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-ds-card-muted text-ds-muted">
        <FolderOpen className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-ds-ink">
          {t('generatedDocumentAllFiles', { count })}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-ds-muted">
          {t('generatedDocumentAllFilesHint')}
        </span>
      </span>
      <span className="shrink-0 rounded-xl bg-ds-card-muted px-3 py-2 text-[12.5px] font-medium text-ds-ink">
        {t('generatedDocumentView')}
      </span>
    </button>
  )
}

export function GeneratedDocumentFilesPanel({
  files,
  workspaceRoot,
  onPreview,
  onOpenAll
}: {
  files: readonly GeneratedDocumentArtifact[]
  workspaceRoot: string
  onPreview?: (file: GeneratedDocumentArtifact) => void
  onOpenAll?: (files: readonly GeneratedDocumentArtifact[]) => void
}): ReactElement | null {
  const { t } = useTranslation('common')
  if (files.length === 0) return null
  const inlineFiles = files.slice(0, MAX_INLINE_GENERATED_DOCUMENTS)

  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={t('generatedDocumentFilesTitle')}>
      <div className="text-[12px] font-semibold text-ds-faint">{t('generatedDocumentFilesTitle')}</div>
      <div className="flex min-w-0 flex-col gap-2">
        {inlineFiles.map((file) => (
          <GeneratedDocumentCard
            key={file.path}
            file={file}
            workspaceRoot={workspaceRoot}
            onPreview={onPreview}
          />
        ))}
        <AllGeneratedDocumentsCard
          count={files.length}
          onOpen={onOpenAll ? () => onOpenAll(files) : undefined}
        />
      </div>
    </section>
  )
}
