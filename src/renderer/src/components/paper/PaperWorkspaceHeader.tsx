import { FolderOpen, FolderPlus, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ReactElement } from 'react'
import { useWriteWorkspaceStore, writeBasenameFromPath } from '../../write/write-workspace-store'
import { normalizePath } from '../../write/write-workspace-store-helpers'
import { usePaperWorkspaceBootstrapStore } from '../../paper/paper-workspace-bootstrap'
import { usePaperWorkspaceActions } from './use-paper-workspace-actions'

/** Always exposes the mounted root, including when the sidebar is collapsed. */
export function PaperWorkspaceHeader(): ReactElement {
  const { t } = useTranslation('common')
  const defaultRoot = usePaperWorkspaceBootstrapStore((state) => state.defaultWorkspaceRoot)
  const root = useWriteWorkspaceStore((state) => normalizePath(state.workspaceRoot))
  const libraries = useWriteWorkspaceStore((state) => state.paperMode.libraries)
  const { busy, error, switchWorkspace, chooseWorkspace } = usePaperWorkspaceActions()
  const roots = [...new Set([root, ...libraries.map(normalizePath)].filter(Boolean))]

  return (
    <header aria-busy={busy} data-testid="paper-workspace-header" className="shrink-0 border-b border-ds-border-muted bg-ds-main px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-tint/10 text-accent" aria-hidden="true">
          <FolderOpen className="h-4.5 w-4.5" strokeWidth={1.7} />
        </div>
        <label className="min-w-0 flex-1 basis-40">
          <span className="mb-0.5 block text-[11px] font-medium text-ds-faint">{t('paperWorkspaceCurrent')}</span>
          <select
            data-testid="paper-workspace-select"
            value={root}
            disabled={busy}
            aria-label={t('paperWorkspaceSwitch')}
            title={root}
            onChange={(event) => void switchWorkspace(event.target.value)}
            className="block h-7 w-full min-w-0 max-w-full rounded-md border border-ds-border-muted bg-ds-card px-2 text-[13px] font-medium text-ds-ink outline-none transition focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          >
            {roots.length === 0 ? <option value="">{t('writePaperModeNoLibraries')}</option> : null}
            {roots.map((value) => (
              <option key={value} value={value}>{value === defaultRoot ? t('paperWorkspaceDefaultName') : writeBasenameFromPath(value) || value} · {value}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-testid="paper-workspace-add"
          disabled={busy}
          onClick={() => void chooseWorkspace()}
          className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg border border-ds-border-muted px-2.5 py-1.5 text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />}
          {t('paperWorkspaceAddFolder')}
        </button>
      </div>
      <p className="mt-1.5 truncate text-[11px] text-ds-faint" title={root}>{root}</p>
      {error ? <p role="alert" className="mt-2 break-words text-[12px] text-red-600 dark:text-red-300">{error}</p> : null}
    </header>
  )
}
