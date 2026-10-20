import {
  Suspense,
  type CSSProperties,
  type Dispatch,
  type MutableRefObject,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type SetStateAction,
  type UIEvent as ReactUIEvent
} from 'react'
import { FileCode2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type {
  WorkspaceFileReadResult,
  WorkspaceFileTarget,
  WorkspaceImageReadResult,
  WorkspacePdfReadResult,
  WorkspacePreviewLeaseResult
} from '@shared/workspace-file'
import type { WorkspaceOfficePreviewResult } from '@shared/office-document'
import type { WorkspaceFilePreviewKind } from '../lib/workspace-text-preview'
import {
  ResolvedPreviewImage,
  WorkspacePdfViewer,
  markdownRehypePlugins,
  type CachedTextDraft
} from './workspace-file-preview-support'
import { WorkspaceOfficePreview } from './WorkspaceOfficePreview'
import { attachWorkspaceDocumentQuote } from '../lib/attach-workspace-document-quote'
import {
  WorkspaceFileBinaryCard,
  WorkspaceFileEmptyState,
  WorkspaceFileErrorCard,
  WorkspaceFileMissingCard,
  WorkspaceFilePreviewSkeleton,
  WorkspaceMediaErrorCard
} from './WorkspaceFilePreviewStates'
import { WorkspaceImageViewer, type ImageDimensions, type ImageViewerZoom } from './WorkspaceImageViewer'
import { WorkspaceTablePreview } from './WorkspaceTablePreview'

type Translate = (key: string, values?: Record<string, unknown>) => string

export type WorkspaceFilePreviewBodyProps = {
  t: Translate
  target: WorkspaceFileTarget | null
  loading: boolean
  previewKind: WorkspaceFilePreviewKind
  currentFileName: string
  workspaceRoot: string
  scrollRef: RefObject<HTMLDivElement | null>
  handlePreviewScroll: (event: ReactUIEvent<HTMLDivElement>) => void
  result: WorkspaceFileReadResult | null
  imageResult: WorkspaceImageReadResult | null
  pdfResult: WorkspacePdfReadResult | null
  officeResult: WorkspaceOfficePreviewResult | null
  officeAgentEditing: boolean
  officeRefreshError: string | null
  previewLease: WorkspacePreviewLeaseResult | null
  textSaveError: string | null
  setTextSaveError: Dispatch<SetStateAction<string | null>>
  diskConflict: boolean
  setDiskConflict: Dispatch<SetStateAction<boolean>>
  reloadText: () => Promise<unknown>
  saveText: (force?: boolean) => Promise<unknown>
  revertText: () => void
  editingText: boolean
  setEditingText: Dispatch<SetStateAction<boolean>>
  editableText: boolean
  textDirty: boolean
  savingText: boolean
  textDraft: string
  setTextDraft: Dispatch<SetStateAction<string>>
  textDraftsRef: MutableRefObject<Map<string, CachedTextDraft>>
  activeTargetKey: string
  setDirtyTargetKeys: Dispatch<SetStateAction<Set<string>>>
  /** Set when the text was decoded from a non-UTF-8 encoding and is read-only. */
  encodingNotice: string | null
  onLoadMore: (() => void) | null
  loadMoreLabel: string
  isHtmlFile: boolean
  htmlRendered: boolean
  isSvgFile: boolean
  svgRendered: boolean
  svgDataUrl: string
  isMarkdownFile: boolean
  markdownRendered: boolean
  tableDelimiter: ',' | '\t' | null
  tableRendered: boolean
  codeSurfaceStyle?: CSSProperties
  activeLine: number | null
  lineNumbers: string
  highlightHtml: string
  imageZoom: ImageViewerZoom
  setImageZoom: (zoom: ImageViewerZoom) => void
  onImageDimensions: (dimensions: ImageDimensions | null) => void
  mediaFailed: boolean
  setMediaFailed: Dispatch<SetStateAction<boolean>>
  onOpenSystem: () => void
  onReveal: () => void
  onRetry: () => void
  onCloseTab?: () => void
}

export function WorkspaceFilePreviewBody(props: WorkspaceFilePreviewBodyProps): ReactElement {
  const { t, target, loading, result, imageResult, pdfResult, officeResult, previewLease } = props
  const fileActions = { onOpenSystem: props.onOpenSystem, onReveal: props.onReveal }
  const content = ((): ReactNode => {
    if (!target) {
      return (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-[12px] leading-6 text-ds-muted">
          <div className="flex flex-col items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-ds-border-muted text-ds-faint">
              <FileCode2 className="h-5 w-5" strokeWidth={1.7} />
            </div>
            {t('filePreviewEmpty')}
          </div>
        </div>
      )
    }
    if (loading && !officeResult?.ok && !result?.ok) return <WorkspaceFilePreviewSkeleton label={t('filePreviewLoading')} />
    if (imageResult) {
      if (imageResult.ok) {
        return (
          <WorkspaceImageViewer
            t={t}
            src={imageResult.dataUrl}
            alt={props.currentFileName}
            zoom={props.imageZoom}
            onZoomChange={props.setImageZoom}
            onDimensions={props.onImageDimensions}
            convertedFrom={imageResult.convertedFrom}
          />
        )
      }
      return imageResult.code === 'not_found'
        ? <WorkspaceFileMissingCard t={t} path={target.path} onRetry={props.onRetry} onCloseTab={props.onCloseTab} />
        : <WorkspaceFileErrorCard t={t} path={target.path} message={imageResult.message} onRetry={props.onRetry} {...fileActions} />
    }
    if (pdfResult) {
      if (!pdfResult.ok) return <WorkspaceFileErrorCard t={t} path={target.path} message={pdfResult.message} onRetry={props.onRetry} {...fileActions} />
      return (
        <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<WorkspaceFilePreviewSkeleton label={t('filePreviewLoading')} />}>
            <WorkspacePdfViewer
              filePath={pdfResult.path}
              dataBase64={pdfResult.dataBase64}
              size={pdfResult.size}
              mtimeMs={pdfResult.mtimeMs}
              workspaceRoot={target.workspaceRoot ?? props.workspaceRoot}
              onSelectionChange={() => undefined}
            />
          </Suspense>
        </div>
      )
    }
    if (officeResult) {
      if (!officeResult.ok) return <WorkspaceFileErrorCard t={t} path={target.path} message={officeResult.message} onRetry={props.onRetry} {...fileActions} />
      return (
        <WorkspaceOfficePreview
          result={officeResult}
          loading={loading || props.officeAgentEditing}
          refreshError={props.officeRefreshError}
          onQuoteSelection={(draft) => attachWorkspaceDocumentQuote({
            workspaceRoot: target.workspaceRoot ?? props.workspaceRoot,
            draft
          })}
        />
      )
    }
    if (props.previewKind === 'audio' || props.previewKind === 'video') {
      if (previewLease && !previewLease.ok) {
        return <WorkspaceFileErrorCard t={t} path={target.path} message={previewLease.message} onRetry={props.onRetry} {...fileActions} />
      }
      if (props.mediaFailed) return <WorkspaceMediaErrorCard t={t} path={target.path} onOpenSystem={props.onOpenSystem} />
      if (!previewLease?.ok) return <WorkspaceFilePreviewSkeleton label={t('filePreviewLoading')} />
      return props.previewKind === 'audio' ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <div className="w-full max-w-xl rounded-xl border border-ds-border-muted bg-ds-card p-5 shadow-sm">
            <div className="mb-4 text-[13px] font-semibold text-ds-ink">{props.currentFileName}</div>
            <audio className="w-full" controls preload="metadata" src={previewLease.url} onError={() => props.setMediaFailed(true)} />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/90 p-4">
          <video className="max-h-full max-w-full rounded-lg" controls preload="metadata" src={previewLease.url} onError={() => props.setMediaFailed(true)} />
        </div>
      )
    }
    if (result && !result.ok) {
      if (result.code === 'binary') {
        return <WorkspaceFileBinaryCard key={target.path} t={t} path={target.path} size={result.size} headBase64={result.headBase64} {...fileActions} />
      }
      if (result.code === 'not_found') {
        return <WorkspaceFileMissingCard t={t} path={target.path} onRetry={props.onRetry} onCloseTab={props.onCloseTab} />
      }
      return <WorkspaceFileErrorCard t={t} path={target.path} message={result.message} onRetry={props.onRetry} {...fileActions} />
    }
    if (result?.ok) return <TextPreview {...props} result={result} />
    return <WorkspaceFileErrorCard t={t} path={target.path} message={t('filePreviewFailed')} onRetry={props.onRetry} {...fileActions} />
  })()
  return <div className="flex min-h-0 flex-1 flex-col">{content}</div>
}

