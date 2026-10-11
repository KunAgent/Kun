import { useEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ToolBlock } from '../../agent/types'
import type { ToolPresentation } from '@shared/tool-presentation'
import { readToolPresentation } from '../../agent/tool-presentation'
import { useTimelineFilePreviewWorkspaceRoot } from './timeline-file-preview-workspace'
import { ToolDetailsContent } from './ToolDetailsContent'

export function ToolBlockDetails({ block }: { block: ToolBlock }): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useTimelineFilePreviewWorkspaceRoot()
  const presentation = readToolPresentation(block)
  const [expanded, setExpanded] = useState(false)
  return <div className="min-w-0" data-tool-block-details>
    <div className="mb-2 flex justify-end">
      <button type="button" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
        onClick={() => setExpanded(true)}><Maximize2 size={12} />{t('toolDetails.expand')}</button>
    </div>
    <ToolDetailsContent presentation={presentation} workspaceRoot={workspaceRoot} />
    {expanded ? <ToolDetailsViewer presentation={presentation} workspaceRoot={workspaceRoot} onClose={() => setExpanded(false)} /> : null}
  </div>
}

function ToolDetailsViewer({ presentation, workspaceRoot, onClose }: {
  presentation: ToolPresentation; workspaceRoot: string; onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    const previous = document.activeElement as HTMLElement | null
    if (typeof dialog?.showModal === 'function') dialog.showModal()
    else dialog?.setAttribute('open', '')
    return () => { if (typeof dialog?.close === 'function') dialog.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  return createPortal(
    <dialog ref={ref} aria-label={presentation.title ?? t('toolDetails.title')}
      className="ds-no-drag fixed inset-0 m-auto max-h-[90vh] w-[min(1100px,calc(100vw-32px))] max-w-none overflow-hidden rounded-2xl border border-ds-border bg-ds-card p-0 text-ds-ink shadow-2xl backdrop:bg-black/45"
      onCancel={(event) => { event.preventDefault(); onClose() }}>
      <header className="flex items-center justify-between gap-4 border-b border-ds-border px-5 py-3">
        <h2 className="min-w-0 truncate text-sm font-semibold">{presentation.title ?? presentation.name ?? t('toolDetails.title')}</h2>
        <button type="button" className="rounded-md p-1.5 hover:bg-ds-hover" aria-label={t('toolDetails.close')} onClick={onClose}><X size={18} /></button>
      </header>
      <div className="max-h-[calc(90vh-60px)] overflow-auto p-5"><ToolDetailsContent presentation={presentation} workspaceRoot={workspaceRoot} expanded /></div>
    </dialog>, document.body)
}
