import { useState, type ReactElement } from 'react'
import { FolderPlus, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { createPaperFolder } from '../../../paper/paper-import-target'

/**
 * Inline "new folder" input at the top of the sidebar paper tree. Enter
 * creates `<papersDir>/<name>` (nested with `/`); Escape or blur cancels.
 */
export function PaperNewFolderRow({
  libraryRoot,
  onDone
}: {
  /** Library the folder is created in; defaults to the mounted root. */
  libraryRoot?: string
  onDone: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (): Promise<void> => {
    if (busy) return
    if (!value.trim()) {
      onDone()
      return
    }
    setBusy(true)
    const result = await createPaperFolder(value, libraryRoot)
    setBusy(false)
    if (result.ok) onDone()
    else setError(result.message === 'invalid' ? t('paperImportFolderInvalid') : result.message)
  }

  return (
    <div className="px-1 pb-1 pt-0.5">
      <div className="flex h-7 items-center gap-1.5 rounded-md border border-[var(--ds-accent)] bg-ds-main px-1.5">
        {busy
          ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-ds-faint" />
          : <FolderPlus className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />}
        <input
          autoFocus
          value={value}
          disabled={busy}
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              onDone()
            }
          }}
          onBlur={() => {
            if (!busy && !error) void submit()
          }}
          placeholder={t('paperImportFolderNewPlaceholder')}
          aria-label={t('paperImportFolderNew')}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-ds-ink outline-none placeholder:text-ds-faint"
        />
      </div>
      {error ? <p className="mt-1 px-1 text-[11px] leading-4 text-red-600 dark:text-red-300">{error}</p> : null}
    </div>
  )
}
