import { FileText, MoreHorizontal } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { PaperLibrarySort, PaperLibrarySortKey } from '@shared/paper/paper-library-types'
import type { PaperSpaceItem } from '../../../paper/paper-space-store'
import { PaperTitleText } from '../PaperTitleText'
import { paperByline, statusLabelKey } from './PaperLibraryTable'

type Props = {
  items: PaperSpaceItem[]
  selection: ReadonlySet<string>
  sort: PaperLibrarySort
  onToggle: (key: string) => void
  onToggleAll: () => void
  onSort: (key: PaperLibrarySortKey) => void
  onOpen: (item: PaperSpaceItem) => void
  onMenu: (item: PaperSpaceItem, x: number, y: number) => void
}

export function PapersLibraryTable({ items, selection, sort, onToggle, onToggleAll, onSort, onOpen, onMenu }: Props): ReactElement {
  const { t, i18n } = useTranslation('common')
  const allSelected = items.length > 0 && items.every((item) => selection.has(item.key))
  const header = (label: string, key: PaperLibrarySortKey): ReactElement => (
    <button type="button" className="papers-table-sort" onClick={() => onSort(key)}>
      {label}{sort.key === key ? <span aria-hidden>{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span> : null}
    </button>
  )
  const date = (value: string | undefined): string => {
    const time = value ? Date.parse(value) : Number.NaN
    return Number.isNaN(time) ? '—' : new Intl.DateTimeFormat(i18n.language, { month: 'short', day: 'numeric' }).format(time)
  }
  return (
    <table className="papers-library-table">
      <thead>
        <tr>
          <th className="papers-check-cell">
            <label className="papers-check-hit">
              <input type="checkbox" checked={allSelected} onChange={onToggleAll} aria-label={t('writePaperSelectAll')} />
            </label>
          </th>
          <th aria-sort={sort.key === 'title' ? sort.dir === 'asc' ? 'ascending' : 'descending' : undefined}>{header(t('writePaperColTitle'), 'title')}</th>
          <th className="papers-status-cell" aria-sort={sort.key === 'status' ? sort.dir === 'asc' ? 'ascending' : 'descending' : undefined}>{header(t('writePaperColStatus'), 'status')}</th>
          <th className="papers-tags-cell">{t('writePaperMetaTagsShort')}</th>
          <th className="papers-date-cell" aria-sort={sort.key === 'importedAt' ? sort.dir === 'asc' ? 'ascending' : 'descending' : undefined}>{header(t('writePaperColAdded'), 'importedAt')}</th>
          <th className="papers-menu-cell"><span className="sr-only">{t('paperSpaceActions')}</span></th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          const { entry } = item
          const status = entry.meta.status ?? 'unread'
          const byline = paperByline(entry.meta)
          return (
            <tr key={item.key} data-paper-source={item.libraryRoot} data-paper-unit={entry.unitDir} data-selected={selection.has(item.key) || undefined}
              onContextMenu={(event) => { event.preventDefault(); onMenu(item, event.clientX, event.clientY) }}>
              <td className="papers-check-cell">
                <label className="papers-check-hit">
                  <input type="checkbox" checked={selection.has(item.key)} onChange={() => onToggle(item.key)} aria-label={entry.meta.title} />
                </label>
              </td>
              <td>
                <div className="papers-title-cell">
                  <div className="papers-pdf-thumb" aria-hidden><FileText size={24} strokeWidth={1.25} /></div>
                  <div className="papers-title-info">
                    <button type="button" className="papers-title-button" onClick={() => onOpen(item)}>
                      <PaperTitleText title={entry.meta.title} />
                    </button>
                    {byline ? <div className="papers-paper-byline" title={byline}>{byline}</div> : null}
                    <div className="papers-paper-meta">
                      <FileText size={12} strokeWidth={1.75} />
                      <span>{t(entry.hasPdf ? 'paperSpacePdfReady' : 'writePaperMissingPdf')}</span>
                      <span aria-hidden>·</span>
                      <span>{t(entry.hasNotes ? 'paperSpaceNotesReady' : 'paperSpaceNoNotes')}</span>
                    </div>
                  </div>
                </div>
              </td>
              <td className="papers-status-cell"><span className={`papers-status is-${status}`}><span aria-hidden />{t(statusLabelKey(status))}</span></td>
              <td className="papers-tags-cell">
                <div className="papers-tags">{(entry.meta.tags ?? []).slice(0, 2).map((tag) => <span className="papers-tag" key={tag} title={tag}>{tag}</span>)}
                  {(entry.meta.tags?.length ?? 0) > 2 ? <span className="papers-tag">+{entry.meta.tags!.length - 2}</span> : null}</div>
              </td>
              <td className="papers-date-cell" title={entry.meta.importedAt}>{date(entry.meta.importedAt)}</td>
              <td className="papers-menu-cell">
                <button type="button" className="papers-icon-button" aria-label={t('paperSpaceMoreFor', { title: entry.meta.title })}
                  onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); onMenu(item, box.right, box.bottom) }}>
                  <MoreHorizontal size={18} strokeWidth={1.75} />
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
