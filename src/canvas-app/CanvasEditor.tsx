import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Excalidraw, exportToBlob, exportToSvg } from '@excalidraw/excalidraw'
import type { App } from '@modelcontextprotocol/ext-apps'
import { describeElements, prepareScene, sceneSignature, type StoredBoard } from './canvas-scene'

type ExcalidrawApi = Parameters<NonNullable<Parameters<typeof Excalidraw>[0]['excalidrawAPI']>>[0]
type Status = 'idle' | 'loading' | 'saving' | 'saved' | 'conflict' | 'error'
export type ToolResult = { structuredContent?: unknown }

const STRINGS = {
  en: {
    empty: 'Ask Kun to draw something, or start drawing here.',
    loading: 'Loading…', saving: 'Saving…', saved: 'Saved', conflict: 'Updated elsewhere, reloaded', error: 'Could not save',
    reference: 'Reference selection', referenceAll: 'Reference canvas', png: 'Export PNG', svg: 'Export SVG',
    referenced: 'Added to the next message'
  },
  zh: {
    empty: '让 Kun 画点什么，或者直接在这里开始绘制。',
    loading: '加载中…', saving: '保存中…', saved: '已保存', conflict: '已在别处更新，已重新加载', error: '保存失败',
    reference: '引用选区到对话', referenceAll: '引用整张画布', png: '导出 PNG', svg: '导出 SVG',
    referenced: '已加入下一条消息'
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

function structured<T>(result: { structuredContent?: unknown; isError?: boolean }): T | null {
  return !result.isError && result.structuredContent && typeof result.structuredContent === 'object'
    ? result.structuredContent as T
    : null
}

export function CanvasEditor({
  app,
  subscribeToolResult
}: {
  app: App
  subscribeToolResult: (listener: (result: ToolResult) => void) => () => void
}): ReactElement {
  const [api, setApi] = useState<ExcalidrawApi | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(app.getHostContext()?.theme === 'dark' ? 'dark' : 'light')
  const locale = (app.getHostContext()?.locale ?? navigator.language).toLowerCase().startsWith('zh') ? 'zh' : 'en'
  const text = STRINGS[locale]
  const [status, setStatus] = useState<Status>('idle')
  const [title, setTitle] = useState('')
  const [selectedCount, setSelectedCount] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const boardRef = useRef<{ boardId: string; revision: number; title: string } | null>(null)
  const savedSignatureRef = useRef('')
  const saveTimerRef = useRef<number | null>(null)
  const applyingRef = useRef(false)

  const commit = useCallback(async (): Promise<void> => {
    const board = boardRef.current
    if (!api || !board) return
    const elements = api.getSceneElementsIncludingDeleted()
    const signature = sceneSignature(elements)
    if (signature === savedSignatureRef.current) return
    setStatus('saving')
    const result = await app.callServerTool({
      name: 'canvas_commit',
      arguments: {
        boardId: board.boardId,
        expectedRevision: board.revision,
        elements: elements.filter((element) => !element.isDeleted),
        appState: { viewBackgroundColor: api.getAppState().viewBackgroundColor },
        files: api.getFiles()
      }
    }).catch(() => null)
    const saved = result ? structured<{ revision?: number; code?: string }>(result) : null
    if (saved?.revision && !result?.isError) {
      board.revision = saved.revision
      savedSignatureRef.current = signature
      setStatus('saved')
      return
    }
    const conflict = (result?.structuredContent as { code?: string } | undefined)?.code === 'conflict'
    setStatus(conflict ? 'conflict' : 'error')
    if (conflict) await loadBoard(board.boardId)
  }, [api, app])

  const loadBoard = useCallback(async (boardId: string): Promise<void> => {
    if (!api) return
    setStatus('loading')
    const result = await app.callServerTool({ name: 'canvas_get', arguments: { boardId } }).catch(() => null)
    const board = result ? structured<{ board?: StoredBoard }>(result)?.board : undefined
    if (!board) {
      setStatus('error')
      return
    }
    const { elements, normalized } = prepareScene(board)
    applyingRef.current = true
    api.updateScene({
      elements,
      ...(typeof board.appState?.viewBackgroundColor === 'string'
        ? { appState: { viewBackgroundColor: board.appState.viewBackgroundColor } }
        : {})
    })
    const files = Object.values(board.files ?? {})
    if (files.length > 0) api.addFiles(files as Parameters<ExcalidrawApi['addFiles']>[0])
    applyingRef.current = false
    const firstLoad = boardRef.current?.boardId !== board.boardId
    boardRef.current = { boardId: board.boardId, revision: board.revision, title: board.title }
    setTitle(board.title)
    savedSignatureRef.current = normalized ? '' : sceneSignature(api.getSceneElementsIncludingDeleted())
    if (firstLoad && elements.length > 0) api.scrollToContent(undefined, { fitToContent: true, animate: false })
    setStatus('saved')
    if (normalized) await commit()
  }, [api, app, commit])

  useEffect(() => {
    if (!api) return
    const onResult = (params: ToolResult): void => {
      const content = params.structuredContent as { boardId?: unknown; revision?: unknown } | undefined
      if (typeof content?.boardId !== 'string') return
      const current = boardRef.current
      if (current?.boardId === content.boardId && typeof content.revision === 'number' && content.revision <= current.revision) return
      void loadBoard(content.boardId)
    }
    const unsubscribe = subscribeToolResult(onResult)
    const onContext = (context: { theme?: string }): void => {
      if (context.theme === 'dark' || context.theme === 'light') setTheme(context.theme)
    }
    app.addEventListener('hostcontextchanged', onContext)
    return () => {
      unsubscribe()
      app.removeEventListener('hostcontextchanged', onContext)
    }
  }, [api, app, loadBoard, subscribeToolResult])

  const onChange = useCallback((elements: readonly { id: string; version: number; isDeleted?: boolean }[], appState: { selectedElementIds?: Record<string, boolean> }) => {
    setSelectedCount(Object.values(appState.selectedElementIds ?? {}).filter(Boolean).length)
    if (applyingRef.current || !boardRef.current) return
    if (sceneSignature(elements) === savedSignatureRef.current) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => void commit(), 800)
  }, [commit])

  const reference = async (): Promise<void> => {
    const board = boardRef.current
    if (!api || !board) return
    const ids = Object.entries(api.getAppState().selectedElementIds ?? {}).filter(([, on]) => on).map(([id]) => id)
    const elements = describeElements(api.getSceneElements(), ids.length ? new Set(ids) : undefined)
    const scope = ids.length ? `${ids.length} selected elements` : 'the whole canvas'
    await app.updateModelContext({
      content: [{
        type: 'text',
        text: `The user referenced ${scope} on canvas "${board.title}" (boardId ${board.boardId}, revision ${board.revision}). ` +
          `Use canvas_read for full details and canvas_apply with these element ids to change them.\n${JSON.stringify(elements)}`
      }],
      structuredContent: { boardId: board.boardId, revision: board.revision, elementIds: ids, elements }
    })
    setNotice(text.referenced)
    window.setTimeout(() => setNotice(null), 1_800)
  }

  const exportImage = async (format: 'png' | 'svg'): Promise<void> => {
    if (!api) return
    const input = { elements: api.getSceneElements(), appState: { ...api.getAppState(), exportBackground: true }, files: api.getFiles() }
    const name = `${(boardRef.current?.title || 'canvas').replace(/[\\/:*?"<>|]+/g, '-')}.${format}`
    const blob = format === 'png'
      ? await exportToBlob({ ...input, mimeType: 'image/png' })
      : new Blob([new XMLSerializer().serializeToString(await exportToSvg(input))], { type: 'image/svg+xml' })
    const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()))
    await app.downloadFile({
      contents: [{ type: 'resource', resource: { uri: `file:///${encodeURIComponent(name)}`, mimeType: blob.type, blob: data } }]
    }).catch(() => undefined)
  }

  const statusText = status === 'idle' ? '' : text[status as Exclude<Status, 'idle'>]
  return (
    <div className="kun-canvas-shell" data-theme={theme}>
      <header className="kun-canvas-toolbar">
        <span className="kun-canvas-title">{title || 'Canvas'}</span>
        <span className="kun-canvas-status" role="status">{notice ?? statusText}</span>
        <button type="button" disabled={!boardRef.current} onClick={() => void reference()}>
          {selectedCount > 0 ? `${text.reference} (${selectedCount})` : text.referenceAll}
        </button>
        <button type="button" disabled={!boardRef.current} onClick={() => void exportImage('png')}>{text.png}</button>
        <button type="button" disabled={!boardRef.current} onClick={() => void exportImage('svg')}>{text.svg}</button>
      </header>
      <div className="kun-canvas-stage">
        <Excalidraw
          excalidrawAPI={setApi}
          theme={theme}
          langCode={locale === 'zh' ? 'zh-CN' : 'en'}
          onChange={onChange}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false } }}
        />
        {status === 'idle' ? <div className="kun-canvas-empty">{text.empty}</div> : null}
      </div>
    </div>
  )
}
