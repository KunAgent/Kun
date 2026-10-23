import {
  WORKSPACE_TEXT_PREVIEW_MAX_BYTES,
  type WorkspaceFileTarget,
  type WorkspaceTextEncoding
} from '@shared/workspace-file'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type UIEvent as ReactUIEvent,
  type WheelEvent as ReactWheelEvent
} from 'react'
import { useTranslation } from 'react-i18next'
import { formatFilePathForDisplay } from '../lib/diff-stats'
import { openWorkspacePathInEditor } from '../lib/open-workspace-path'
import { relativeWorkspacePath } from '../lib/composer-file-references'
import { highlightCodeHtml, languageFromFilePath, renderFallbackCodeHtml } from '../lib/code-highlighting'
import { workspaceFilePreviewKind } from '../lib/workspace-text-preview'

export {
  PREVIEW_SCROLL_POSITIONS_KEY,
  isJsonPreviewPath,
  nextFilePreviewTargetForWheel,
  parsePreviewScrollPositions,
  rememberPreviewScrollPosition,
  resolvedPreviewPathMatchesTarget,
  svgPreviewDataUrl,
  targetKey
} from './workspace-file-preview-support'
import {
  fileNameFromPath,
  formatBytes,
  isMarkdownPreviewPath,
  isSvgPreviewPath,
  nextFilePreviewTargetForWheel,
  persistPreviewScrollPositions,
  readPreviewScrollPositions,
  relativePathSegments,
  rememberPreviewScrollPosition,
  resolvedPreviewPathMatchesTarget,
  svgPreviewDataUrl,
  targetKey,
  type CachedTextDraft,
  type Props
} from './workspace-file-preview-support'
import { useWorkspaceFilePreviewLoad } from './useWorkspaceFilePreviewLoad'
import { useWorkspaceFilePreviewTextActions } from './useWorkspaceFilePreviewTextActions'
import { WorkspaceFilePreviewChrome, type PreviewViewMode } from './WorkspaceFilePreviewChrome'
import { WorkspaceFilePreviewBody } from './WorkspaceFilePreviewBody'
import { WorkspaceFilePreviewDialogs } from './WorkspaceFilePreviewDialogs'
import type { PreviewMenuItem } from './WorkspaceFilePreviewMenus'
import {
  WorkspaceFilePreviewStatusBar,
  workspaceEncodingLabel,
  workspaceLanguageName,
  workspaceLineEnding,
  type PreviewStatusItem
} from './WorkspaceFilePreviewStatusBar'
import type { ImageDimensions, ImageViewerZoom } from './WorkspaceImageViewer'
import {
  buildFilePreviewHostTabs,
  filePreviewHostTabsSignature
} from './workspace-file-preview-host-tabs'

const CODE_ROW_HEIGHT = 22

type TextReadOptions = { key: string; encoding: WorkspaceTextEncoding | null; maxBytes: number | null; nonce: number }

function countLines(content: string): number {
  let lines = 1
  for (let index = content.indexOf('\n'); index >= 0; index = content.indexOf('\n', index + 1)) lines += 1
  return content.endsWith('\n') && lines > 1 ? lines - 1 : lines
}

