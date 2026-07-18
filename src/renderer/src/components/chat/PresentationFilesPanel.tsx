import type { ReactElement } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ExternalLink, FolderOpen, Loader2, Presentation as PresentationIcon } from 'lucide-react'
import {
  openWorkspaceFileWithSystemDefault,
  revealWorkspaceFileInFileManager
} from '../../lib/open-workspace-path'
import type { PresentationFileArtifact } from './presentation-file-artifacts'

type PresentationAction = 'open' | 'reveal'

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

function PresentationFileCard({
  file,
  workspaceRoot
}: {
  file: PresentationFileArtifact
  workspaceRoot: string
}): ReactElement {
  const { t } = useTranslation('common')
  const [menuOpen, setMenuOpen] = useState(false)
  const [busyAction, setBusyAction] = useState<PresentationAction | null>(null)
  const [failedAction, setFailedAction] = useState<PresentationAction | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

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

  const runAction = async (action: PresentationAction): Promise<void> => {
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
        void window.kunGui?.logError?.('presentation-open', 'Failed to open presentation artifact', {
          action,
          message: result.message.slice(0, 1000),
          path: file.path.slice(0, 1000)
        })?.catch(() => undefined)
      }
    } catch (error) {
      setFailedAction(action)
      void window.kunGui?.logError?.('presentation-open', 'Failed to open presentation artifact', {
        action,
        message: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
        path: file.path.slice(0, 1000)
      })?.catch(() => undefined)
    } finally {
      setBusyAction(null)
    }
  }

  const kindLabel = file.kind === 'kun-html'
    ? t('presentationKindKunHtml')
    : t('presentationKindPowerPoint')
  const details = [kindLabel, file.extension, formatByteSize(file.byteSize)].filter(Boolean).join(' · ')
  const busy = busyAction !== null

  return (
    <article
      className="relative flex min-w-0 items-center gap-3 rounded-[18px] border border-ds-border-muted bg-ds-card/90 px-4 py-3 shadow-[0_12px_30px_rgba(54,74,116,0.08)]"
      title={file.path}
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-orange-500/10 text-orange-600 dark:text-orange-300">
        <PresentationIcon className="h-5 w-5" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-ds-ink">{file.name}</span>
        <span className="mt-0.5 block truncate text-[12px] text-ds-muted">{details}</span>
        {failedAction ? (
          <span className="mt-1 block text-[11.5px] text-red-600 dark:text-red-300">
            {t(failedAction === 'reveal' ? 'presentationRevealFailed' : 'presentationOpenFailed')}
          </span>
        ) : null}
      </span>

      <div ref={menuRef} className="relative flex shrink-0">
        <button
          type="button"
          disabled={busy}
          aria-label={t('presentationOpenSystem')}
          onClick={() => void runAction('open')}
          className="inline-flex h-9 items-center gap-1.5 rounded-l-xl border border-r-0 border-ds-border bg-ds-card px-3 text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-55"
        >
          {busyAction === 'open' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
          ) : (
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.9} />
          )}
          {t('presentationOpen')}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-label={t('presentationOpenOptions')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((value) => !value)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-r-xl border border-ds-border bg-ds-card text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-55"
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.9} />
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
              {t('presentationOpenSystem')}
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

export function PresentationFilesPanel({
  files,
  workspaceRoot
}: {
  files: readonly PresentationFileArtifact[]
  workspaceRoot: string
}): ReactElement | null {
  const { t } = useTranslation('common')
  if (files.length === 0) return null

  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={t('presentationFilesTitle')}>
      <div className="text-[12px] font-semibold text-ds-faint">{t('presentationFilesTitle')}</div>
      <div className="flex min-w-0 flex-col gap-2">
        {files.map((file) => (
          <PresentationFileCard key={file.path} file={file} workspaceRoot={workspaceRoot} />
        ))}
      </div>
    </section>
  )
}