function TextPreview(props: WorkspaceFilePreviewBodyProps & { result: Extract<WorkspaceFileReadResult, { ok: true }> }): ReactElement {
  const { t, result, scrollRef, handlePreviewScroll } = props
  const banners = (
    <>
      {result.truncated ? (
        <div className="ds-file-preview-banner is-warning" role="status">
          <span className="ds-file-preview-banner-text">
            {t('filePreviewTruncatedNotice', { shown: formatMegabytes(result.bytesRead ?? result.content.length), total: formatMegabytes(result.size) })}
          </span>
          {props.onLoadMore ? (
            <button type="button" className="ds-file-preview-button is-small" onClick={props.onLoadMore}>{props.loadMoreLabel}</button>
          ) : null}
        </div>
      ) : null}
      {props.encodingNotice ? (
        <div className="ds-file-preview-banner is-info" role="status">
          <span className="ds-file-preview-banner-text">{props.encodingNotice}</span>
        </div>
      ) : null}
      {props.textSaveError ? (
        <div className="ds-file-preview-banner is-danger" role="alert">
          <span className="ds-file-preview-banner-text">{props.textSaveError}</span>
        </div>
      ) : null}
      {props.diskConflict ? (
        <div className="ds-file-preview-banner is-warning" role="alert">
          <span className="ds-file-preview-banner-text">
            {t('filePreviewDiskConflict', { defaultValue: 'This file changed on disk after it was opened.' })}
          </span>
          <button type="button" className="ds-file-preview-button is-small" onClick={() => void props.reloadText()}>
            {t('filePreviewReloadDisk', { defaultValue: 'Reload' })}
          </button>
          <button type="button" className="ds-file-preview-button is-small" onClick={() => void props.saveText(true)}>
            {t('filePreviewOverwriteDisk', { defaultValue: 'Overwrite' })}
          </button>
        </div>
      ) : null}
    </>
  )

  const body = ((): ReactNode => {
    if (props.editingText) {
      return (
        <textarea
          value={props.textDraft}
          readOnly={result.truncated}
          spellCheck={false}
          aria-label={t('filePreviewEditText', { defaultValue: 'Edit file' })}
          className="min-h-0 flex-1 resize-none border-0 bg-[var(--ds-code-sidebar-editor-bg)] p-4 font-mono text-[12px] leading-[22px] text-ds-ink outline-none"
          onChange={(event) => {
            const content = event.target.value
            props.setTextDraft(content)
            if (content === result.content) {
              props.textDraftsRef.current.delete(props.activeTargetKey)
              props.setDirtyTargetKeys((current) => {
                const updated = new Set(current)
                updated.delete(props.activeTargetKey)
                return updated
              })
            } else {
              props.textDraftsRef.current.set(props.activeTargetKey, { content, baseContent: result.content, mtimeMs: result.mtimeMs })
              props.setDirtyTargetKeys((current) => new Set(current).add(props.activeTargetKey))
            }
            props.setTextSaveError(null)
            props.setDiskConflict(false)
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
              event.preventDefault()
              void props.saveText()
            }
          }}
        />
      )
    }
    if (!result.content && !result.truncated) {
      return <WorkspaceFileEmptyState t={t} onEdit={props.editableText ? () => props.setEditingText(true) : undefined} />
    }
    if (props.isHtmlFile && props.htmlRendered && props.previewLease?.ok && !result.truncated) {
      return (
        <iframe
          title={props.currentFileName}
          src={props.previewLease.url}
          sandbox=""
          referrerPolicy="no-referrer"
          className="min-h-0 flex-1 border-0 bg-white"
        />
      )
    }
    if (props.isSvgFile && props.svgRendered && !result.truncated) {
      return (
        <div ref={scrollRef} onScroll={handlePreviewScroll} className="ds-file-preview-svg min-h-0 flex-1 overflow-auto p-5">
          <img src={props.svgDataUrl} alt={props.currentFileName} className="mx-auto block h-full min-h-[120px] max-w-full object-contain" />
        </div>
      )
    }
    if (props.isMarkdownFile && props.markdownRendered) {
      return (
        <div ref={scrollRef} onScroll={handlePreviewScroll} className="ds-file-preview-markdown min-h-0 flex-1 overflow-auto px-7 py-6">
          <div className="ds-markdown mx-auto min-h-full max-w-[760px] text-ds-ink">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={markdownRehypePlugins}
              components={{
                a: ({ href, children, ...rest }): ReactNode => (
                  <a
                    {...rest}
                    href={href}
                    onClick={(event) => {
                      if (!href) return
                      event.preventDefault()
                      void window.kunGui?.openExternal?.(href)?.catch(() => undefined)
                    }}
                  >
                    {children}
                  </a>
                ),
                img: ({ src, alt, ...rest }): ReactNode => (
                  <ResolvedPreviewImage {...rest} src={src} alt={alt} filePath={result.path} />
                )
              }}
            >
              {result.content}
            </ReactMarkdown>
          </div>
        </div>
      )
    }
    if (props.tableDelimiter && props.tableRendered) {
      return <WorkspaceTablePreview t={t} content={result.content} delimiter={props.tableDelimiter} truncatedFile={result.truncated} />
    }
    return (
      <div
        ref={scrollRef}
        onScroll={handlePreviewScroll}
        className="ds-file-preview-scroll min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[22px] text-ds-ink"
      >
        <div className="ds-file-preview-code-surface" style={props.codeSurfaceStyle}>
          {props.activeLine ? <div className="ds-file-preview-active-line" aria-hidden="true" /> : null}
          <div className="ds-file-preview-gutter" aria-hidden="true">
            <pre className="ds-file-preview-line-numbers">{props.lineNumbers}</pre>
          </div>
          <div className="ds-file-preview-code-html" dangerouslySetInnerHTML={{ __html: props.highlightHtml }} />
        </div>
      </div>
    )
  })()

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {banners}
      {body}
      {props.textDirty ? (
        <div className="ds-file-preview-savebar">
          <span className="min-w-0 flex-1 truncate">{t('filePreviewUnsavedChanges', { defaultValue: 'Unsaved changes' })}</span>
          <button
            type="button"
            className="ds-file-preview-button is-small"
            aria-label={t('filePreviewRevertText', { defaultValue: 'Revert changes' })}
            onClick={props.revertText}
          >
            {t('filePreviewRevertText', { defaultValue: 'Revert changes' })}
          </button>
          <button
            type="button"
            className="ds-file-preview-button is-small is-primary"
            aria-label={t('filePreviewSaveText', { defaultValue: 'Save file' })}
            title={window.kunGui?.platform === 'darwin' ? '⌘S' : 'Ctrl+S'}
            disabled={props.savingText}
            onClick={() => void props.saveText()}
          >
            {t('filePreviewSaveText', { defaultValue: 'Save file' })}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function formatMegabytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
