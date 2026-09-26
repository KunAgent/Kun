import { useState, type ReactElement } from 'react'
import { ChevronDown, ChevronUp, Loader2, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWriteWorkspaceStore } from '../../../write/write-workspace-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { newPaperRequestId, usePaperStore } from '../../../write/paper/paper-store'

/** Import a discover hit into the library, or show that it is already there. */
export function ImportButton({
  input,
  workspaceRoot,
  t
}: {
  input: string
  workspaceRoot: string
  t: (key: string) => string
}): ReactElement | null {
  const entries = usePaperModeStore((s) => s.entries)
  const refreshEntries = usePaperModeStore((s) => s.refreshEntries)
  const paperReading = useWriteWorkspaceStore((s) => s.paperReading)
  const [busy, setBusy] = useState(false)
  const inLibrary = entries.some(
    (e) =>
      e.meta.arxivId === input ||
      e.meta.coolPapers?.id === input ||
      e.meta.doi?.toLowerCase() === input.toLowerCase()
  )
  if (inLibrary) {
    return (
      <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700 dark:text-emerald-300">
        {t('writePaperRefInLibrary')}
      </span>
    )
  }
  const run = async (): Promise<void> => {
    if (busy || typeof window.kunGui?.paperImport !== 'function') return
    setBusy(true)
    try {
      const result = await window.kunGui.paperImport({
        workspaceRoot,
        input,
        parentDir: paperReading.papersDir || 'papers',
        requestId: newPaperRequestId()
      })
      if (result.ok) refreshEntries()
      else usePaperStore.getState().setNotice({ tone: 'error', message: result.message })
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void run()}
      className="inline-flex shrink-0 items-center gap-1 rounded-full border border-ds-border px-2 py-1 text-[11.5px] font-medium text-ds-muted transition hover:border-accent-tint/40 hover:bg-accent-tint/[0.06] hover:text-accent disabled:opacity-60"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
      {t('writePaperImport')}
    </button>
  )
}

/** Abstract with an expand/collapse affordance (site-like card body). */
export function ExpandableAbstract({ text }: { text: string }): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1.5">
      <p
        className={`text-[11.5px] leading-[1.45] text-ds-muted ${open ? '' : 'line-clamp-3'}`}
      >
        {text}
      </p>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="mt-0.5 inline-flex items-center gap-0.5 text-[10.5px] font-medium text-accent transition hover:brightness-110"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {open ? t('writePaperDiscoverShowLess') : t('writePaperDiscoverShowMore')}
      </button>
    </div>
  )
}
