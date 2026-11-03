import { FileQuestion } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { FileTypeIcon } from './FileTypeIcon'
import { fileNameFromPath, formatBytes } from './workspace-file-preview-support'

type Translate = (key: string, values?: Record<string, unknown>) => string

const SKELETON_WIDTHS = ['62%', '48%', '71%', '39%', '56%', '30%', '66%', '44%', '52%', '35%']
const SKELETON_INDENTS = [0, 16, 16, 32, 32, 16, 0, 16, 16, 0]

/** Appears only after 150 ms so quick reads do not flash. */
export function WorkspaceFilePreviewSkeleton({ label }: { label: string }): ReactElement {
  return (
    <div className="ds-file-preview-skeleton" aria-busy="true" aria-label={label}>
      {SKELETON_WIDTHS.map((width, index) => (
        <span key={index} style={{ width, marginLeft: SKELETON_INDENTS[index] }} />
      ))}
    </div>
  )
}

export function formatHexDump(base64: string, bytesPerLine = 16): Array<{ offset: string; bytes: string; ascii: string }> {
  const binary = typeof atob === 'function' ? atob(base64) : ''
  const lines: Array<{ offset: string; bytes: string; ascii: string }> = []
  for (let start = 0; start < binary.length; start += bytesPerLine) {
    const codes = Array.from(binary.slice(start, start + bytesPerLine), (char) => char.charCodeAt(0))
    const hex = codes.map((code) => code.toString(16).padStart(2, '0'))
    const half = bytesPerLine / 2
    lines.push({
      offset: start.toString(16).padStart(8, '0'),
      bytes: `${hex.slice(0, half).join(' ')}  ${hex.slice(half).join(' ')}`.padEnd(bytesPerLine * 3 + 1, ' '),
      ascii: `|${codes.map((code) => (code >= 32 && code < 127 ? String.fromCharCode(code) : '.')).join('')}|`
    })
  }
  return lines
}

