import { useMemo, useState, type ReactElement } from 'react'
import { Check, Folder, Inbox, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePaperModeStore } from '../../../paper/paper-mode-store'

/** Folders nested under a listed parent are indented by their depth. */
function folderRows(groups: readonly string[]): Array<{ folder: string; label: string; depth: number }> {
  return groups.map((folder) => {
    const segments = folder.split('/')
    return { folder, label: segments[segments.length - 1] ?? folder, depth: segments.length - 1 }
  })
}

/**
 * Searchable list of the library's folders (with paper counts) for the
 * "put into an existing folder" choice of the import sheet.
 */
export function PaperImportFolderList({
  value,
  onChange
}: {
  value: string
  onChange: (folder: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const groups = usePaperModeStore((s) => s.groups)
  const entries = usePaperModeStore((s) => s.entries)
  const [query, setQuery] = useState('')
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of entries) map.set(entry.group, (map.get(entry.group) ?? 0) + 1)
    return map
  }, [entries])
  const needle = query.trim().toLowerCase()
  const rows = useMemo(
    () => folderRows(groups).filter((row) => !needle || row.folder.toLowerCase().includes(needle)),
    [groups, needle]
  )
  const rowClass = (active: boolean): string =>
    `flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12.5px] transition ${
      active ? 'bg-[var(--ds-accent-soft)] font-medium text-ds-ink' : 'text-ds-ink hover:bg-ds-hover'
    }`
  return (
    <div className="mt-2">
      <label className="flex h-8 items-center gap-1.5 rounded-lg border border-ds-border-muted bg-ds-main px-2.5 focus-within:border-[var(--ds-accent)]">
        <Search className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('paperImportSheetSearchFolder')}
          aria-label={t('paperImportSheetSearchFolder')}
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ds-ink outline-none focus-visible:outline-none placeholder:text-ds-faint"
        />
      </label>
      <div role="listbox" aria-label={t('paperImportFolderTitle')} className="mt-1.5 max-h-[180px] overflow-y-auto">
        {!needle ? (
          <button type="button" role="option" aria-selected={!value} onClick={() => onChange('')} className={rowClass(!value)}>
            <Inbox className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
            <span className="min-w-0 flex-1 truncate">
              {t('paperImportFolderRoot')}
              <span className="ml-1.5 text-[11px] font-normal text-ds-faint">{t('paperImportFolderRootHint')}</span>
            </span>
            <span className="text-[11px] tabular-nums text-ds-faint">{counts.get('') ?? 0}</span>
            {!value ? <Check className="h-3.5 w-3.5 text-[var(--ds-accent)]" strokeWidth={2} /> : null}
          </button>
        ) : null}
        {rows.map((row) => (
          <button
            key={row.folder}
            type="button"
            role="option"
            aria-selected={value === row.folder}
            title={row.folder}
            onClick={() => onChange(row.folder)}
            style={{ paddingLeft: 8 + row.depth * 14 }}
            className={rowClass(value === row.folder)}
          >
            <Folder className="h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.8} />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            <span className="text-[11px] tabular-nums text-ds-faint">{counts.get(row.folder) ?? 0}</span>
            {value === row.folder ? <Check className="h-3.5 w-3.5 text-[var(--ds-accent)]" strokeWidth={2} /> : null}
          </button>
        ))}
        {!rows.length && needle ? (
          <p className="px-2 py-3 text-center text-[12px] text-ds-faint">{t('paperImportSheetNoFolder')}</p>
        ) : null}
      </div>
    </div>
  )
}
