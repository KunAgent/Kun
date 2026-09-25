import { useState, type FormEvent, type ReactElement } from 'react'
import { FolderInput, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { movePaperUnitsToGroup } from '../../../paper/paper-unit-ops'
import { usePaperStore } from '../../../write/paper/paper-store'

/** Group names are relative paths under `<papersDir>/`; '' is the top level. */
function normalizeGroupInput(value: string): string | null {
  const group = value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  if (!group) return ''
  const segments = group.split('/')
  if (segments.some((segment) => !segment.trim() || segment === '.' || segment === '..')) return null
  return segments.map((segment) => segment.trim()).join('/')
}

/**
 * Move one or more library units into a group (a subdirectory of the papers
 * dir). Existing groups are offered as chips; typing a new name creates it.
 * Open tabs of the moved units are reopened at the new location.
 */
export function PaperMoveGroupDialog({
  unitDirs,
  onClose
}: {
  unitDirs: readonly string[]
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const groups = usePaperModeStore((s) => s.groups)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const target = normalizeGroupInput(value)

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (target === null || busy) return
    setBusy(true)
    const outcome = await movePaperUnitsToGroup(unitDirs, target)
    setBusy(false)
    if (outcome.failed.length) {
      usePaperStore.getState().setNotice({
        tone: 'error',
        message: t('writePaperOpFailed', {
          count: outcome.failed.length,
          message: outcome.failed[0].message === 'save-failed'
            ? t('writePaperModeSaveFailed')
            : outcome.failed[0].message
        })
      })
    } else {
      usePaperStore.getState().setNotice({
        tone: 'success',
        message: t('writePaperMovedToGroup', { count: outcome.done.length, group: target || '/' })
      })
    }
    usePaperModeStore.getState().clearSelection()
    onClose()
  }

  return (
    <div
      className="ds-no-drag fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/18 px-4 backdrop-blur-[2px] dark:bg-black/35"
      onMouseDown={() => { if (!busy) onClose() }}
    >
      <form
        role="dialog"
        aria-label={t('writePaperMoveToGroup')}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
        className="w-full max-w-sm rounded-[24px] border border-ds-border bg-ds-card p-5 shadow-[0_24px_72px_rgba(20,47,95,0.22)]"
      >
        <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-ds-ink">
          <FolderInput className="h-4 w-4 text-accent" strokeWidth={1.9} />
          {t('writePaperMoveToGroup')}
        </h2>
        <p className="mb-3 text-[12px] text-ds-faint">{t('writePaperMoveToGroupHint', { count: unitDirs.length })}</p>
        <input
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={t('writePaperGroupPlaceholder')}
          className="w-full rounded-lg border border-ds-border-muted bg-ds-main px-2.5 py-1.5 text-[13px] text-ds-ink outline-none focus:border-accent/50"
        />
        {target === null ? (
          <p className="mt-1 text-[11.5px] text-red-600 dark:text-red-300">{t('writePaperGroupInvalid')}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setValue('')}
            className="rounded-full border border-ds-border-muted px-2 py-0.5 text-[11.5px] text-ds-muted hover:bg-ds-hover"
          >
            {t('writePaperGroupTopLevel')}
          </button>
          {groups.map((group) => (
            <button
              key={group}
              type="button"
              onClick={() => setValue(group)}
              className={`rounded-full border px-2 py-0.5 text-[11.5px] hover:bg-ds-hover ${
                value === group ? 'border-accent/50 text-accent' : 'border-ds-border-muted text-ds-muted'
              }`}
            >
              {group}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="h-8 rounded-full px-4 text-[12.5px] text-ds-muted hover:bg-ds-hover">
            {t('cancel')}
          </button>
          <button
            type="submit"
            disabled={busy || target === null}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent px-4 text-[12.5px] font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : null}
            {t('writePaperMoveConfirm')}
          </button>
        </div>
      </form>
    </div>
  )
}
