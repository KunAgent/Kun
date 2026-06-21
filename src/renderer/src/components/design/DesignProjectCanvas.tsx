import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type Ref
} from 'react'
import {
  CheckCircle2,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FileDown,
  Globe,
  Monitor,
  MoreVertical,
  Palette,
  PenLine,
  Play,
  Plus,
  Share2,
  Smartphone,
  Sparkles,
  Star,
  Tablet,
  Trash2,
  Type as TypeIcon,
  type LucideIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DesignHtmlElementContext } from '../../design/design-composer-context'
import { resizeDesignArtifactNode, type DesignNodeResizeHandle } from '../../design/design-node-resize'
import { startDesignHtmlPreviewWatch } from '../../design/design-preview-file'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import {
  defaultDesignArtifactNode,
  type DesignArtifact,
  type DesignArtifactNode,
  type DesignCanvasView,
  type DesignViewport
} from '../../design/design-types'
import { SidebarTitlebarToggleButton } from '../sidebar/SidebarPrimitives'
import { DesignContextPopover } from './DesignContextPopover'

const VIEWPORTS: { id: DesignViewport; icon: LucideIcon; labelKey: string }[] = [
  { id: 'mobile', icon: Smartphone, labelKey: 'designViewportMobile' },
  { id: 'tablet', icon: Tablet, labelKey: 'designViewportTablet' },
  { id: 'desktop', icon: Monitor, labelKey: 'designViewportDesktop' }
]

const PROJECT_VIEWPORT_NODE_WIDTHS: Record<DesignViewport, number> = {
  mobile: 390,
  tablet: 768,
  desktop: 1280
}

const RESIZE_HANDLES: { id: DesignNodeResizeHandle; className: string; label: string }[] = [
  { id: 'nw', className: 'left-1 top-1 cursor-nwse-resize', label: 'Resize top left' },
  { id: 'n', className: 'left-1/2 top-1 -translate-x-1/2 cursor-ns-resize', label: 'Resize top' },
  { id: 'ne', className: 'right-1 top-1 cursor-nesw-resize', label: 'Resize top right' },
  { id: 'e', className: 'right-1 top-1/2 -translate-y-1/2 cursor-ew-resize', label: 'Resize right' },
  { id: 'se', className: 'bottom-1 right-1 cursor-nwse-resize', label: 'Resize bottom right' },
  { id: 's', className: 'bottom-1 left-1/2 -translate-x-1/2 cursor-ns-resize', label: 'Resize bottom' },
  { id: 'sw', className: 'bottom-1 left-1 cursor-nesw-resize', label: 'Resize bottom left' },
  { id: 'w', className: 'left-1 top-1/2 -translate-y-1/2 cursor-ew-resize', label: 'Resize left' }
]

type WebviewElement = HTMLElement & {
  executeJavaScript?: (code: string) => Promise<unknown>
}

/** Computed typography copied from the element so the in-place editor matches it visually. */
type InlineEditStyle = {
  fontFamily: string
  fontSize: string
  fontWeight: string
  fontStyle: string
  lineHeight: string
  letterSpacing: string
  color: string
  textAlign: string
  textTransform: string
  padding: string
}

type HtmlElementSelection = DesignHtmlElementContext & {
  rect: { left: number; top: number; width: number; height: number }
  /** True when the element has no child elements, so setting text content is non-destructive. */
  editableText: boolean
  /** Full text content used to seed the inline editor (untruncated, unlike `text`). */
  editText: string
  /** Typography of the element, used to render the in-place editor on top of it. */
  style: InlineEditStyle
}

type InlineEditState = {
  selector: string
  rect: { left: number; top: number; width: number; height: number }
  style: InlineEditStyle
  text: string
  multiline: boolean
}

type Props = {
  leftSidebarCollapsed: boolean
  onToggleLeftSidebar: () => void
  onOpenAgentSettings?: () => void
  onImplementDesign?: (artifact: DesignArtifact) => void
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
}