function extensionLabel(path: string): string {
  const name = fileNameFromPath(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toUpperCase() : ''
}

export function WorkspaceFilePreviewPanel({
  target,
  openTargets = target ? [target] : [],
  workspaceRoot,
  className,
  fileTreeOpen = false,
  onToggleFileTree,
  onSelectTarget,
  onCloseTarget,
  pinnedTargetKeys = [],
  preserveAcrossThreads = false,
  onTogglePinnedTarget,
  onCloseOtherTargets,
  onTogglePreserveAcrossThreads,
  onClose,
  hostTabs
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [markdownRendered, setMarkdownRendered] = useState(true)
  const [svgRendered, setSvgRendered] = useState(true)
  const [htmlRendered, setHtmlRendered] = useState(false)
  const [tableRendered, setTableRendered] = useState(true)
  const [textDraft, setTextDraft] = useState('')
  const [textSaveError, setTextSaveError] = useState<string | null>(null)
  const [savingText, setSavingText] = useState(false)
  const [editingText, setEditingText] = useState(false)
  const [diskConflict, setDiskConflict] = useState(false)
  const [readingMode, setReadingMode] = useState(false)
  const [imageZoom, setImageZoom] = useState<ImageViewerZoom>('fit')
  const [imageDimensions, setImageDimensions] = useState<ImageDimensions | null>(null)
  const [mediaFailed, setMediaFailed] = useState(false)
  const [textOptions, setTextOptions] = useState<TextReadOptions>({ key: '', encoding: null, maxBytes: null, nonce: 0 })
  const [tabMenu, setTabMenu] = useState<{ target: WorkspaceFileTarget; x: number; y: number } | null>(null)
  const [pendingCloseTarget, setPendingCloseTarget] = useState<WorkspaceFileTarget | null>(null)
  const [highlightHtml, setHighlightHtml] = useState(() => renderFallbackCodeHtml(''))
  const scrollRef = useRef<HTMLDivElement>(null)
  const tabsScrollRef = useRef<HTMLDivElement>(null)
  const scrollPositionsRef = useRef(readPreviewScrollPositions())
  const tabMenuRef = useRef<HTMLDivElement>(null)
  const tabMenuTriggerRef = useRef<HTMLElement | null>(null)
  const tabButtonRefs = useRef(new Map<string, HTMLButtonElement>())
  const panelRef = useRef<HTMLElement>(null)
  const textDraftsRef = useRef(new Map<string, CachedTextDraft>())
  const [dirtyTargetKeys, setDirtyTargetKeys] = useState<Set<string>>(() => new Set())
  const activeTargetKey = targetKey(target)
  const visibleTargets = openTargets.length ? openTargets : target ? [target] : []
  const visibleTargetKeySignature = visibleTargets.map((item) => targetKey(item)).join('\0')
  const pinnedTargetKeySet = useMemo(() => new Set(pinnedTargetKeys), [pinnedTargetKeys])
  const tabActionsEnabled = Boolean(onTogglePinnedTarget || onCloseOtherTargets)
  const previewKind = workspaceFilePreviewKind(target?.path ?? '')
  const activeOptions = textOptions.key === activeTargetKey ? textOptions : null
  const {
    result,
    setResult,
    imageResult,
    pdfResult,
    officeResult,
    officeAgentEditing,
    officeRefreshError,
    previewLease,
    loading,
    setLoading
  } = useWorkspaceFilePreviewLoad({
    target,
    workspaceRoot,
    activeTargetKey,
    previewKind,
    encoding: activeOptions?.encoding ?? null,
    maxBytes: activeOptions?.maxBytes ?? null,
    reloadNonce: activeOptions?.nonce ?? 0,
    textDraftsRef,
    setSvgRendered,
    setHtmlRendered,
    setTextDraft,
    setTextSaveError,
    setSavingText,
    setEditingText,
    setDiskConflict
  })

  useEffect(() => {
    setImageZoom('fit')
    setImageDimensions(null)
    setMediaFailed(false)
    setTableRendered(true)
  }, [activeTargetKey])

  useEffect(() => {
    if (!result?.ok || !result.line) return
    const id = window.requestAnimationFrame(() => {
      const scroller = scrollRef.current
      if (!scroller) return
      scroller.scrollTop = Math.max(0, (result.line! - 1) * CODE_ROW_HEIGHT - scroller.clientHeight / 2)
    })
    return () => window.cancelAnimationFrame(id)
  }, [result])

  useEffect(() => {
    if (!readingMode) return
    const exitReadingMode = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !tabMenu) setReadingMode(false)
    }
    document.addEventListener('keydown', exitReadingMode)
    return () => document.removeEventListener('keydown', exitReadingMode)
  }, [readingMode, tabMenu])

  useEffect(() => {
    if (!tabMenu) return
    tabMenuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]')?.focus()
    const closeMenu = (event: PointerEvent): void => {
      if (typeof Node !== 'undefined' && event.target instanceof Node && tabMenuRef.current?.contains(event.target)) return
      setTabMenu(null)
    }
    const closeMenuWithKeyboard = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setTabMenu(null)
      tabMenuTriggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeMenu)
    document.addEventListener('keydown', closeMenuWithKeyboard)
    return () => {
      document.removeEventListener('pointerdown', closeMenu)
      document.removeEventListener('keydown', closeMenuWithKeyboard)
    }
  }, [tabMenu])

  useEffect(() => {
    if (!tabMenu) return
    const visibleKeys = new Set(visibleTargetKeySignature.split('\0').filter(Boolean))
    if (!visibleKeys.has(targetKey(tabMenu.target))) setTabMenu(null)
  }, [tabMenu, visibleTargetKeySignature])

  useEffect(() => {
    if (!activeTargetKey) return
    const id = window.requestAnimationFrame(() => {
      const tab = tabButtonRefs.current.get(activeTargetKey)
      ;(tab?.parentElement ?? tab)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    return () => window.cancelAnimationFrame(id)
  }, [activeTargetKey])

  useEffect(() => {
    const visibleKeys = new Set(visibleTargetKeySignature.split('\0').filter(Boolean))
    let changed = false
    for (const key of textDraftsRef.current.keys()) {
      if (visibleKeys.has(key)) continue
      textDraftsRef.current.delete(key)
      changed = true
    }
    if (changed) setDirtyTargetKeys((current) => new Set([...current].filter((key) => visibleKeys.has(key))))
  }, [visibleTargetKeySignature])

  useEffect(() => () => persistPreviewScrollPositions(scrollPositionsRef.current), [activeTargetKey])

  useEffect(() => {
    if (!activeTargetKey || (!result?.ok && !imageResult?.ok && !pdfResult?.ok && !officeResult?.ok && !previewLease?.ok)) return
    if (result?.ok && result.line) return
    const frame = window.requestAnimationFrame(() => {
      const stored = scrollPositionsRef.current[activeTargetKey]
      if (typeof stored === 'number' && scrollRef.current) scrollRef.current.scrollTop = stored
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeTargetKey, htmlRendered, imageResult, markdownRendered, officeResult, pdfResult, previewLease, result, svgRendered])

  const handlePreviewScroll = (event: ReactUIEvent<HTMLDivElement>): void => {
    if (!activeTargetKey) return
    scrollPositionsRef.current = rememberPreviewScrollPosition(scrollPositionsRef.current, activeTargetKey, event.currentTarget.scrollTop)
  }

  const handleTabWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    const delta = event.deltaY || event.deltaX
    if (delta !== 0 && event.currentTarget.scrollWidth > event.currentTarget.clientWidth) {
      event.preventDefault()
      event.currentTarget.scrollLeft += delta
      return
    }
    const nextTarget = nextFilePreviewTargetForWheel(visibleTargets, target, delta)
    if (!nextTarget || !onSelectTarget) return
    event.preventDefault()
    onSelectTarget(nextTarget)
  }

  const openTabMenu = (
    event: ReactMouseEvent<HTMLElement> | ReactKeyboardEvent<HTMLButtonElement>,
    item: WorkspaceFileTarget,
    position?: { x: number; y: number }
  ): void => {
    event.preventDefault()
    event.stopPropagation()
    tabMenuTriggerRef.current = event.currentTarget
    const rect = event.currentTarget.getBoundingClientRect()
    const requestedX = position?.x ?? ('clientX' in event ? event.clientX : rect.left)
    const requestedY = position?.y ?? ('clientY' in event ? event.clientY : rect.bottom)
    setTabMenu({
      target: item,
      x: Math.max(8, Math.min(requestedX, window.innerWidth - 200)),
      y: Math.max(8, Math.min(requestedY, window.innerHeight - 112))
    })
  }

  const handleTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, item: WorkspaceFileTarget, index: number): void => {
    if (tabActionsEnabled && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
      const rect = event.currentTarget.getBoundingClientRect()
      openTabMenu(event, item, { x: rect.left, y: rect.bottom })
      return
    }
    let nextTarget: WorkspaceFileTarget | undefined
    if (event.key === 'ArrowRight') nextTarget = visibleTargets[(index + 1) % visibleTargets.length]
    if (event.key === 'ArrowLeft') nextTarget = visibleTargets[(index - 1 + visibleTargets.length) % visibleTargets.length]
    if (event.key === 'Home') nextTarget = visibleTargets[0]
    if (event.key === 'End') nextTarget = visibleTargets.at(-1)
    if (!nextTarget || !onSelectTarget) return
    event.preventDefault()
    onSelectTarget(nextTarget)
    window.requestAnimationFrame(() => tabButtonRefs.current.get(targetKey(nextTarget))?.focus())
  }

  const resolvedPath = imageResult?.ok ? imageResult.path : pdfResult?.ok ? pdfResult.path
    : officeResult?.ok ? officeResult.path : result?.ok ? result.path : target?.path ?? ''
  const root = target?.workspaceRoot ?? workspaceRoot
  const displayPath = resolvedPath ? formatFilePathForDisplay(resolvedPath, root) ?? fileNameFromPath(resolvedPath) : ''
  const language = useMemo(() => languageFromFilePath(result?.ok ? result.path : target?.path ?? ''), [result, target])
  const isMarkdownFile = isMarkdownPreviewPath(result?.ok ? result.path : target?.path ?? '')
  const isSvgFile = isSvgPreviewPath(result?.ok ? result.path : target?.path ?? '')
  const isHtmlFile = previewKind === 'html'
  const tableDelimiter = previewKind === 'table' ? (/\.tsv$/i.test(target?.path ?? '') ? '\t' : ',') : null
  const textEncoding = result?.ok ? result.encoding ?? 'utf-8' : null
  const nonUtf8 = Boolean(textEncoding && textEncoding !== 'utf-8')
  const editableText = Boolean(result?.ok && !result.truncated && !nonUtf8)
  const textDirty = Boolean(result?.ok && !result.truncated && textDraft !== result.content)
  const svgDataUrl = useMemo(() => (result?.ok && isSvgFile && !result.truncated ? svgPreviewDataUrl(result.content) : ''), [isSvgFile, result])
  const lineCount = useMemo(() => (result?.ok ? countLines(result.content) : 0), [result])
  const lineNumbers = useMemo(() => Array.from({ length: lineCount }, (_, index) => index + 1).join('\n'), [lineCount])
  const breadcrumbSegments = useMemo(() => (resolvedPath ? relativePathSegments(resolvedPath, root) : []), [resolvedPath, root])
  const currentFileName = displayPath ? fileNameFromPath(displayPath) : t('filePreviewTitle')
  const activeLine = result?.ok && result.line && result.line >= 1 && result.line <= lineCount ? result.line : null
  const codeSurfaceStyle = activeLine ? ({ '--ds-file-preview-active-line': activeLine - 1 } as CSSProperties) : undefined

  useEffect(() => {
    if (!result?.ok) {
      setHighlightHtml(renderFallbackCodeHtml(''))
      return
    }
    let cancelled = false
    setHighlightHtml(renderFallbackCodeHtml(result.content))
    void highlightCodeHtml(result.content, language).then((html) => {
      if (!cancelled) setHighlightHtml(html)
    })
    return () => {
      cancelled = true
    }
  }, [result, language])

  const openTargetInEditor = (targetToOpen: WorkspaceFileTarget | null): void => {
    const isActive = targetKey(targetToOpen) === activeTargetKey
    const resultMatchesTarget = Boolean(
      targetToOpen && isActive && result?.ok && resolvedPreviewPathMatchesTarget(result.path, targetToOpen, workspaceRoot)
    )
    const path = resultMatchesTarget && result?.ok ? result.path : targetToOpen?.path
    if (!path) return
    void openWorkspacePathInEditor(
      {
        path,
        line: resultMatchesTarget && result?.ok ? result.line : targetToOpen?.line,
        column: resultMatchesTarget && result?.ok ? result.column : targetToOpen?.column
      },
      targetToOpen?.workspaceRoot ?? workspaceRoot
    ).then((next) => {
      if (!next.ok) {
        void window.kunGui?.logError?.('editor-open', 'Failed to open previewed file', { message: next.message, target: targetToOpen })?.catch(() => undefined)
      }
    })
  }

  const openInSystem = (): void => {
    if (!target) return
    void window.kunGui.openWorkspaceFileInSystem({ ...target, workspaceRoot: root })
  }
  const revealInFileManager = (): void => {
    if (!target) return
    void window.kunGui.revealWorkspaceFileInFolder({ ...target, workspaceRoot: root })
  }
  const copyText = (value: string): void => {
    if (value) void navigator?.clipboard?.writeText?.(value)?.catch(() => undefined)
  }
  const copyContentAvailable = Boolean(result?.ok || (officeResult?.ok && officeResult.viewer === 'word'))

  const { saveText, revertText, savePendingCloseTarget, reloadText } = useWorkspaceFilePreviewTextActions({
    target, workspaceRoot, activeTargetKey, result, setResult, textDraft, setTextDraft, textDirty, savingText,
    setSavingText, setTextSaveError, setDiskConflict, setLoading, textDraftsRef, setDirtyTargetKeys,
    pendingCloseTarget, setPendingCloseTarget, onCloseTarget, onSelectTarget
  })

  const rereadText = useCallback((patch: Partial<Omit<TextReadOptions, 'key' | 'nonce'>>) => {
    setTextOptions((current) => {
      const base = current.key === activeTargetKey ? current : { key: activeTargetKey, encoding: null, maxBytes: null, nonce: 0 }
      return { ...base, ...patch, key: activeTargetKey, nonce: base.nonce + 1 }
    })
  }, [activeTargetKey])

  const bytesRead = result?.ok ? result.bytesRead ?? result.content.length : 0
  // One click reads the whole file when it fits the cap; bigger files stop at the cap.
  const onLoadMore = result?.ok && result.truncated && bytesRead < WORKSPACE_TEXT_PREVIEW_MAX_BYTES
    ? () => rereadText({ maxBytes: Math.min(WORKSPACE_TEXT_PREVIEW_MAX_BYTES, result.size) })
    : null
  const loadMoreLabel = result?.ok && result.size <= WORKSPACE_TEXT_PREVIEW_MAX_BYTES ? t('filePreviewLoadAll') : t('filePreviewLoadMore')

  const requestCloseTarget = (item: WorkspaceFileTarget, dirty: boolean): void => {
    if (!onCloseTarget) return
    if (dirty) {
      setPendingCloseTarget(item)
      return
    }
    const key = targetKey(item)
    textDraftsRef.current.delete(key)
    setDirtyTargetKeys((current) => {
      const updated = new Set(current)
      updated.delete(key)
      return updated
    })
    onCloseTarget(item)
  }

  const hostTabsModel = hostTabs ? buildFilePreviewHostTabs({
    targets: visibleTargets,
    activeKey: activeTargetKey,
    dirtyKeys: dirtyTargetKeys,
    activeDirty: textDirty,
    pinnedKeys: pinnedTargetKeySet,
    workspaceRoot
  }) : null
  const hostTabsSignature = hostTabsModel ? filePreviewHostTabsSignature(hostTabsModel) : ''
  const hostTabsModelRef = useRef(hostTabsModel)
  hostTabsModelRef.current = hostTabsModel
  if (hostTabs) {
    hostTabs.actionsRef.current = {
      select: (item) => onSelectTarget?.(item),
      requestClose: requestCloseTarget,
      ...(tabActionsEnabled ? { openMenu: openTabMenu } : {}),
      openInEditor: openTargetInEditor
    }
  }
  useEffect(() => {
    if (hostTabs) hostTabs.publish(hostTabsModelRef.current)
  }, [hostTabs, hostTabsSignature])
  useEffect(() => () => hostTabs?.publish(null), [hostTabs])

  const renderedMode = (label: string, rendered: boolean, setRendered: (value: boolean) => void, disabled: boolean): PreviewViewMode => ({
    renderedLabel: label, rendered, disabled, onShowRendered: () => setRendered(true), onShowSource: () => setRendered(false)
  })
  const textUnavailable = !result?.ok || editingText
  const viewMode: PreviewViewMode | null = isMarkdownFile
    ? renderedMode(t('filePreviewRendered'), markdownRendered, setMarkdownRendered, textUnavailable)
    : isSvgFile
      ? renderedMode(t('filePreviewRendered'), svgRendered, setSvgRendered, textUnavailable || Boolean(result?.ok && result.truncated))
      : isHtmlFile
        ? renderedMode(t('filePreviewRendered'), htmlRendered, setHtmlRendered, textUnavailable || Boolean(result?.ok && result.truncated) || !previewLease?.ok)
        : tableDelimiter
          ? renderedMode(t('filePreviewTable'), tableRendered, setTableRendered, textUnavailable)
          : null

  const openWithItems: PreviewMenuItem[] = [
    { kind: 'item', label: t('filePreviewOpenEditor'), disabled: !target, onSelect: () => openTargetInEditor(target) },
    { kind: 'item', label: t('filePreviewOpenSystem', { defaultValue: 'Open with system app' }), disabled: !target, onSelect: openInSystem },
    { kind: 'item', label: t('filePreviewRevealInFolder', { defaultValue: 'Show in file manager' }), disabled: !target, onSelect: revealInFileManager }
  ]
  const moreItems: PreviewMenuItem[] = [
    { kind: 'item', label: t('filePreviewCopyPath'), disabled: !resolvedPath, onSelect: () => copyText(resolvedPath) },
    { kind: 'item', label: t('fileTreeCopyRelativePath'), disabled: !resolvedPath, onSelect: () => copyText(relativeWorkspacePath(resolvedPath, root)) },
    {
      kind: 'item',
      label: t('filePreviewCopyContent'),
      disabled: !copyContentAvailable,
      onSelect: () => copyText(result?.ok ? textDraft : renderedDocxPreviewText(panelRef.current))
    },
    ...(onTogglePreserveAcrossThreads
      ? [{ kind: 'separator' as const }, { kind: 'check' as const, label: t('filePreviewPreserveAcrossThreads'), checked: preserveAcrossThreads, onSelect: onTogglePreserveAcrossThreads }]
      : [])
  ]

  const size = result?.ok ? result.size : !result?.ok && result?.size !== undefined ? result.size
    : imageResult?.ok ? imageResult.size : pdfResult?.ok ? pdfResult.size
      : officeResult?.ok ? officeResult.size : previewLease?.ok ? previewLease.size : null
  const statusLeft: PreviewStatusItem[] = []
  const statusRight: PreviewStatusItem[] = []
  if (target) {
    const ext = extensionLabel(target.path)
    if (result?.ok) {
      statusLeft.push({ label: tableDelimiter ? ext : language ? workspaceLanguageName(language) : t('filePreviewPlainText') })
      const ending = workspaceLineEnding(result.content)
      if (ending) statusLeft.push({ label: ending })
      if (result.truncated) {
        statusRight.push({ label: t('filePreviewLoadedOf', { shown: formatBytes(bytesRead), total: formatBytes(result.size) }), notice: true })
      } else {
        if (activeLine) statusRight.push({ label: t('filePreviewLineNumber', { line: activeLine }) })
        statusRight.push({ label: t('filePreviewLineCount', { count: lineCount }) })
      }
      if (nonUtf8) statusRight.push({ label: t('filePreviewReadOnly'), notice: true })
    } else if (imageResult?.ok) {
      statusLeft.push({ label: imageResult.convertedFrom ?? ext })
      if (imageDimensions) statusLeft.push({ label: `${imageDimensions.width} × ${imageDimensions.height}` })
      statusRight.push({ label: imageZoom === 'fit' ? t('filePreviewZoomFit') : `${Math.round(imageZoom * 100)}%` })
    } else if (result && !result.ok && result.code === 'binary') {
      statusLeft.push({ label: ext ? t('filePreviewBinaryKind', { ext }) : t('filePreviewBinaryKindGeneric') })
    } else if (ext) {
      statusLeft.push({ label: ext })
    }
    if (size !== null && size !== undefined && !(result?.ok && result.truncated)) statusRight.push({ label: formatBytes(size) })
  }

  return (
    <>
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        className={`ds-file-preview-reading-backdrop ${readingMode ? 'is-visible' : ''}`}
        onClick={() => setReadingMode(false)}
      />
      <aside
        ref={panelRef}
        data-kun-workspace-root={root.replaceAll('\\', '/')}
        data-reading-mode={readingMode ? 'true' : 'false'}
        className={`ds-no-drag ds-code-sidebar flex min-h-0 flex-col border-l border-ds-border-muted ${readingMode ? 'is-reading' : ''} ${className ?? ''}`}
      >
        <WorkspaceFilePreviewChrome
          t={t}
          hostTabs={Boolean(hostTabs)}
          tabsScrollRef={tabsScrollRef}
          handleTabWheel={handleTabWheel}
          visibleTargets={visibleTargets}
          target={target}
          activeTargetKey={activeTargetKey}
          dirtyTargetKeys={dirtyTargetKeys}
          textDirty={textDirty}
          pinnedTargetKeySet={pinnedTargetKeySet}
          workspaceRoot={workspaceRoot}
          tabButtonRefs={tabButtonRefs}
          onSelectTarget={onSelectTarget}
          openTargetInEditor={openTargetInEditor}
          tabActionsEnabled={tabActionsEnabled}
          openTabMenu={openTabMenu}
          handleTabKeyDown={handleTabKeyDown}
          onRequestCloseTarget={onCloseTarget ? requestCloseTarget : undefined}
          currentFileName={currentFileName}
          breadcrumbSegments={breadcrumbSegments}
          viewMode={viewMode}
          editableText={editableText}
          editingText={editingText}
          onToggleEditing={() => setEditingText((value) => !value)}
          readingMode={readingMode}
          onToggleReadingMode={() => setReadingMode((value) => !value)}
          openWithItems={openWithItems}
          moreItems={moreItems}
          onToggleFileTree={onToggleFileTree}
          fileTreeOpen={fileTreeOpen}
          onClose={onClose}
        />
        <WorkspaceFilePreviewBody
          t={t}
          target={target}
          loading={loading}
          previewKind={previewKind}
          currentFileName={currentFileName}
          workspaceRoot={workspaceRoot}
          scrollRef={scrollRef}
          handlePreviewScroll={handlePreviewScroll}
          result={result}
          imageResult={imageResult}
          pdfResult={pdfResult}
          officeResult={officeResult}
          officeAgentEditing={officeAgentEditing}
          officeRefreshError={officeRefreshError}
          previewLease={previewLease}
          textSaveError={textSaveError}
          setTextSaveError={setTextSaveError}
          diskConflict={diskConflict}
          setDiskConflict={setDiskConflict}
          reloadText={reloadText}
          saveText={saveText}
          revertText={revertText}
          editingText={editingText}
          setEditingText={setEditingText}
          editableText={editableText}
          textDirty={textDirty}
          savingText={savingText}
          textDraft={textDraft}
          setTextDraft={setTextDraft}
          textDraftsRef={textDraftsRef}
          activeTargetKey={activeTargetKey}
          setDirtyTargetKeys={setDirtyTargetKeys}
          encodingNotice={nonUtf8 && textEncoding ? t('filePreviewEncodingReadOnly', { encoding: workspaceEncodingLabel(textEncoding) }) : null}
          onLoadMore={onLoadMore}
          loadMoreLabel={loadMoreLabel}
          isHtmlFile={isHtmlFile}
          htmlRendered={htmlRendered}
          isSvgFile={isSvgFile}
          svgRendered={svgRendered}
          svgDataUrl={svgDataUrl}
          isMarkdownFile={isMarkdownFile}
          markdownRendered={markdownRendered}
          tableDelimiter={tableDelimiter}
          tableRendered={tableRendered}
          codeSurfaceStyle={codeSurfaceStyle}
          activeLine={activeLine}
          lineNumbers={lineNumbers}
          highlightHtml={highlightHtml}
          imageZoom={imageZoom}
          setImageZoom={setImageZoom}
          onImageDimensions={setImageDimensions}
          mediaFailed={mediaFailed}
          setMediaFailed={setMediaFailed}
          onOpenSystem={openInSystem}
          onReveal={revealInFileManager}
          onRetry={() => rereadText({})}
          onCloseTab={onCloseTarget && target ? () => requestCloseTarget(target, textDirty) : undefined}
        />
        {target ? (
          <WorkspaceFilePreviewStatusBar
            t={t}
            left={statusLeft}
            right={statusRight}
            encoding={textEncoding ? { current: textEncoding, notice: nonUtf8, onPick: (encoding) => rereadText({ encoding }) } : undefined}
          />
        ) : null}
      </aside>
      <WorkspaceFilePreviewDialogs
        t={t}
        tabMenu={tabMenu}
        tabMenuRef={tabMenuRef}
        pinnedTargetKeySet={pinnedTargetKeySet}
        onTogglePinnedTarget={onTogglePinnedTarget}
        setTabMenu={setTabMenu}
        tabMenuTriggerRef={tabMenuTriggerRef}
        onCloseOtherTargets={onCloseOtherTargets}
        visibleTargets={visibleTargets}
        pendingCloseTarget={pendingCloseTarget}
        setPendingCloseTarget={setPendingCloseTarget}
        textDraftsRef={textDraftsRef}
        setDirtyTargetKeys={setDirtyTargetKeys}
        onCloseTarget={onCloseTarget}
        savingText={savingText}
        savePendingCloseTarget={savePendingCloseTarget}
      />
    </>
  )
}

export function renderedDocxPreviewText(container: ParentNode | null): string {
  const preview = container?.querySelector<HTMLElement>('.workspace-docx-preview')
  if (!preview) return ''
  return (preview.innerText || preview.textContent || '').replaceAll(' ', ' ').trim()
}