function extensionLabel(path: string): string {
  const name = fileNameFromPath(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : ''
}

type FileActions = {
  onOpenSystem: () => void
  onReveal: () => void
}

type BinaryProps = FileActions & {
  t: Translate
  path: string
  size?: number
  headBase64?: string
}

/** Eight bytes per row when the panel is too narrow for sixteen plus the ASCII column. */
function useHexRowWidth(): [(element: HTMLDivElement | null) => void, number] {
  const [bytesPerLine, setBytesPerLine] = useState(16)
  const observerRef = useRef<ResizeObserver | null>(null)
  useEffect(() => () => observerRef.current?.disconnect(), [])
  const attach = (element: HTMLDivElement | null): void => {
    observerRef.current?.disconnect()
    if (!element || typeof ResizeObserver === 'undefined') return
    observerRef.current = new ResizeObserver(([entry]) => setBytesPerLine(entry.contentRect.width < 600 ? 8 : 16))
    observerRef.current.observe(element)
  }
  return [attach, bytesPerLine]
}

export function WorkspaceFileBinaryCard({ t, path, size, headBase64, onOpenSystem, onReveal }: BinaryProps): ReactElement {
  const [showHex, setShowHex] = useState(false)
  const [attachHex, bytesPerLine] = useHexRowWidth()
  const ext = extensionLabel(path)
  const kind = ext ? t('filePreviewBinaryKind', { ext }) : t('filePreviewBinaryKindGeneric')
  if (showHex && headBase64) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-ds-border-muted px-3.5 py-2 text-[12px] text-ds-muted">
          <span className="min-w-0 flex-1 truncate">{t('filePreviewHexTitle')}</span>
          <button type="button" className="ds-file-preview-button is-small" onClick={() => setShowHex(false)}>
            {t('filePreviewHexBack')}
          </button>
        </div>
        <div ref={attachHex} className="ds-file-preview-hex" role="region" aria-label={t('filePreviewHexTitle')}>
          {formatHexDump(headBase64, bytesPerLine).map((line) => (
            <div key={line.offset}>
              <span className="is-offset">{line.offset}</span>{'  '}{line.bytes}{'  '}<span className="is-ascii">{line.ascii}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div className="ds-file-preview-state">
      <span className="ds-file-preview-state-badge"><FileTypeIcon path={path} size={30} /></span>
      <div className="ds-file-preview-state-title">{fileNameFromPath(path)}</div>
      <div className="ds-file-preview-state-meta">{size === undefined ? kind : `${kind} · ${formatBytes(size)}`}</div>
      <p className="ds-file-preview-state-body m-0">{t('filePreviewBinaryBody')}</p>
      <div className="ds-file-preview-state-actions">
        <button type="button" className="ds-file-preview-button is-primary" onClick={onOpenSystem}>{t('filePreviewOpenSystem')}</button>
        <button type="button" className="ds-file-preview-button" onClick={onReveal}>{t('filePreviewRevealInFolder')}</button>
      </div>
      {headBase64 ? (
        <button type="button" className="ds-file-preview-link" onClick={() => setShowHex(true)}>
          {t('filePreviewShowHex')}
        </button>
      ) : null}
    </div>
  )
}

type MissingProps = {
  t: Translate
  path: string
  onRetry: () => void
  onCloseTab?: () => void
}

export function WorkspaceFileMissingCard({ t, path, onRetry, onCloseTab }: MissingProps): ReactElement {
  return (
    <div className="ds-file-preview-state">
      <span className="ds-file-preview-state-badge is-danger"><FileTypeIcon path={path} size={30} /></span>
      <div className="ds-file-preview-state-title">{t('filePreviewMissingTitle')}</div>
      <p className="ds-file-preview-state-body m-0">{t('filePreviewMissingBody', { file: fileNameFromPath(path) })}</p>
      <div className="ds-file-preview-state-actions">
        {onCloseTab ? (
          <button type="button" className="ds-file-preview-button is-primary" onClick={onCloseTab}>{t('filePreviewCloseThisTab')}</button>
        ) : null}
        <button type="button" className="ds-file-preview-button" onClick={onRetry}>{t('filePreviewRetry')}</button>
      </div>
    </div>
  )
}

type ErrorProps = FileActions & {
  t: Translate
  path?: string
  message: string
  onRetry?: () => void
}

export function WorkspaceFileErrorCard({ t, path, message, onRetry, onOpenSystem, onReveal }: ErrorProps): ReactElement {
  return (
    <div className="ds-file-preview-state" role="alert">
      <span className="ds-file-preview-state-badge is-danger">
        {path ? <FileTypeIcon path={path} size={30} /> : <FileQuestion className="h-7 w-7 text-ds-muted" strokeWidth={1.6} />}
      </span>
      <div className="ds-file-preview-state-title">{t('filePreviewFailedTitle')}</div>
      <p className="ds-file-preview-state-body m-0 break-words" title={message}>{message}</p>
      {path ? (
        <div className="ds-file-preview-state-actions">
          <button type="button" className="ds-file-preview-button is-primary" onClick={onOpenSystem}>{t('filePreviewOpenSystem')}</button>
          <button type="button" className="ds-file-preview-button" onClick={onReveal}>{t('filePreviewRevealInFolder')}</button>
          {onRetry ? <button type="button" className="ds-file-preview-button" onClick={onRetry}>{t('filePreviewRetry')}</button> : null}
        </div>
      ) : null}
    </div>
  )
}

export function WorkspaceFileEmptyState({ t, onEdit }: { t: Translate; onEdit?: () => void }): ReactElement {
  return (
    <div className="ds-file-preview-state">
      <div className="ds-file-preview-state-title text-ds-muted">{t('filePreviewEmptyFileTitle')}</div>
      <p className="ds-file-preview-state-body m-0">{t('filePreviewEmptyFileBody')}</p>
      {onEdit ? (
        <div className="ds-file-preview-state-actions">
          <button type="button" className="ds-file-preview-button" onClick={onEdit}>{t('filePreviewStartEditing')}</button>
        </div>
      ) : null}
    </div>
  )
}

export function WorkspaceMediaErrorCard({ t, path, onOpenSystem }: { t: Translate; path: string; onOpenSystem: () => void }): ReactElement {
  return (
    <div className="ds-file-preview-state">
      <span className="ds-file-preview-state-badge"><FileTypeIcon path={path} size={30} /></span>
      <div className="ds-file-preview-state-title">{t('filePreviewMediaFailedTitle')}</div>
      <p className="ds-file-preview-state-body m-0">{t('filePreviewMediaUnsupported')}</p>
      <div className="ds-file-preview-state-actions">
        <button type="button" className="ds-file-preview-button is-primary" onClick={onOpenSystem}>{t('filePreviewOpenSystem')}</button>
      </div>
    </div>
  )
}
