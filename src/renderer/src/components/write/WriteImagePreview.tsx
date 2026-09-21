import { useEffect, useState, type ReactElement } from 'react'
import { Check, Copy, Download, ExternalLink, Image as ImageIcon, Minus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { writeBasenameFromPath, writeRelativeToWorkspace } from '../../write/write-workspace-store'
import { copyImageToClipboard } from '../../lib/copy-image-to-clipboard'
import { clamp, toolbarIconButtonClass, toolbarMenuButtonClass } from './write-workspace-view-utils'

const IMAGE_MIN_ZOOM = 25
const IMAGE_MAX_ZOOM = 300
const IMAGE_ZOOM_STEP = 25

type WriteImagePreviewProps = {
  src: string
  filePath: string
  mimeType: string
  size: number
  workspaceRoot: string
}

type WriteImageFitMode = 'fit' | 'actual'
type WriteImageSaveState = 'idle' | 'saving'
type WriteImageCopyState = 'idle' | 'copying' | 'copied' | 'failed'

function clampImageZoom(value: number): number {
  return clamp(Math.round(value), IMAGE_MIN_ZOOM, IMAGE_MAX_ZOOM)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function WriteImagePreview({
  src,
  filePath,
  mimeType,
  size,
  workspaceRoot
}: WriteImagePreviewProps): ReactElement {
  const { t } = useTranslation('common')
  const [dimensions, setDimensions] = useState<{
    width: number
    height: number
  } | null>(null)
  const [fitMode, setFitMode] = useState<WriteImageFitMode>('fit')
  const [zoom, setZoom] = useState(100)
  const [saveState, setSaveState] = useState<WriteImageSaveState>('idle')
  const [copyState, setCopyState] = useState<WriteImageCopyState>('idle')
  const fileName = writeBasenameFromPath(filePath)
  const relativePath = writeRelativeToWorkspace(workspaceRoot, filePath)
  const actualMode = fitMode === 'actual'
  useEffect(() => {
    setDimensions(null)
  }, [src, filePath])
  const openImage = (): void => {
    if (typeof window.kunGui?.openEditorPath !== 'function') return
    void window.kunGui.openEditorPath({ path: filePath, workspaceRoot, editorId: 'system' }).catch(() => undefined)
  }
  const saveImageAs = async (): Promise<void> => {
    if (saveState === 'saving' || typeof window.kunGui?.saveWorkspaceFileAs !== 'function') return
    setSaveState('saving')
    try {
      await window.kunGui.saveWorkspaceFileAs({
        suggestedName: fileName,
        sourcePath: filePath,
        workspaceRoot,
        mimeType
      })
    } catch {
      // The native save dialog reports failures elsewhere; keep the preview usable.
    } finally {
      setSaveState('idle')
    }
  }
  const copyLabel =
    copyState === 'copied'
      ? t('copySuccess')
      : copyState === 'failed'
        ? t('copyFailed')
        : t('imagePreviewCopy')
  const copyImage = async (): Promise<void> => {
    if (copyState === 'copying') return
    setCopyState('copying')
    try {
      const result = await copyImageToClipboard({
        path: filePath,
        workspaceRoot,
        dataUrl: src
      })
      setCopyState(result.ok ? 'copied' : 'failed')
    } catch {
      setCopyState('failed')
    }
    window.setTimeout(() => setCopyState('idle'), 1400)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-ds-card px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="flex min-h-[72px] shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-1 py-3 sm:px-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <ImageIcon className="h-[18px] w-[18px]" strokeWidth={1.9} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold text-ds-ink">{fileName}</div>
            <div className="mt-1 truncate text-[12px] text-ds-faint" title={relativePath}>
              {relativePath}
            </div>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <div className="flex items-center rounded-xl bg-ds-hover/70 p-1 ring-1 ring-ds-border-muted">
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-lg bg-ds-card px-3 text-[12.5px] font-semibold text-accent shadow-sm"
              aria-pressed="true"
              aria-label={t('writeModePreview')}
            >
              {t('writeModePreview')}
            </button>
            <button
              type="button"
              onClick={openImage}
              className="inline-flex h-8 items-center rounded-lg px-3 text-[12.5px] font-medium text-ds-muted transition hover:bg-ds-card/75 hover:text-ds-ink"
              aria-label={t('agentsView.edit')}
            >
              {t('agentsView.edit')}
            </button>
          </div>
          <div className="flex items-center rounded-xl bg-ds-card p-1 ring-1 ring-ds-border-muted">
            <button
              type="button"
              onClick={() => {
                setFitMode('actual')
                setZoom((value) => clampImageZoom(value - IMAGE_ZOOM_STEP))
              }}
              className={toolbarIconButtonClass()}
              title={t('writeImageZoomOut')}
              aria-label={t('writeImageZoomOut')}
            >
              <Minus className="h-4 w-4" strokeWidth={1.85} />
            </button>
            <input
              type="range"
              min={IMAGE_MIN_ZOOM}
              max={IMAGE_MAX_ZOOM}
              step={IMAGE_ZOOM_STEP}
              value={zoom}
              aria-label={t('writeImageZoom')}
              className="hidden h-8 w-24 accent-[var(--ds-accent)] sm:block"
              onChange={(event) => {
                setFitMode('actual')
                setZoom(clampImageZoom(Number(event.target.value)))
              }}
            />
            <button
              type="button"
              onClick={() => {
                setFitMode('actual')
                setZoom((value) => clampImageZoom(value + IMAGE_ZOOM_STEP))
              }}
              className={toolbarIconButtonClass()}
              title={t('writeImageZoomIn')}
              aria-label={t('writeImageZoomIn')}
            >
              <Plus className="h-4 w-4" strokeWidth={1.85} />
            </button>
            <button
              type="button"
              onClick={() => setFitMode((mode) => (mode === 'fit' ? 'actual' : 'fit'))}
              className={`${toolbarMenuButtonClass(fitMode === 'fit')} min-w-[52px] justify-center`}
              title={fitMode === 'fit' ? t('writeImageActualSize') : t('writeImageFit')}
              aria-label={fitMode === 'fit' ? t('writeImageActualSize') : t('writeImageFit')}
            >
              {fitMode === 'fit' ? t('writeImageFitShort') : `${zoom}%`}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void copyImage()}
            disabled={copyState === 'copying'}
            className={toolbarIconButtonClass()}
            title={copyLabel}
            aria-label={copyLabel}
          >
            {copyState === 'copied' ? (
              <Check className="h-4 w-4" strokeWidth={2} />
            ) : (
              <Copy className="h-4 w-4" strokeWidth={1.85} />
            )}
          </button>
          <button
            type="button"
            onClick={() => void saveImageAs()}
            disabled={saveState === 'saving'}
            className={`${toolbarIconButtonClass()} disabled:cursor-wait disabled:opacity-45`}
            title={t('generatedFileDownload')}
            aria-label={t('generatedFileDownload')}
          >
            <Download className="h-4 w-4" strokeWidth={1.85} />
          </button>
          <button
            type="button"
            onClick={openImage}
            className={toolbarIconButtonClass()}
            title={t('writeImageOpenExternal')}
            aria-label={t('writeImageOpenExternal')}
          >
            <ExternalLink className="h-4 w-4" strokeWidth={1.85} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-t-2xl border border-b-0 border-ds-border-muted bg-[radial-gradient(circle_at_50%_0%,rgba(76,134,247,0.075),transparent_38%),linear-gradient(180deg,rgba(249,251,255,0.96),rgba(247,248,250,0.8))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:bg-[radial-gradient(circle_at_50%_0%,rgba(96,165,250,0.12),transparent_40%),linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.02))] sm:p-6">
        <div className="flex h-full min-h-full items-center justify-center">
          <div
            className={`${actualMode ? 'shrink-0' : 'flex max-h-[82%] w-[82%] max-w-[1180px] items-center justify-center'} rounded-xl bg-white p-2.5 shadow-[0_18px_55px_rgba(20,47,95,0.14)] ring-1 ring-slate-900/[0.035]`}
          >
            <img
              src={src}
              alt={fileName}
              className={`${actualMode ? 'max-w-none' : 'max-h-full w-full'} select-none rounded-lg object-contain`}
              style={
                actualMode && dimensions
                  ? {
                      width: `${Math.round((dimensions.width * zoom) / 100)}px`,
                      height: 'auto'
                    }
                  : undefined
              }
              onLoad={(event) => {
                const image = event.currentTarget
                setDimensions({
                  width: image.naturalWidth,
                  height: image.naturalHeight
                })
              }}
            />
          </div>
        </div>
      </div>

      <div className="flex min-h-10 shrink-0 items-center gap-5 rounded-b-2xl border border-t border-ds-border-muted bg-ds-card/82 px-5 text-[11.5px] text-ds-faint">
        <span className="font-mono">{mimeType}</span>
        <span className="font-mono">{formatBytes(size)}</span>
        {dimensions ? (
          <span className="font-mono">
            {dimensions.width} × {dimensions.height}
          </span>
        ) : null}
        <span className="ml-auto font-mono">{zoom}%</span>
      </div>
    </div>
  )
}
