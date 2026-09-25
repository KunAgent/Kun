import { useState, type ReactElement } from 'react'
import { GraduationCap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { usePaperStore } from '../../write/paper/paper-store'
import { useRemoteMobileLayout } from '../../lib/remote-mobile'
import { PAPER_MODE_SWITCH_CANCELED, togglePaperMode } from '../../paper/paper-mode-actions'

/**
 * Full-width sidebar row that toggles the paper-mode workbench surface (§3.1).
 * Shared by the docs and papers sidebars so the control never moves. Hidden on
 * the remote mobile layout (first version ships desktop-only).
 */
export function PaperModeToggle(): ReactElement | null {
  const { t } = useTranslation('common')
  const enabled = useWriteWorkspaceStore((s) => s.paperMode.enabled)
  const [pending, setPending] = useState(false)
  const remoteMobile = useRemoteMobileLayout()

  const onChange = (next: boolean): void => {
    if (pending || next === enabled) return
    setPending(true)
    void togglePaperMode()
      .then((result) => {
        if (!result.ok && result.message !== PAPER_MODE_SWITCH_CANCELED) {
          usePaperStore.getState().setNotice({
            tone: 'error',
            message: result.message === 'save-failed'
              ? t('writePaperModeSaveFailed')
              : result.message
          })
        }
      })
      .finally(() => setPending(false))
  }

  if (remoteMobile) return null

  return (
    <button
      type="button"
      data-cursor-spotlight-target
      role="switch"
      aria-checked={enabled}
      aria-label={t('writePaperModeToggle')}
      disabled={pending}
      title={`${t('writePaperModeToggleTitle')} · ${enabled ? t('switchOn') : t('switchOff')}`}
      onClick={() => onChange(!enabled)}
      className="ds-sidebar-command-row flex min-h-9 w-full items-center gap-2.5 rounded-full border border-transparent px-3 py-1.5 text-[13px] font-normal text-ds-muted transition hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 disabled:cursor-wait disabled:opacity-60"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-ds-muted">
        <GraduationCap className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1 truncate text-left">{t('writePaperModeToggle')}</span>
      <span
        className={`ds-focus-mode-toggle-track relative h-4 w-7 shrink-0 rounded-full transition ${
          enabled
            ? 'bg-accent/80 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]'
            : 'bg-slate-300/75 shadow-[inset_0_0_0_1px_rgba(100,116,139,0.16)] dark:bg-white/[0.14] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
        }`}
        aria-hidden="true"
      >
        <span
          className={`ds-focus-mode-toggle-thumb absolute left-0.5 top-0.5 h-3 w-3 rounded-full bg-white shadow-[0_1px_3px_rgba(20,47,95,0.24)] transition-transform ${
            enabled ? 'translate-x-3' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  )
}