function HtmlScreenPreview({
  artifact,
  workspaceRoot,
  enabled,
  editable = false,
  viewMode = 'preview',
  devPreviewUrl = '',
  onError,
  onContentSize,
  onUseElementAsContext
}: {
  artifact: DesignArtifact
  workspaceRoot: string
  enabled: boolean
  editable?: boolean
  viewMode?: DesignCanvasView
  devPreviewUrl?: string
  onError: (message: string) => void
  onContentSize?: (size: { width: number; height: number }) => void
  onUseElementAsContext?: (context: DesignHtmlElementContext | null, promptSeed?: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [fileUrl, setFileUrl] = useState('')
  const [revision, setRevision] = useState(0)
  const [previewError, setPreviewError] = useState('')
  const [selectedElement, setSelectedElement] = useState<HtmlElementSelection | null>(null)
  const [inlineEdit, setInlineEdit] = useState<InlineEditState | null>(null)
  const [source, setSource] = useState('')
  const frameRef = useRef<HTMLDivElement | null>(null)
  const webviewRef = useRef<WebviewElement | null>(null)
  const inlineEditRef = useRef<HTMLDivElement | null>(null)
  const inlineCancelledRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    let cleanupWatch: (() => void) | null = null
    let retryTimer = 0
    let attempts = 0
    setFileUrl('')
    setRevision(0)
    setPreviewError('')
    if (!enabled || !workspaceRoot || artifact.kind !== 'html' || viewMode !== 'preview') return
    if (typeof window.kunGui?.authorizeWritePrototype !== 'function') {
      setPreviewError('authorizeWritePrototype is unavailable.')
      return
    }

    const reportError = (message: string): void => {
      setPreviewError(message)
      onError(message)
    }

    const authorize = (): void => {
      attempts += 1
      void window.kunGui
        .authorizeWritePrototype({ path: artifact.relativePath, workspaceRoot })
        .then((res) => {
          if (cancelled) return
          if (res.ok) {
            setPreviewError('')
            setFileUrl(res.fileUrl)
            cleanupWatch?.()
            cleanupWatch = startDesignHtmlPreviewWatch({
              workspaceRoot,
              path: artifact.relativePath,
              onRevision: (nextRevision) => {
                setPreviewError('')
                setRevision(nextRevision)
              },
              onError: reportError
            })
            return
          }
          if (res.message === 'prototype file not found' && attempts < 24) {
            retryTimer = window.setTimeout(authorize, 250)
            return
          }
          reportError(res.message)
        })
        .catch((error: unknown) => {
          if (!cancelled) reportError(error instanceof Error ? error.message : String(error))
        })
    }

    authorize()
    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      cleanupWatch?.()
    }
  }, [artifact.kind, artifact.relativePath, enabled, onError, viewMode, workspaceRoot])

  useEffect(() => {
    let cancelled = false
    setSource('')
    if (!enabled || !workspaceRoot || artifact.kind !== 'html' || viewMode !== 'code') return
    if (typeof window.kunGui?.readWorkspaceFile !== 'function') return
    void window.kunGui
      .readWorkspaceFile({ path: artifact.relativePath, workspaceRoot })
      .then((res) => {
        if (cancelled) return
        if (res.ok) setSource(res.content)
        else onError(res.message)
      })
      .catch((error: unknown) => {
        if (!cancelled) onError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      cancelled = true
    }
  }, [artifact.kind, artifact.relativePath, enabled, onError, viewMode, workspaceRoot])

  const previewUrl = fileUrl ? `${fileUrl}${fileUrl.includes('?') ? '&' : '?'}rev=${revision}` : ''
  const webviewUrl = viewMode === 'live' && devPreviewUrl ? devPreviewUrl : previewUrl
  const measureContent = useCallback((): void => {
    const webview = webviewRef.current
    if (!webview || !onContentSize || typeof webview.executeJavaScript !== 'function') return
    void webview
      .executeJavaScript(`(() => {
        const body = document.body
        const html = document.documentElement
        const width = Math.ceil(Math.max(
          body?.scrollWidth || 0,
          html?.scrollWidth || 0,
          body?.offsetWidth || 0,
          html?.clientWidth || 0
        ))
        const height = Math.ceil(Math.max(
          body?.scrollHeight || 0,
          html?.scrollHeight || 0,
          body?.offsetHeight || 0,
          html?.clientHeight || 0
        ))
        return { width, height }
      })()`)
      .then((value) => {
        if (!value || typeof value !== 'object') return
        const size = value as { width?: unknown; height?: unknown }
        if (typeof size.width === 'number' && typeof size.height === 'number') {
          onContentSize({ width: size.width, height: size.height })
        }
      })
      .catch(() => undefined)
  }, [onContentSize])

  useEffect(() => {
    if (!webviewUrl || !onContentSize) return
    const webview = webviewRef.current
    if (!webview) return
    const onReady = (): void => measureContent()
    webview.addEventListener('dom-ready', onReady)
    webview.addEventListener('did-finish-load', onReady)
    const timers = [
      window.setTimeout(measureContent, 180),
      window.setTimeout(measureContent, 700),
      window.setTimeout(measureContent, 1400)
    ]
    return () => {
      webview.removeEventListener('dom-ready', onReady)
      webview.removeEventListener('did-finish-load', onReady)
      timers.forEach((timer) => window.clearTimeout(timer))
    }
  }, [measureContent, onContentSize, webviewUrl])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame || !webviewUrl || !onContentSize || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      window.setTimeout(measureContent, 60)
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [measureContent, onContentSize, webviewUrl])

  useEffect(() => {
    setSelectedElement(null)
    setInlineEdit(null)
    onUseElementAsContext?.(null)
  }, [artifact.id, artifact.relativePath, onUseElementAsContext])

  // Focus the in-place editor and select all its text when editing starts.
  useEffect(() => {
    if (!inlineEdit) return
    const el = inlineEditRef.current
    if (!el) return
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [inlineEdit])

  const selectElementAt = useCallback(
    (event: React.PointerEvent<HTMLDivElement>): void => {
      if (!editable || event.button !== 0) return
      const webview = webviewRef.current
      if (!webview || typeof webview.executeJavaScript !== 'function') return
      event.preventDefault()
      event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top
      void webview
        .executeJavaScript(`(() => {
          const x = ${JSON.stringify(x)}
          const y = ${JSON.stringify(y)}
          const escapeCss = (value) => {
            if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
            return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&')
          }
          const selectorFor = (element) => {
            if (!element || element.nodeType !== Node.ELEMENT_NODE) return ''
            if (element.id) return '#' + escapeCss(element.id)
            const parts = []
            let current = element
            while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
              const tag = current.tagName.toLowerCase()
              if (tag === 'body') {
                parts.unshift('body')
                break
              }
              let index = 1
              let sibling = current.previousElementSibling
              while (sibling) {
                if (sibling.tagName === current.tagName) index += 1
                sibling = sibling.previousElementSibling
              }
              parts.unshift(tag + ':nth-of-type(' + index + ')')
              current = current.parentElement
            }
            return parts.join(' > ')
          }
          let element = document.elementFromPoint(x, y)
          if (!element || element === document.documentElement || element === document.body) {
            return { ok: false, message: 'No editable element at this point.' }
          }
          const bounds = element.getBoundingClientRect()
          const cs = window.getComputedStyle(element)
          return {
            ok: true,
            selector: selectorFor(element),
            tagName: element.tagName,
            text: (element.innerText || element.textContent || '').trim().slice(0, 500),
            editableText: element.children.length === 0,
            editText: (element.textContent || '').slice(0, 20000),
            html: element.outerHTML.slice(0, 1400),
            style: {
              fontFamily: cs.fontFamily,
              fontSize: cs.fontSize,
              fontWeight: cs.fontWeight,
              fontStyle: cs.fontStyle,
              lineHeight: cs.lineHeight,
              letterSpacing: cs.letterSpacing,
              color: cs.color,
              textAlign: cs.textAlign,
              textTransform: cs.textTransform,
              padding: cs.padding
            },
            rect: {
              left: Math.round(bounds.left),
              top: Math.round(bounds.top),
              width: Math.round(bounds.width),
              height: Math.round(bounds.height)
            }
          }
        })()`)
        .then((value) => {
          if (!value || typeof value !== 'object') return
          const result = value as {
            ok?: unknown
            message?: unknown
            selector?: unknown
            tagName?: unknown
            text?: unknown
            editableText?: unknown
            editText?: unknown
            html?: unknown
            style?: unknown
            rect?: unknown
          }
          if (!result.ok) {
            if (typeof result.message === 'string') setPreviewError(result.message)
            return
          }
          if (!result.rect || typeof result.rect !== 'object') return
          const resultRect = result.rect as { left?: unknown; top?: unknown; width?: unknown; height?: unknown }
          if (
            typeof result.selector !== 'string' ||
            typeof result.tagName !== 'string' ||
            typeof result.text !== 'string' ||
            typeof result.editableText !== 'boolean' ||
            typeof result.editText !== 'string' ||
            typeof result.html !== 'string' ||
            typeof result.style !== 'object' ||
            result.style === null ||
            typeof resultRect.left !== 'number' ||
            typeof resultRect.top !== 'number' ||
            typeof resultRect.width !== 'number' ||
            typeof resultRect.height !== 'number'
          ) {
            return
          }
          const selection: HtmlElementSelection = {
            artifactId: artifact.id,
            artifactTitle: artifact.title,
            artifactRelativePath: artifact.relativePath,
            selector: result.selector,
            tagName: result.tagName,
            text: result.text,
            editableText: result.editableText,
            editText: result.editText,
            html: result.html,
            style: result.style as InlineEditStyle,
            rect: {
              left: resultRect.left,
              top: resultRect.top,
              width: resultRect.width,
              height: resultRect.height
            }
          }
          setPreviewError('')
          setInlineEdit(null)
          setSelectedElement(selection)
          onUseElementAsContext?.(selection)
        })
        .catch((error: unknown) => {
          onError(error instanceof Error ? error.message : String(error))
        })
    },
    [artifact.id, artifact.relativePath, artifact.title, editable, onError, onUseElementAsContext]
  )

  const persistElementMutation = useCallback(
    async (selector: string, mutation: 'text' | 'delete', nextText?: string): Promise<boolean> => {
      const webview = webviewRef.current
      if (
        !webview ||
        typeof webview.executeJavaScript !== 'function' ||
        typeof window.kunGui?.writeWorkspaceFile !== 'function'
      ) {
        onError('HTML element editing is unavailable.')
        return false
      }
      const result = await webview
        .executeJavaScript(`(() => {
          const selector = ${JSON.stringify(selector)}
          const mutation = ${JSON.stringify(mutation)}
          const nextText = ${JSON.stringify(nextText ?? '')}
          const element = document.querySelector(selector)
          if (!element) return { ok: false, message: 'Selected element was not found.' }
          if (mutation === 'delete') {
            element.remove()
          } else if (element.children.length > 0) {
            return {
              ok: false,
              message: 'This element contains nested elements and cannot be edited as plain text.'
            }
          } else {
            element.style.removeProperty('visibility')
            element.textContent = nextText
          }
          const doctype = document.doctype
            ? '<!doctype ' + document.doctype.name + '>'
            : '<!doctype html>'
          return { ok: true, html: doctype + '\\n' + document.documentElement.outerHTML + '\\n' }
        })()`)
        .catch((error: unknown) => ({
          ok: false,
          message: error instanceof Error ? error.message : String(error)
        }))
      if (!result || typeof result !== 'object') return false
      const payload = result as { ok?: unknown; message?: unknown; html?: unknown }
      if (!payload.ok || typeof payload.html !== 'string') {
        onError(typeof payload.message === 'string' ? payload.message : 'HTML element edit failed.')
        return false
      }
      const write = await window.kunGui
        .writeWorkspaceFile({
          path: artifact.relativePath,
          workspaceRoot,
          content: payload.html
        })
        .catch((error: unknown) => ({
          ok: false as const,
          message: error instanceof Error ? error.message : String(error)
        }))
      if (!write.ok) {
        onError(write.message)
        return false
      }
      setSelectedElement(null)
      onUseElementAsContext?.(null)
      measureContent()
      return true
    },
    [artifact.relativePath, measureContent, onError, onUseElementAsContext, workspaceRoot]
  )

  const editSelectedText = useCallback((): void => {
    if (!selectedElement || !selectedElement.editableText) return
    const webview = webviewRef.current
    // Hide the live element so only the in-place editor (rendered on top of it) shows.
    if (webview && typeof webview.executeJavaScript === 'function') {
      void webview
        .executeJavaScript(`(() => {
          const el = document.querySelector(${JSON.stringify(selectedElement.selector)})
          if (el) el.style.visibility = 'hidden'
          return true
        })()`)
        .catch(() => undefined)
    }
    inlineCancelledRef.current = false
    setInlineEdit({
      selector: selectedElement.selector,
      rect: selectedElement.rect,
      style: selectedElement.style,
      text: selectedElement.editText,
      multiline: /\n/.test(selectedElement.editText)
    })
  }, [selectedElement])

  const restoreHiddenElement = useCallback((selector: string): void => {
    const webview = webviewRef.current
    if (!webview || typeof webview.executeJavaScript !== 'function') return
    void webview
      .executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)})
        if (el) el.style.removeProperty('visibility')
        return true
      })()`)
      .catch(() => undefined)
  }, [])

  const finishInlineEdit = useCallback(
    (commit: boolean): void => {
      const current = inlineEdit
      if (!current) return
      const nextText = inlineEditRef.current?.innerText ?? current.text
      setInlineEdit(null)
      if (commit && nextText !== current.text) {
        void persistElementMutation(current.selector, 'text', nextText)
      } else {
        restoreHiddenElement(current.selector)
      }
    },
    [inlineEdit, persistElementMutation, restoreHiddenElement]
  )

  const onInlineEditKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        inlineCancelledRef.current = true
        inlineEditRef.current?.blur()
      } else if (event.key === 'Enter' && !event.shiftKey && !inlineEdit?.multiline) {
        event.preventDefault()
        inlineEditRef.current?.blur()
      }
    },
    [inlineEdit]
  )

  const onInlineEditBlur = useCallback((): void => {
    if (inlineCancelledRef.current) {
      inlineCancelledRef.current = false
      finishInlineEdit(false)
      return
    }
    finishInlineEdit(true)
  }, [finishInlineEdit])

  const onInlineEditPaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const text = event.clipboardData.getData('text/plain')
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    range.deleteContents()
    range.insertNode(document.createTextNode(text))
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }, [])

  const deleteSelectedElement = useCallback((): void => {
    if (!selectedElement) return
    const confirmed = window.confirm(t('designElementDeleteConfirm', 'Delete this element?'))
    if (!confirmed) return
    void persistElementMutation(selectedElement.selector, 'delete')
  }, [persistElementMutation, selectedElement, t])

  const requestAiElementEdit = useCallback((): void => {
    if (!selectedElement) return
    onUseElementAsContext?.(
      selectedElement,
      t('designElementAiPromptSeed', 'Modify the selected element: ')
    )
  }, [onUseElementAsContext, selectedElement, t])

  if (viewMode === 'code') {
    return (
      <pre className="h-full overflow-hidden bg-[#101318] p-4 text-left text-[11px] leading-5 text-[#d6deeb]">
        <code>{source || t('designCanvasLoading')}</code>
      </pre>
    )
  }

  if (webviewUrl) {
    return (
      <div ref={frameRef} className="relative h-full w-full bg-white">
        <webview
          key={webviewUrl}
          ref={webviewRef as Ref<WebviewElement>}
          src={webviewUrl}
          partition="kun-proto"
          webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=yes"
          className="pointer-events-none h-full w-full border-0"
        />
        {previewError ? (
          <div className="pointer-events-none absolute inset-x-2 top-2 rounded-lg border border-[#c0392b]/25 bg-white/90 px-2 py-1 text-left text-[11px] leading-4 text-[#c0392b] shadow-sm backdrop-blur">
            {previewError}
          </div>
        ) : null}
        {editable && !inlineEdit ? (
          <div
            className="absolute inset-0 z-10 cursor-crosshair"
            onPointerDown={selectElementAt}
            title={t('designElementSelectHint', 'Select an element')}
          />
        ) : null}
        {editable && selectedElement && !inlineEdit ? (
          <div className="pointer-events-none absolute inset-0 z-20">
            <div
              className="absolute rounded-[4px] border-2 border-accent bg-accent/8 shadow-[0_0_0_1px_rgba(255,255,255,0.7)]"
              style={{
                left: selectedElement.rect.left,
                top: selectedElement.rect.top,
                width: Math.max(8, selectedElement.rect.width),
                height: Math.max(8, selectedElement.rect.height)
              }}
            />
            <div
              className="pointer-events-auto absolute min-w-44 overflow-hidden rounded-[14px] border border-ds-border bg-white/96 p-1.5 text-[12px] font-medium text-ds-muted shadow-[0_18px_46px_rgba(20,47,95,0.18)] backdrop-blur-xl"
              style={{
                left: Math.min(
                  Math.max(8, selectedElement.rect.left + Math.min(selectedElement.rect.width, 180) + 8),
                  Math.max(8, (frameRef.current?.clientWidth ?? 260) - 188)
                ),
                top: Math.min(
                  Math.max(8, selectedElement.rect.top),
                  Math.max(8, (frameRef.current?.clientHeight ?? 220) - 128)
                )
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={editSelectedText}
                disabled={!selectedElement.editableText}
                title={
                  selectedElement.editableText
                    ? undefined
                    : t('designElementEditTextDisabled', '该元素包含子元素,请使用「利用 AI 修改」')
                }
                className="flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-ds-muted"
              >
                <TypeIcon className="h-4 w-4" strokeWidth={1.8} />
                {t('designElementEditText', '修改文本')}
              </button>
              <button
                type="button"
                onClick={requestAiElementEdit}
                className="flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-left transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <Sparkles className="h-4 w-4 text-accent" strokeWidth={1.8} />
                {t('designElementAiEdit', '利用 AI 修改')}
              </button>
              <button
                type="button"
                onClick={deleteSelectedElement}
                className="flex h-9 w-full items-center gap-2 rounded-xl px-2.5 text-left text-[#c0392b] transition hover:bg-[#c0392b]/10"
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                {t('designElementDelete', '删除')}
              </button>
            </div>
          </div>
        ) : null}
        {editable && inlineEdit ? (
          <div className="pointer-events-none absolute inset-0 z-30">
            <div
              key={inlineEdit.selector}
              ref={inlineEditRef}
              contentEditable
              suppressContentEditableWarning
              spellCheck={false}
              role="textbox"
              aria-label={t('designElementEditText', '修改文本')}
              onKeyDown={onInlineEditKeyDown}
              onBlur={onInlineEditBlur}
              onPaste={onInlineEditPaste}
              className="pointer-events-auto absolute rounded-[3px] outline outline-2 outline-accent"
              style={
                {
                  left: inlineEdit.rect.left,
                  top: inlineEdit.rect.top,
                  minWidth: Math.max(24, inlineEdit.rect.width),
                  maxWidth: Math.max(
                    inlineEdit.rect.width,
                    (frameRef.current?.clientWidth ?? 600) - inlineEdit.rect.left - 8
                  ),
                  margin: 0,
                  background: 'transparent',
                  caretColor: 'currentColor',
                  whiteSpace: 'pre-wrap',
                  overflowWrap: 'anywhere',
                  fontFamily: inlineEdit.style.fontFamily,
                  fontSize: inlineEdit.style.fontSize,
                  fontWeight: inlineEdit.style.fontWeight,
                  fontStyle: inlineEdit.style.fontStyle,
                  lineHeight: inlineEdit.style.lineHeight,
                  letterSpacing: inlineEdit.style.letterSpacing,
                  color: inlineEdit.style.color,
                  textAlign: inlineEdit.style.textAlign,
                  textTransform: inlineEdit.style.textTransform,
                  padding: inlineEdit.style.padding
                } as CSSProperties
              }
            >
              {inlineEdit.text}
            </div>
          </div>
        ) : null}
      </div>
    )
  }

  const summary = artifact.versions[0]?.summary.trim()
  return (
    <div className="flex h-full items-center justify-center bg-white px-8 text-center">
      <div className="max-w-[280px]">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-ds-hover text-ds-muted">
          <Eye className="h-5 w-5" strokeWidth={1.7} />
        </div>
        <p className="mt-3 line-clamp-3 text-[12.5px] leading-5 text-ds-muted">
          {previewError || summary || t('designPreviewGenerating', 'Generating...')}
        </p>
      </div>
    </div>
  )
}

function viewModeIcon(view: DesignCanvasView): LucideIcon {
  if (view === 'code') return Code2
  if (view === 'live') return Globe
  return Eye
}

export function DesignProjectCanvas({
  leftSidebarCollapsed,
  onToggleLeftSidebar,
  onOpenAgentSettings,
  onImplementDesign,
  onUseElementAsContext
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const workspaceRoot = useDesignWorkspaceStore((s) => s.workspaceRoot)
  const artifacts = useDesignWorkspaceStore((s) => s.artifacts)
  const activeArtifactId = useDesignWorkspaceStore((s) => s.activeArtifactId)
  const canvasView = useDesignWorkspaceStore((s) => s.canvasView)
  const viewport = useDesignWorkspaceStore((s) => s.viewport)
  const devPreviewUrl = useDesignWorkspaceStore((s) => s.devPreviewUrl)
  const designIntentMode = useDesignWorkspaceStore((s) => s.designIntentMode)
  const setActiveArtifact = useDesignWorkspaceStore((s) => s.setActiveArtifact)
  const setCanvasView = useDesignWorkspaceStore((s) => s.setCanvasView)
  const setViewport = useDesignWorkspaceStore((s) => s.setViewport)
  const setFileError = useDesignWorkspaceStore((s) => s.setFileError)
  const setDesignIntentMode = useDesignWorkspaceStore((s) => s.setDesignIntentMode)
  const updateArtifactNode = useDesignWorkspaceStore((s) => s.updateArtifactNode)
  const duplicateArtifact = useDesignWorkspaceStore((s) => s.duplicateArtifact)
  const removeArtifact = useDesignWorkspaceStore((s) => s.removeArtifact)
  const renameArtifact = useDesignWorkspaceStore((s) => s.renameArtifact)
  const selectArtifactVersion = useDesignWorkspaceStore((s) => s.selectArtifactVersion)

  const htmlArtifacts = useMemo(
    () => artifacts.filter((artifact) => artifact.kind === 'html'),
    [artifacts]
  )
  const activeArtifact = artifacts.find((artifact) => artifact.id === activeArtifactId) ?? null
  const activeHtmlArtifact = activeArtifact?.kind === 'html' ? activeArtifact : null
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(0.72)
  const [moreOpen, setMoreOpen] = useState(false)
  const [contextPopoverOpen, setContextPopoverOpen] = useState(false)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [resizingId, setResizingId] = useState<string | null>(null)
  const dragRef = useRef<{
    id: string
    startClientX: number
    startClientY: number
    startX: number
    startY: number
  } | null>(null)
  const resizeRef = useRef<{
    id: string
    handle: DesignNodeResizeHandle
    startClientX: number
    startClientY: number
    node: DesignArtifactNode
  } | null>(null)
  const panningRef = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null)

  const focusComposer = (): void => {
    requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('[data-design-rail-composer] textarea')?.focus()
    })
  }

  const startGenerate = (): void => {
    setDesignIntentMode('generate')
    setActiveArtifact(null)
    setMoreOpen(false)
    focusComposer()
  }

  const startModify = (): void => {
    if (!activeHtmlArtifact) return
    setDesignIntentMode('modify')
    setMoreOpen(false)
    focusComposer()
  }

  const startPreview = (): void => {
    if (!activeHtmlArtifact) return
    setDesignIntentMode('preview')
    setCanvasView('preview')
    setMoreOpen(false)
  }

  const setPreviewMode = (view: DesignCanvasView): void => {
    setCanvasView(view)
    if (activeHtmlArtifact) updateArtifactNode(activeHtmlArtifact.id, { viewMode: view })
    setDesignIntentMode('preview')
  }

  const exportPrototype = (format: 'html' | 'pdf'): void => {
    if (!activeHtmlArtifact || !workspaceRoot || typeof window.kunGui?.exportDesignPrototype !== 'function') return
    setFileError(null)
    void window.kunGui
      .exportDesignPrototype({
        path: activeHtmlArtifact.relativePath,
        workspaceRoot,
        format,
        filename: activeHtmlArtifact.title
      })
      .then((res) => {
        if (!res.ok && !res.canceled) setFileError(res.message ?? t('designExportFailed'))
      })
      .catch(() => setFileError(t('designExportFailed')))
    setMoreOpen(false)
  }

  const openExternal = (): void => {
    if (!activeHtmlArtifact || !workspaceRoot) return
    if (canvasView === 'live' && devPreviewUrl) {
      void window.kunGui?.openExternal?.(devPreviewUrl)
    } else if (typeof window.kunGui?.openWritePrototype === 'function') {
      void window.kunGui.openWritePrototype({ path: activeHtmlArtifact.relativePath, workspaceRoot })
    }
    setMoreOpen(false)
  }

  const renameActive = (): void => {
    if (!activeHtmlArtifact) return
    const next = window.prompt(t('designProjectRenamePrompt'), activeHtmlArtifact.title)
    if (next != null) renameArtifact(activeHtmlArtifact.id, next)
    setMoreOpen(false)
  }

  const shareActive = (): void => {
    if (!activeHtmlArtifact) return
    void navigator.clipboard?.writeText?.(activeHtmlArtifact.relativePath)
    setMoreOpen(false)
  }

  const applyMeasuredContentSize = useCallback(
    (artifactId: string, size: { width: number; height: number }): void => {
      const artifact = useDesignWorkspaceStore.getState().artifacts.find((item) => item.id === artifactId)
      if (!artifact?.node || artifact.node.sizeMode === 'manual') return
      const chromeHeight = 36
      const nextHeight = Math.max(220, Math.min(1400, Math.ceil(size.height + chromeHeight)))
      if (Math.abs(nextHeight - artifact.node.height) < 8) return
      updateArtifactNode(artifactId, { height: nextHeight, sizeMode: 'auto' })
    },
    [updateArtifactNode]
  )

  const startResize = (
    event: React.PointerEvent<HTMLButtonElement>,
    artifactId: string,
    node: DesignArtifactNode,
    handle: DesignNodeResizeHandle
  ): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    setActiveArtifact(artifactId)
    if (designIntentMode === 'generate') setDesignIntentMode('modify')
    resizeRef.current = {
      id: artifactId,
      handle,
      startClientX: event.clientX,
      startClientY: event.clientY,
      node
    }
    dragRef.current = null
    panningRef.current = null
    setDraggingId(null)
    setResizingId(artifactId)
    window.getSelection()?.removeAllRanges()
  }

  useEffect(() => {
    if (!resizingId) return

    const onPointerMove = (event: PointerEvent): void => {
      const resize = resizeRef.current
      if (!resize) return
      const deltaX = (event.clientX - resize.startClientX) / zoom
      const deltaY = (event.clientY - resize.startClientY) / zoom
      updateArtifactNode(
        resize.id,
        resizeDesignArtifactNode({
          node: resize.node,
          handle: resize.handle,
          deltaX,
          deltaY
        })
      )
    }

    const onPointerEnd = (): void => {
      resizeRef.current = null
      setResizingId(null)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerEnd)
    window.addEventListener('pointercancel', onPointerEnd)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerEnd)
      window.removeEventListener('pointercancel', onPointerEnd)
    }
  }, [resizingId, updateArtifactNode, zoom])

  const onWorldPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || event.target !== event.currentTarget) return
    panningRef.current = { clientX: event.clientX, clientY: event.clientY, x: pan.x, y: pan.y }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onWorldPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag) {
      const dx = (event.clientX - drag.startClientX) / zoom
      const dy = (event.clientY - drag.startClientY) / zoom
      updateArtifactNode(drag.id, { x: drag.startX + dx, y: drag.startY + dy })
      return
    }
    const panning = panningRef.current
    if (!panning) return
    setPan({
      x: panning.x + event.clientX - panning.clientX,
      y: panning.y + event.clientY - panning.clientY
    })
  }

  const endPointerAction = (): void => {
    dragRef.current = null
    resizeRef.current = null
    panningRef.current = null
    setDraggingId(null)
    setResizingId(null)
  }

  const onWheel = (event: React.WheelEvent<HTMLDivElement>): void => {
    if (!event.metaKey && !event.ctrlKey) {
      setPan((current) => ({ x: current.x - event.deltaX, y: current.y - event.deltaY }))
      return
    }
    event.preventDefault()
    const nextZoom = Math.max(0.22, Math.min(1.8, zoom * (event.deltaY > 0 ? 0.92 : 1.08)))
    setZoom(nextZoom)
  }

  const canvasButton =
    'inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-45'
  const activeButton = 'bg-white text-ds-ink shadow-sm dark:bg-white/12 dark:text-white'
  const mutedButton = 'text-ds-muted hover:bg-white/70 hover:text-ds-ink dark:hover:bg-white/10'
  const ViewIcon = viewModeIcon(canvasView)

  return (
    <div className="ds-no-drag relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[color-mix(in_srgb,var(--ds-bg-main)_90%,white)] dark:bg-[color-mix(in_srgb,var(--ds-bg-main)_88%,black)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,color-mix(in_srgb,var(--ds-muted)_22%,transparent)_1px,transparent_0)] [background-size:18px_18px]" />

      <div
        className={`pointer-events-none absolute left-3 top-3 z-40 ${
          leftSidebarCollapsed ? 'ds-window-controls-safe-inset' : ''
        }`}
      >
        <div className="pointer-events-auto">
          <SidebarTitlebarToggleButton
            onClick={onToggleLeftSidebar}
            title={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
            ariaLabel={leftSidebarCollapsed ? t('sidebarExpand') : t('sidebarCollapse')}
          />
        </div>
      </div>

      <div className="pointer-events-none absolute left-1/2 top-3 z-50 w-[min(760px,calc(100%-7rem))] -translate-x-1/2">
        <div className="pointer-events-auto mx-auto flex w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full border border-ds-border bg-white/76 px-1.5 py-1.5 shadow-[0_16px_42px_rgba(20,47,95,0.11)] backdrop-blur-2xl dark:bg-ds-card/80">
          <button
            type="button"
            onClick={startGenerate}
            className={`${canvasButton} ${designIntentMode === 'generate' ? activeButton : mutedButton}`}
          >
            <Plus className="h-4 w-4" strokeWidth={1.9} />
            {t('designProjectGenerate')}
          </button>
          <button
            type="button"
            onClick={startModify}
            disabled={!activeHtmlArtifact}
            className={`${canvasButton} ${designIntentMode === 'modify' ? activeButton : mutedButton}`}
          >
            <PenLine className="h-4 w-4" strokeWidth={1.9} />
            {t('designProjectModify')}
          </button>
          <button
            type="button"
            onClick={startPreview}
            disabled={!activeHtmlArtifact}
            className={`${canvasButton} ${designIntentMode === 'preview' ? activeButton : mutedButton}`}
          >
            <ViewIcon className="h-4 w-4" strokeWidth={1.9} />
            {t('designProjectPreview')}
          </button>
          {(['preview', 'code', 'live'] as const).map((view) => {
            if (view === 'live' && !devPreviewUrl) return null
            const Icon = viewModeIcon(view)
            const label =
              view === 'preview'
                ? t('designViewPreview')
                : view === 'code'
                  ? t('designViewCode')
                  : t('designViewLive')
            return (
              <button
                key={view}
                type="button"
                onClick={() => setPreviewMode(view)}
                disabled={!activeHtmlArtifact}
                className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-45 ${
                  canvasView === view ? activeButton : mutedButton
                }`}
                title={label}
                aria-label={label}
              >
                <Icon className="h-4 w-4" strokeWidth={1.85} />
              </button>
            )
          })}
          {VIEWPORTS.map(({ id, icon: Icon, labelKey }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setViewport(id)
                if (activeHtmlArtifact) {
                  updateArtifactNode(activeHtmlArtifact.id, {
                    width: PROJECT_VIEWPORT_NODE_WIDTHS[id],
                    sizeMode: 'auto'
                  })
                }
              }}
              className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition ${
                viewport === id ? activeButton : mutedButton
              }`}
              title={t(labelKey)}
              aria-label={t(labelKey)}
            >
              <Icon className="h-4 w-4" strokeWidth={1.85} />
            </button>
          ))}
          <div className="h-6 w-px shrink-0 bg-ds-border-muted/80" />
          <div className="relative">
            <button
              type="button"
              onClick={() => setMoreOpen((open) => !open)}
              className={`${canvasButton} ${mutedButton}`}
              aria-label={t('designProjectMore')}
              title={t('designProjectMore')}
            >
              <MoreVertical className="h-4 w-4" strokeWidth={1.9} />
              {t('designProjectMore')}
            </button>
            {moreOpen ? (
              <div className="absolute left-1/2 top-full z-50 mt-2 w-56 -translate-x-1/2 overflow-hidden rounded-[18px] border border-ds-border bg-white/95 p-1.5 text-[13px] text-ds-muted shadow-[0_18px_48px_rgba(20,47,95,0.16)] backdrop-blur-xl dark:bg-ds-card/95">
                <button type="button" onClick={renameActive} disabled={!activeHtmlArtifact} className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45">
                  <PenLine className="h-4 w-4" strokeWidth={1.8} /> {t('designProjectRename')}
                </button>
                <button type="button" onClick={() => activeHtmlArtifact && void duplicateArtifact(activeHtmlArtifact.id)} disabled={!activeHtmlArtifact} className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45">
                  <Copy className="h-4 w-4" strokeWidth={1.8} /> {t('designProjectDuplicate')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!activeHtmlArtifact) return
                    updateArtifactNode(activeHtmlArtifact.id, {
                      favorite: !activeHtmlArtifact.node?.favorite
                    })
                  }}
                  disabled={!activeHtmlArtifact}
                  className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45"
                >
                  <Star className="h-4 w-4" strokeWidth={1.8} /> {t('designProjectFavorite')}
                </button>
                <button type="button" onClick={() => exportPrototype('html')} disabled={!activeHtmlArtifact} className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45">
                  <Download className="h-4 w-4" strokeWidth={1.8} /> {t('designExportHtml')}
                </button>
                <button type="button" onClick={() => exportPrototype('pdf')} disabled={!activeHtmlArtifact} className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45">
                  <FileDown className="h-4 w-4" strokeWidth={1.8} /> {t('designExportPdf')}
                </button>
                <button type="button" onClick={openExternal} disabled={!activeHtmlArtifact} className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45">
                  <ExternalLink className="h-4 w-4" strokeWidth={1.8} /> {t('designOpenExternal')}
                </button>
                <button type="button" onClick={shareActive} disabled={!activeHtmlArtifact} className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-45">
                  <Share2 className="h-4 w-4" strokeWidth={1.8} /> {t('designProjectShare')}
                </button>
                {activeHtmlArtifact && onImplementDesign ? (
                  <button type="button" onClick={() => onImplementDesign(activeHtmlArtifact)} className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink">
                    <Play className="h-4 w-4" strokeWidth={1.8} /> {t('designImplement')}
                  </button>
                ) : null}
                {activeHtmlArtifact?.versions.length && activeHtmlArtifact.versions.length > 1 ? (
                  <div className="my-1 border-t border-ds-border-muted pt-1">
                    {activeHtmlArtifact.versions.slice(0, 5).map((version, index) => (
                      <button
                        key={version.id}
                        type="button"
                        onClick={() => selectArtifactVersion(activeHtmlArtifact.id, version.id)}
                        className="flex h-8 w-full items-center gap-2 rounded-xl px-3 text-left transition hover:bg-ds-hover hover:text-ds-ink"
                      >
                        <CheckCircle2 className={`h-3.5 w-3.5 ${version.relativePath === activeHtmlArtifact.relativePath ? 'text-accent' : 'text-ds-faint'}`} strokeWidth={1.8} />
                        {t('designProjectVersion', { version: activeHtmlArtifact.versions.length - index })}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="my-1 border-t border-ds-border-muted pt-1">
                  <button type="button" onClick={() => activeHtmlArtifact && removeArtifact(activeHtmlArtifact.id)} disabled={!activeHtmlArtifact} className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left text-[#c0392b] transition hover:bg-[#c0392b]/10 disabled:opacity-45">
                    <Trash2 className="h-4 w-4" strokeWidth={1.8} /> {t('designDeleteArtifact')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute right-4 top-4 z-50 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setContextPopoverOpen((open) => !open)}
          className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border border-ds-border bg-white/80 text-ds-muted shadow-[0_12px_34px_rgba(20,47,95,0.10)] backdrop-blur-xl transition hover:bg-white hover:text-ds-ink dark:bg-ds-card/82"
          aria-label={t('designContextLabel')}
          title={t('designContextLabel')}
        >
          <Palette className="h-4 w-4" strokeWidth={1.9} />
        </button>
        {contextPopoverOpen ? (
          <div className="pointer-events-auto absolute right-0 top-full mt-2">
            <DesignContextPopover
              open={contextPopoverOpen}
              onClose={() => setContextPopoverOpen(false)}
              onOpenSettings={onOpenAgentSettings}
              titleKey="designContextLabel"
            />
          </div>
        ) : null}
      </div>

      <div
        className="absolute inset-0 cursor-grab overflow-hidden active:cursor-grabbing"
        onPointerDown={onWorldPointerDown}
        onPointerMove={onWorldPointerMove}
        onPointerUp={endPointerAction}
        onPointerCancel={endPointerAction}
        onWheel={onWheel}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
        >
          {htmlArtifacts.map((artifact, index) => {
            const node = artifact.node ?? defaultDesignArtifactNode(index)
            const active = artifact.id === activeArtifactId
            const previewEnabled = active || index < 4
            const cardView = active ? canvasView : 'preview'
            const versionLabel = `v${artifact.versions.length}`
            return (
              <div
                key={artifact.id}
                className={`absolute overflow-hidden rounded-[18px] border bg-white shadow-[0_16px_46px_rgba(20,47,95,0.12)] ${
                  draggingId === artifact.id || resizingId === artifact.id ? '' : 'transition'
                } ${
                  active
                    ? 'border-accent ring-4 ring-accent/18'
                    : 'border-ds-border hover:border-accent/55'
                } ${draggingId === artifact.id ? 'opacity-85' : ''}`}
                style={{
                  transform: `translate(${node.x}px, ${node.y}px)`,
                  width: node.width,
                  height: node.height
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return
                  event.stopPropagation()
                  setActiveArtifact(artifact.id)
                  if (designIntentMode === 'generate') setDesignIntentMode('modify')
                  dragRef.current = {
                    id: artifact.id,
                    startClientX: event.clientX,
                    startClientY: event.clientY,
                    startX: node.x,
                    startY: node.y
                  }
                  setDraggingId(artifact.id)
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerUp={endPointerAction}
              >
                <div className="flex h-9 items-center gap-2 border-b border-ds-border-muted bg-white/86 px-3 text-[12px] font-semibold text-ds-muted backdrop-blur">
                  <Monitor className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                  <span className="min-w-0 flex-1 truncate">{artifact.title}</span>
                  {artifact.node?.favorite ? <Star className="h-3.5 w-3.5 fill-current text-[#d99b22]" strokeWidth={1.8} /> : null}
                  <span className="rounded-full bg-ds-hover px-2 py-0.5 text-[11px] text-ds-faint">
                    {versionLabel}
                  </span>
                </div>
                <div className="h-[calc(100%-2.25rem)]">
                  <HtmlScreenPreview
                    artifact={artifact}
                    workspaceRoot={workspaceRoot}
                    enabled={previewEnabled}
                    editable={active && cardView === 'preview'}
                    viewMode={cardView}
                    devPreviewUrl={active ? devPreviewUrl : ''}
                    onError={setFileError}
                    onContentSize={(size) => applyMeasuredContentSize(artifact.id, size)}
                    onUseElementAsContext={active ? onUseElementAsContext : undefined}
                  />
                </div>
                {active ? (
                  <div className="pointer-events-none absolute inset-x-0 bottom-2 flex justify-center">
                    <span className="rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-white shadow-lg">
                      {Math.round(node.width)} x {Math.round(node.height)}
                    </span>
                  </div>
                ) : null}
                {active ? (
                  <div className="pointer-events-none absolute inset-0">
                    {RESIZE_HANDLES.map((handle) => (
                      <button
                        key={handle.id}
                        type="button"
                        aria-label={handle.label}
                        title={handle.label}
                        onPointerDown={(event) => startResize(event, artifact.id, node, handle.id)}
                        className={`pointer-events-auto absolute h-3.5 w-3.5 rounded-[4px] border border-accent bg-white shadow-[0_2px_8px_rgba(37,99,235,0.28)] transition hover:scale-110 ${handle.className}`}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        {htmlArtifacts.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center">
            <div className="max-w-[380px]">
              <div className="text-[15px] font-semibold text-ds-ink">
                {t('designCanvasEmptyTitle')}
              </div>
              <div className="mt-2 text-[13px] leading-6 text-ds-muted">
                {t('designCanvasPlaceholder')}
              </div>
              <button
                type="button"
                onClick={startGenerate}
                className="pointer-events-auto mt-4 inline-flex items-center justify-center rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90"
              >
                {t('designCanvasEmptyAction')}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {designIntentMode === 'preview' && activeHtmlArtifact ? (
        <div className="pointer-events-none absolute bottom-[116px] right-4 top-[76px] z-40 hidden w-[min(420px,calc(100%-2rem))] lg:block">
          <div className="pointer-events-auto flex h-full flex-col overflow-hidden rounded-[24px] border border-ds-border bg-white/82 shadow-[0_24px_70px_rgba(20,47,95,0.14)] backdrop-blur-2xl dark:bg-ds-canvas/92">
            <div className="flex h-12 shrink-0 items-center gap-2 border-b border-ds-border-muted px-3">
              <Eye className="h-4 w-4 text-accent" strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ds-ink">
                {activeHtmlArtifact.title}
              </span>
            </div>
            <div className="min-h-0 flex-1">
              <HtmlScreenPreview
                artifact={activeHtmlArtifact}
                workspaceRoot={workspaceRoot}
                enabled
                editable={false}
                viewMode={canvasView}
                devPreviewUrl={devPreviewUrl}
                onError={setFileError}
              />
            </div>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute bottom-4 right-4 z-40 hidden items-center gap-2 lg:flex">
        <div className="pointer-events-auto rounded-full border border-ds-border bg-white/78 px-3 py-2 text-[13px] font-semibold text-ds-muted shadow-[0_12px_34px_rgba(20,47,95,0.10)] backdrop-blur-xl">
          {Math.round(zoom * 100)}%
        </div>
      </div>
    </div>
  )
}
