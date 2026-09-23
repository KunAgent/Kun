import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Download, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ExcalidrawSurface } from '../../whiteboard/excalidraw-surface'
import { WORK_WHITEBOARD_DIR } from '../../write/work-whiteboard'
import { exportExcalidrawPngSidecar } from '../../whiteboard/excalidraw-apply'
import {
  isExcalidrawSceneEmpty,
  resolveExcalidrawSceneForPrompt
} from '../../whiteboard/excalidraw-persistence'

export function RoomExcalidrawPanel({
  boardId,
  workspaceRoot,
  title,
  onClose
}: {
  boardId: string
  workspaceRoot: string
  title?: string
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const [exported, setExported] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const exportPng = useCallback(async () => {
    setExporting(true)
    setExportError('')
    setExported(false)
    try {
      const scene = await resolveExcalidrawSceneForPrompt(workspaceRoot, boardId, WORK_WHITEBOARD_DIR)
      if (!scene || isExcalidrawSceneEmpty(scene)) {
        throw new Error(t('roomExcalidrawEmpty', { defaultValue: 'The board has no content to export.' }))
      }
      const result = await exportExcalidrawPngSidecar({
        workspaceRoot,
        identityId: boardId,
        baseDir: WORK_WHITEBOARD_DIR,
        scene
      })
      if (!result.ok) throw new Error(result.error.message)
      setExported(true)
    } catch (error) {
      setExportError(error instanceof Error ? error.message : String(error))
    } finally {
      setExporting(false)
    }
  }, [boardId, t, workspaceRoot])

  return (
    <div className="room-excalidraw-panel" role="dialog" aria-label={title ?? t('roomExcalidrawTitle', { defaultValue: 'Excalidraw board' })}>
      <header className="room-excalidraw-header">
        <strong className="min-w-0 truncate">{title ?? t('roomExcalidrawTitle', { defaultValue: 'Excalidraw board' })}</strong>
        <button
          type="button"
          onClick={() => void exportPng()}
          disabled={exporting}
          aria-label={t('roomExcalidrawExport', { defaultValue: 'Export PNG' })}
        >
          <Download size={16} />
          <span>{exporting ? t('roomExcalidrawExporting', { defaultValue: 'Exporting…' }) : t('roomExcalidrawExport', { defaultValue: 'Export PNG' })}</span>
        </button>
        <button type="button" onClick={onClose} aria-label={t('roomsClose')}>
          <X size={18} />
        </button>
      </header>
      {exported ? <p className="room-excalidraw-status">{t('roomExcalidrawExported', { defaultValue: 'PNG exported to the board directory.' })}</p> : null}
      {exportError ? <p className="room-excalidraw-status is-error" role="alert">{exportError}</p> : null}
      <div className="room-excalidraw-canvas">
        <ExcalidrawSurface workspaceRoot={workspaceRoot} identityId={boardId} baseDir={WORK_WHITEBOARD_DIR} />
      </div>
    </div>
  )
}
