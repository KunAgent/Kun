import { useCallback, useRef, useState, type ReactElement } from 'react'
import { Download, FileCode2, FileImage, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DesignExportFormat } from '@shared/design-export'
import type { DesignArtifact } from '../../../../design/design-types'
import { useDesignWorkspaceStore } from '../../../../design/design-workspace-store'
import { exportDesignPrototypeArtifact } from '../canvas-viewport/canvas-viewport-export'
import {
  CANVAS_CHROME_MENU,
  CanvasChromeMenuItem,
  useCanvasChromeDismiss
} from './canvas-chrome-primitives'

/** Download one board's HTML (or a PDF render of it) through the design export flow. */
export function BoardDownloadMenu({
  artifact,
  workspaceRoot,
  buttonClassName,
  iconClassName = 'h-3.5 w-3.5',
  align = 'right'
}: {
  artifact: DesignArtifact
  workspaceRoot: string
  buttonClassName: string
  iconClassName?: string
  align?: 'left' | 'right'
}): ReactElement {
  const { t } = useTranslation('common')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  useCanvasChromeDismiss(open, rootRef, close)

  const download = (format: DesignExportFormat): void => {
    if (busy) return
    setBusy(true)
    setOpen(false)
    const setFileError = useDesignWorkspaceStore.getState().setFileError
    setFileError(null)
    void exportDesignPrototypeArtifact({
      artifacts: [artifact],
      preferredArtifactId: artifact.id,
      workspaceRoot,
      format,
      unavailableMessage: t('designPrototypePlayUnavailable'),
      failedMessage: t('designExportFailed')
    })
      .catch((error: unknown) => setFileError(error instanceof Error ? error.message : String(error)))
      .finally(() => setBusy(false))
  }

  const label = t('canvasBoardDownload')
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={buttonClassName}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
        disabled={busy}
        title={label}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="menu"
        data-canvas-board-download="true"
      >
        {busy
          ? <Loader2 className={`${iconClassName} animate-spin`} strokeWidth={1.9} />
          : <Download className={iconClassName} strokeWidth={1.9} />}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className={`${CANVAS_CHROME_MENU} top-full mt-1.5 w-44 ${align === 'right' ? 'right-0' : 'left-0'}`}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <CanvasChromeMenuItem
            icon={<FileCode2 className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('designExportHtml')}
            onSelect={() => download('html')}
          />
          <CanvasChromeMenuItem
            icon={<FileImage className="h-3.5 w-3.5" strokeWidth={1.8} />}
            label={t('designExportPdf')}
            onSelect={() => download('pdf')}
          />
        </div>
      ) : null}
    </div>
  )
}
