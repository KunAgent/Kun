import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Check, ChevronDown, Copy, Pencil, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  activePageIdOf,
  addPage,
  claimUnpagedShapes,
  deletePage,
  duplicatePage,
  listPages,
  pageShapeCount,
  renamePage,
  switchPage
} from '../../../../design/canvas/canvas-pages'
import { useCanvasShapeStore } from '../../../../design/canvas/canvas-shape-store'
import {
  CANVAS_CHROME_MENU,
  CANVAS_CHROME_MENU_SEPARATOR,
  CanvasChromeMenuItem,
  canvasChromeButtonClass,
  useCanvasChromeDismiss
} from './canvas-chrome-primitives'

/** Left-most toolbar control: the open page, with a menu to switch and manage pages. */
export function CanvasPageSwitcher({ compact }: { compact: boolean }): ReactElement {
  const { t } = useTranslation('common')
  const doc = useCanvasShapeStore((s) => s.document)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const close = useCallback(() => {
    setOpen(false)
    setRenamingId(null)
  }, [])
  useCanvasChromeDismiss(open, rootRef, close)
  // New boards from the agent or artifact sync join the open page.
  useEffect(() => { claimUnpagedShapes() }, [doc.objects, doc.pages, doc.activePageId])

  const pages = listPages(doc)
  const activeId = activePageIdOf(doc)
  const labelOf = (index: number): string => pages[index].name || t('canvasPageDefaultName', { n: index + 1 })
  const activeIndex = Math.max(0, pages.findIndex((page) => page.id === activeId))
  const label = t('canvasPageMenu')

  const remove = (pageId: string, index: number): void => {
    const count = pageShapeCount(doc, pageId)
    if (count > 0 && !window.confirm(t('canvasPageDeleteConfirm', { name: labelOf(index), count }))) return
    deletePage(pageId)
  }

  return (
    <div ref={rootRef} className="relative flex items-center" data-canvas-page-switcher="true">
      <button
        type="button"
        className={`${canvasChromeButtonClass(open, compact)} w-auto max-w-[160px] gap-1 px-2 text-[12.5px] font-medium`}
        onClick={() => setOpen((current) => !current)}
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="truncate">{labelOf(activeIndex)}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-ds-faint" strokeWidth={2} />
      </button>
      {open ? (
        <div role="menu" aria-label={label} className={`${CANVAS_CHROME_MENU} left-0 top-full mt-2 w-64`}>
          {pages.map((page, index) => (
            <div key={page.id} className="group/page flex items-center gap-1">
              {renamingId === page.id ? (
                <input
                  autoFocus
                  defaultValue={page.name || labelOf(index)}
                  aria-label={t('canvasPageRename')}
                  className="mx-1 my-0.5 h-7 min-w-0 flex-1 rounded-[6px] border border-accent bg-ds-card px-2 text-[12.5px] text-ds-ink outline-none"
                  onBlur={(event) => {
                    renamePage(page.id, event.currentTarget.value)
                    setRenamingId(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                    if (event.key === 'Escape') setRenamingId(null)
                  }}
                />
              ) : (
                <CanvasChromeMenuItem
                  role="menuitemradio"
                  checked={page.id === activeId}
                  icon={page.id === activeId
                    ? <Check className="h-3.5 w-3.5 text-accent" strokeWidth={2.2} />
                    : <span className="h-3.5 w-3.5" />}
                  label={labelOf(index)}
                  shortcut={String(pageShapeCount(doc, page.id))}
                  onSelect={() => { switchPage(page.id); close() }}
                />
              )}
              {renamingId === page.id ? null : (
                <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover/page:opacity-100 focus-within:opacity-100">
                  <button type="button" className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ds-faint hover:bg-ds-hover hover:text-ds-ink" onClick={() => setRenamingId(page.id)} aria-label={t('canvasPageRename')} title={t('canvasPageRename')}>
                    <Pencil className="h-3 w-3" strokeWidth={1.9} />
                  </button>
                  <button type="button" className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ds-faint hover:bg-ds-hover hover:text-ds-ink" onClick={() => { duplicatePage(page.id); close() }} aria-label={t('canvasPageDuplicate')} title={t('canvasPageDuplicate')}>
                    <Copy className="h-3 w-3" strokeWidth={1.9} />
                  </button>
                  {pages.length > 1 ? (
                    <button type="button" className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ds-faint hover:bg-ds-hover hover:text-ds-danger" onClick={() => remove(page.id, index)} aria-label={t('canvasPageDelete')} title={t('canvasPageDelete')}>
                      <Trash2 className="h-3 w-3" strokeWidth={1.9} />
                    </button>
                  ) : null}
                </span>
              )}
            </div>
          ))}
          <div className={CANVAS_CHROME_MENU_SEPARATOR} />
          <CanvasChromeMenuItem
            icon={<Plus className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('canvasPageNew')}
            onSelect={() => { addPage(); close() }}
          />
        </div>
      ) : null}
    </div>
  )
}
