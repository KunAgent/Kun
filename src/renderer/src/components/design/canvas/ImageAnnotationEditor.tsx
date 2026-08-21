import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  ArrowUpRight,
  Check,
  Loader2,
  MousePointer2,
  Pencil,
  SlidersHorizontal,
  Square,
  Trash2,
  Type,
  Undo2,
  X
} from 'lucide-react'
import { loadWorkspaceImageDataUrl } from '../../../design/canvas/canvas-image-source'
import {
  annotationHandles,
  hitTestAnnotationHandle,
  hitTestAnnotations,
  paintAnnotation,
  paintAnnotationSelection,
  resizeAnnotation,
  translateAnnotation,
  type AnnotationHandle
} from './image-annotation-geometry'
import {
  clearAnnotationHistory,
  commitAnnotationHistory,
  createAnnotationHistory,
  undoAnnotationHistory
} from './image-annotation-history'
import {
  ANNOTATION_FONT_STACKS,
  createAnnotationId,
  createDefaultToolStyles,
  imageAnnotationTextNotes,
  patchAnnotationStyle,
  patchToolStyle,
  styleForAnnotation,
  type AnnotationOp,
  type AnnotationPoint,
  type AnnotationStylePatch,
  type AnnotationTool,
  type DrawingAnnotationTool,
  type ToolStyleMap
} from './image-annotation-model'
import {
  createImageAnnotationTextDraftAtCanvasPoint,
  createImageAnnotationTextDraftAtRenderedPoint,
  createImageAnnotationTextOp,
  resizeImageAnnotationTextEditor,
  shouldCommitImageAnnotationTextKey,
  type ImageAnnotationTextDraft
} from './image-annotation-text'
import { ImageAnnotationStylePanel } from './ImageAnnotationStylePanel'

export {
  createImageAnnotationTextDraftAtRenderedPoint,
  createImageAnnotationTextOp,
  imageAnnotationTextNotes,
  shouldCommitImageAnnotationTextKey
}
export type { ImageAnnotationTextDraft }

export type ImageAnnotationResult = {
  /** Base64 PNG bytes of the flattened picture + markup (no `data:` prefix). */
  dataBase64: string
  mimeType: 'image/png'
  /** Verbatim text labels the user typed onto the image. */
  textNotes: string[]
  /** Free-form instruction typed in the editor's field. */
  instruction: string
}

type Props = {
  imageUrl: string
  workspaceRoot: string
  title?: string
  busy?: boolean
  onCancel: () => void
  onApply: (result: ImageAnnotationResult) => void
}

type Gesture =
  | { kind: 'draw'; op: AnnotationOp }
  | { kind: 'move'; id: string; start: AnnotationPoint; original: AnnotationOp }
  | { kind: 'resize'; id: string; handle: AnnotationHandle; original: AnnotationOp }

const MAX_FLATTEN_DIM = 1280

const TOOLS: { tool: AnnotationTool; label: string; Icon: typeof Pencil }[] = [
  { tool: 'select', label: '选择', Icon: MousePointer2 },
  { tool: 'pen', label: '画笔', Icon: Pencil },
  { tool: 'arrow', label: '箭头', Icon: ArrowUpRight },
  { tool: 'rect', label: '方框', Icon: Square },
  { tool: 'text', label: '文字', Icon: Type }
]

export const IMAGE_ANNOTATION_ROOT_CLASS =
  'ds-no-drag fixed inset-0 z-[200] flex flex-col bg-black/75 backdrop-blur-sm'

export const IMAGE_ANNOTATION_TOP_BAR_CLASS =
  'ds-drag flex shrink-0 items-center justify-between gap-3 py-3 pr-5 text-white'

export const IMAGE_ANNOTATION_INSTRUCTION_INPUT_CLASS =
  'ds-no-drag relative z-10 w-[min(560px,calc(100vw-3rem))] appearance-none rounded-full border border-white/25 bg-white/10 px-4 py-2.5 text-[13px] text-white caret-white outline-none transition placeholder:text-white/55 focus:border-white/55 focus:bg-white/15 disabled:cursor-wait disabled:opacity-60'

function replaceAnnotation(ops: AnnotationOp[], replacement: AnnotationOp): AnnotationOp[] {
  return ops.map((op) => op.id === replacement.id ? replacement : op)
}

function drawingOp(
  tool: Exclude<DrawingAnnotationTool, 'text'>,
  point: AnnotationPoint,
  styles: ToolStyleMap
): AnnotationOp {
  const id = createAnnotationId()
  if (tool === 'pen') return { id, kind: 'pen', ...styles.pen, points: [point] }
  if (tool === 'arrow') return { id, kind: 'arrow', ...styles.arrow, from: point, to: point }
  return { id, kind: 'rect', ...styles.rect, from: point, to: point }
}

function selectedCursor(gesture: Gesture | null, tool: AnnotationTool): string {
  if (gesture?.kind === 'move') return 'grabbing'
  if (gesture?.kind === 'resize') return 'nwse-resize'
  if (tool === 'text') return 'text'
  if (tool === 'select') return 'default'
  return 'crosshair'
}

export function ImageAnnotationEditor({
  imageUrl,
  workspaceRoot,
  title,
  busy = false,
  onCancel,
  onApply
}: Props): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const [tool, setTool] = useState<AnnotationTool>('arrow')
  const [toolStyles, setToolStyles] = useState<ToolStyleMap>(() => createDefaultToolStyles(800))
  const [history, setHistory] = useState(() => createAnnotationHistory())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [instruction, setInstruction] = useState('')
  const [stylePanelOpen, setStylePanelOpen] = useState(false)
  const [textDraft, setTextDraft] = useState<ImageAnnotationTextDraft | null>(null)
  const [textValue, setTextValue] = useState('')
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const textInputRef = useRef<HTMLTextAreaElement | null>(null)
  const textDraftRef = useRef<ImageAnnotationTextDraft | null>(null)
  const textValueRef = useRef('')
  const editingTextIdRef = useRef<string | null>(null)
  const textCompositionRef = useRef(false)
  const gestureRef = useRef<Gesture | null>(null)
  const previewOpRef = useRef<AnnotationOp | null>(null)
  const [, forceTick] = useState(0)
  const rerender = useCallback(() => forceTick((value) => value + 1), [])
  const ops = history.present

  const selectedOp = useMemo(
    () => ops.find((op) => op.id === selectedId) ?? null,
    [ops, selectedId]
  )
  const styleTarget: DrawingAnnotationTool | null = selectedOp?.kind ?? (tool === 'select' ? null : tool)
  const displayedStyle = selectedOp
    ? styleForAnnotation(selectedOp)
    : styleTarget
      ? toolStyles[styleTarget]
      : {}

  const commitOps = useCallback((next: AnnotationOp[]) => {
    setHistory((current) => commitAnnotationHistory(current, next))
  }, [])

  useEffect(() => {
    if (selectedId && !ops.some((op) => op.id === selectedId)) setSelectedId(null)
  }, [ops, selectedId])

  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    setLoadError('')
    void loadWorkspaceImageDataUrl(workspaceRoot, imageUrl).then((src) => {
      if (cancelled) return
      if (!src) {
        setLoadError('无法加载这张图片')
        return
      }
      const img = new Image()
      img.onload = () => {
        if (cancelled) return
        imageRef.current = img
        const naturalLongest = Math.max(img.naturalWidth, img.naturalHeight) || 1
        const scale = naturalLongest > MAX_FLATTEN_DIM ? MAX_FLATTEN_DIM / naturalLongest : 1
        const canvas = canvasRef.current
        if (canvas) {
          canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
          canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
          setToolStyles(createDefaultToolStyles(Math.max(canvas.width, canvas.height)))
        }
        setLoaded(true)
      }
      img.onerror = () => {
        if (!cancelled) setLoadError('无法加载这张图片')
      }
      img.src = src
    })
    return () => {
      cancelled = true
    }
  }, [imageUrl, workspaceRoot])

  useEffect(() => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img || !loaded) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const preview = previewOpRef.current
    for (const op of ops) paintAnnotation(ctx, preview?.id === op.id ? preview : op)
    if (preview && !ops.some((op) => op.id === preview.id)) paintAnnotation(ctx, preview)
    const selected = preview?.id === selectedId ? preview : selectedOp
    if (selected) {
      const rect = canvas.getBoundingClientRect()
      paintAnnotationSelection(ctx, selected, rect.width > 0 ? canvas.width / rect.width : 1)
    }
  })

  useEffect(() => {
    if (!textDraft) return undefined
    const frame = window.requestAnimationFrame(() => {
      const textarea = textInputRef.current
      if (!textarea) return
      resizeImageAnnotationTextEditor(textarea, textDraft)
      textarea.focus({ preventScroll: true })
      if (editingTextIdRef.current) textarea.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [textDraft])

  useEffect(() => {
    const textarea = textInputRef.current
    if (textarea && textDraft) resizeImageAnnotationTextEditor(textarea, textDraft)
  }, [textDraft, textValue])

  const toCanvasPoint = useCallback((event: React.PointerEvent<HTMLCanvasElement>): AnnotationPoint => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: Math.min(canvas.width, Math.max(0, (event.clientX - rect.left) * (canvas.width / rect.width))),
      y: Math.min(canvas.height, Math.max(0, (event.clientY - rect.top) * (canvas.height / rect.height)))
    }
  }, [])

  const canvasTolerance = useCallback((renderedPixels: number): number => {
    const canvas = canvasRef.current
    if (!canvas) return renderedPixels
    const rect = canvas.getBoundingClientRect()
    return rect.width > 0 ? renderedPixels * (canvas.width / rect.width) : renderedPixels
  }, [])

  const openTextDraft = useCallback((draft: ImageAnnotationTextDraft, value = '', id: string | null = null) => {
    textCompositionRef.current = false
    textDraftRef.current = draft
    textValueRef.current = value
    editingTextIdRef.current = id
    setTextValue(value)
    setEditingTextId(id)
    setTextDraft(draft)
  }, [])

  const cancelTextDraft = useCallback(() => {
    textDraftRef.current = null
    textValueRef.current = ''
    editingTextIdRef.current = null
    textCompositionRef.current = false
    setTextDraft(null)
    setTextValue('')
    setEditingTextId(null)
  }, [])

  const startEditingText = useCallback((op: Extract<AnnotationOp, { kind: 'text' }>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const draft = createImageAnnotationTextDraftAtCanvasPoint({
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      layoutWidth: canvas.offsetWidth,
      layoutHeight: canvas.offsetHeight,
      renderedWidth: rect.width,
      renderedHeight: rect.height,
      canvasX: op.x,
      canvasY: op.y,
      canvasFontSize: op.fontSize
    })
    if (draft) openTextDraft(draft, op.text, op.id)
  }, [openTextDraft])

  const commitText = useCallback(() => {
    const draft = textDraftRef.current
    const value = textValueRef.current
    const editingId = editingTextIdRef.current
    const existing = editingId
      ? history.present.find((op): op is Extract<AnnotationOp, { kind: 'text' }> => op.id === editingId && op.kind === 'text')
      : null
    const style = existing ?? toolStyles.text
    const op = createImageAnnotationTextOp(draft, value, style.color, style.fontSize, {
      id: existing?.id,
      opacity: style.opacity,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight
    })
    cancelTextDraft()
    if (!op) return
    const next = existing ? replaceAnnotation(history.present, op) : [...history.present, op]
    commitOps(next)
    setSelectedId(op.id)
  }, [cancelTextDraft, commitOps, history.present, toolStyles.text])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!loaded || busy) return
    if (textDraftRef.current) {
      commitText()
      return
    }
    const point = toCanvasPoint(event)
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (tool === 'text') {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      const draft = createImageAnnotationTextDraftAtRenderedPoint({
        canvasWidth: event.currentTarget.width,
        canvasHeight: event.currentTarget.height,
        layoutWidth: event.currentTarget.offsetWidth,
        layoutHeight: event.currentTarget.offsetHeight,
        renderedWidth: rect.width,
        renderedHeight: rect.height,
        renderedX: event.clientX - rect.left,
        renderedY: event.clientY - rect.top,
        canvasFontSize: toolStyles.text.fontSize
      })
      if (draft) openTextDraft(draft)
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === 'select') {
      const selected = history.present.find((op) => op.id === selectedId)
      const handle = selected
        ? hitTestAnnotationHandle(selected, point, canvasTolerance(8), ctx)
        : null
      if (selected && handle) {
        gestureRef.current = { kind: 'resize', id: selected.id, handle, original: selected }
        previewOpRef.current = selected
        rerender()
        return
      }
      const hitId = hitTestAnnotations(history.present, point, canvasTolerance(8), ctx)
      setSelectedId(hitId)
      if (hitId) {
        const hit = history.present.find((op) => op.id === hitId)
        if (hit) {
          gestureRef.current = { kind: 'move', id: hitId, start: point, original: hit }
          previewOpRef.current = hit
        }
      }
      rerender()
      return
    }

    const op = drawingOp(tool, point, toolStyles)
    gestureRef.current = { kind: 'draw', op }
    previewOpRef.current = op
    rerender()
  }, [busy, canvasTolerance, commitText, history.present, loaded, openTextDraft, rerender, selectedId, tool, toolStyles, toCanvasPoint])

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const gesture = gestureRef.current
    if (!gesture) return
    const point = toCanvasPoint(event)
    if (gesture.kind === 'draw') {
      const op = gesture.op
      if (op.kind === 'pen') op.points.push(point)
      else if (op.kind === 'arrow' || op.kind === 'rect') op.to = point
      previewOpRef.current = op
    } else if (gesture.kind === 'move') {
      previewOpRef.current = translateAnnotation(
        gesture.original,
        point.x - gesture.start.x,
        point.y - gesture.start.y
      )
    } else {
      previewOpRef.current = resizeAnnotation(gesture.original, gesture.handle, point)
    }
    rerender()
  }, [rerender, toCanvasPoint])

  const commitGesture = useCallback(() => {
    const gesture = gestureRef.current
    const preview = previewOpRef.current
    gestureRef.current = null
    previewOpRef.current = null
    if (!gesture || !preview) {
      rerender()
      return
    }
    if (gesture.kind === 'draw') {
      if ((preview.kind === 'arrow' || preview.kind === 'rect') && Math.hypot(preview.to.x - preview.from.x, preview.to.y - preview.from.y) < 4) {
        rerender()
        return
      }
      commitOps([...history.present, preview])
      setSelectedId(preview.id)
    } else if (preview !== gesture.original) {
      commitOps(replaceAnnotation(history.present, preview))
    }
    rerender()
  }, [commitOps, history.present, rerender])

  const onDoubleClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    if (tool !== 'select' || busy) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const point = {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height)
    }
    const id = hitTestAnnotations(history.present, point, canvasTolerance(8), canvas.getContext('2d'))
    const op = history.present.find((candidate) => candidate.id === id)
    if (op?.kind === 'text') {
      setSelectedId(op.id)
      startEditingText(op)
    }
  }, [busy, canvasTolerance, history.present, startEditingText, tool])

  const onStyleChange = useCallback((patch: AnnotationStylePatch) => {
    if (selectedOp) {
      commitOps(replaceAnnotation(history.present, patchAnnotationStyle(selectedOp, patch)))
      return
    }
    if (styleTarget) setToolStyles((current) => patchToolStyle(current, styleTarget, patch))
  }, [commitOps, history.present, selectedOp, styleTarget])

  const undo = useCallback(() => {
    setHistory((current) => undoAnnotationHistory(current))
    setSelectedId(null)
  }, [])

  const clearAll = useCallback(() => {
    setHistory((current) => clearAnnotationHistory(current))
    setSelectedId(null)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !textDraftRef.current) {
        event.preventDefault()
        undo()
        return
      }
      if (event.key === 'Escape') {
        if (textDraftRef.current) cancelTextDraft()
        else if (selectedId) setSelectedId(null)
        else if (!busy) onCancel()
        return
      }
      if (!selectedOp || textDraftRef.current) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        commitOps(history.present.filter((op) => op.id !== selectedOp.id))
        setSelectedId(null)
      } else if (event.key === 'Enter' && selectedOp.kind === 'text') {
        event.preventDefault()
        startEditingText(selectedOp)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, cancelTextDraft, commitOps, history.present, onCancel, selectedId, selectedOp, startEditingText, undo])

  const pendingTextOp = useMemo(() => {
    if (!textDraft) return null
    const existing = editingTextId
      ? ops.find((op): op is Extract<AnnotationOp, { kind: 'text' }> => op.id === editingTextId && op.kind === 'text')
      : null
    const style = existing ?? toolStyles.text
    return createImageAnnotationTextOp(textDraft, textValue, style.color, style.fontSize, {
      id: existing?.id,
      opacity: style.opacity,
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight
    })
  }, [editingTextId, ops, textDraft, textValue, toolStyles.text])

  const apply = useCallback(() => {
    const canvas = canvasRef.current
    const img = imageRef.current
    if (!canvas || !img || !loaded || busy) return
    let appliedOps = history.present
    if (pendingTextOp) {
      appliedOps = editingTextId
        ? replaceAnnotation(appliedOps, pendingTextOp)
        : [...appliedOps, pendingTextOp]
    }
    const ctx = canvas.getContext('2d')
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      for (const op of appliedOps) paintAnnotation(ctx, op)
    }
    onApply({
      dataBase64: canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''),
      mimeType: 'image/png',
      textNotes: imageAnnotationTextNotes(appliedOps),
      instruction: instruction.trim()
    })
  }, [busy, editingTextId, history.present, instruction, loaded, onApply, pendingTextOp])

  const canApply = ops.length > 0 || Boolean(previewOpRef.current) || Boolean(pendingTextOp) || instruction.trim().length > 0
  const activeTextStyle = editingTextId && selectedOp?.kind === 'text' ? selectedOp : toolStyles.text

  return (
    <div className={IMAGE_ANNOTATION_ROOT_CLASS}>
      <div className={IMAGE_ANNOTATION_TOP_BAR_CLASS} style={{ paddingLeft: 'calc(var(--ds-window-controls-safe-inset) + 1.25rem)' }}>
        <div className="flex min-w-0 items-center gap-2">
          <Pencil className="h-4 w-4 shrink-0 text-white/80" strokeWidth={1.9} />
          <span className="min-w-0 truncate text-[13px] font-semibold">{title ? `标注修改 · ${title}` : '标注修改'}</span>
        </div>
        <button type="button" onClick={() => !busy && onCancel()} className="flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white" title="关闭" aria-label="关闭">
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-6 pb-2">
        {loadError ? <div className="rounded-2xl bg-white/10 px-5 py-4 text-[13px] text-white/85">{loadError}</div> : !loaded ? (
          <div className="flex items-center gap-2 text-[13px] text-white/75"><Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} /> 正在加载图片…</div>
        ) : null}

        <div className="ds-no-drag relative inline-block leading-none" style={{ display: loaded && !loadError ? 'inline-block' : 'none' }}>
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={commitGesture}
            onPointerCancel={commitGesture}
            onDoubleClick={onDoubleClick}
            className="block max-h-[calc(100vh-220px)] max-w-[min(1100px,calc(100vw-180px))] rounded-lg shadow-[0_30px_90px_rgba(0,0,0,0.55)] min-[900px]:max-w-[min(1100px,calc(100vw-390px))]"
            style={{ touchAction: 'none', cursor: selectedCursor(gestureRef.current, tool) }}
          />
          {textDraft ? (
            <textarea
              ref={textInputRef}
              value={textValue}
              rows={1}
              wrap="off"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              onChange={(event) => {
                textValueRef.current = event.target.value
                setTextValue(event.target.value)
                resizeImageAnnotationTextEditor(event.currentTarget, textDraft)
              }}
              onCompositionStart={() => { textCompositionRef.current = true }}
              onCompositionEnd={(event) => {
                textCompositionRef.current = false
                textValueRef.current = event.currentTarget.value
                setTextValue(event.currentTarget.value)
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onBlur={commitText}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Escape' && !event.nativeEvent.isComposing && !textCompositionRef.current) {
                  event.preventDefault()
                  cancelTextDraft()
                } else if (shouldCommitImageAnnotationTextKey(event.key, event.nativeEvent.isComposing, textCompositionRef.current, event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  commitText()
                }
              }}
              placeholder="输入文字"
              className="ds-no-drag absolute z-10 block resize-none overflow-hidden border-0 bg-transparent p-0 outline-none placeholder:text-current/35"
              style={{
                left: textDraft.cssX,
                top: textDraft.cssY,
                maxWidth: textDraft.maxCssWidth,
                minHeight: textDraft.cssLineHeight,
                fontFamily: ANNOTATION_FONT_STACKS[activeTextStyle.fontFamily],
                fontWeight: activeTextStyle.fontWeight,
                fontSize: textDraft.cssFontSize,
                lineHeight: `${textDraft.cssLineHeight}px`,
                color: activeTextStyle.color,
                opacity: activeTextStyle.opacity,
                textShadow: activeTextStyle.color === '#ffffff' ? '0 0 2px rgba(0,0,0,0.65)' : '0 0 2px rgba(255,255,255,0.95)'
              }}
            />
          ) : null}
        </div>

        <div className="absolute right-20 top-1/2 hidden -translate-y-1/2 min-[900px]:block">
          <ImageAnnotationStylePanel target={styleTarget} style={displayedStyle} selected={Boolean(selectedOp)} disabled={busy} onChange={onStyleChange} />
        </div>
        {stylePanelOpen ? (
          <div className="absolute right-16 top-1/2 z-20 -translate-y-1/2 min-[900px]:hidden">
            <ImageAnnotationStylePanel target={styleTarget} style={displayedStyle} selected={Boolean(selectedOp)} disabled={busy} onChange={onStyleChange} />
          </div>
        ) : null}

        <div className="absolute right-6 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2 rounded-2xl border border-white/15 bg-white/10 p-2 backdrop-blur-xl">
          {TOOLS.map(({ tool: nextTool, label, Icon }) => (
            <button key={nextTool} type="button" onClick={() => { setTool(nextTool); if (nextTool !== 'select') setSelectedId(null) }} title={label} aria-label={label} aria-pressed={tool === nextTool} className={`flex h-9 w-9 items-center justify-center rounded-xl transition ${tool === nextTool ? 'bg-white text-black' : 'text-white/85 hover:bg-white/15'}`}>
              <Icon className="h-4 w-4" strokeWidth={1.9} />
            </button>
          ))}
          <div className="my-1 h-px w-6 bg-white/20" />
          <button type="button" onClick={() => setStylePanelOpen((open) => !open)} title="样式" aria-label="样式" aria-expanded={stylePanelOpen} className="flex h-9 w-9 items-center justify-center rounded-xl text-white/85 transition hover:bg-white/15 min-[900px]:hidden">
            <SlidersHorizontal className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <button type="button" onClick={undo} disabled={history.past.length === 0} title="撤销" aria-label="撤销" className="flex h-9 w-9 items-center justify-center rounded-xl text-white/85 transition hover:bg-white/15 disabled:opacity-35 disabled:hover:bg-transparent">
            <Undo2 className="h-4 w-4" strokeWidth={1.9} />
          </button>
          <button type="button" onClick={clearAll} disabled={ops.length === 0} title="清空" aria-label="清空" className="flex h-9 w-9 items-center justify-center rounded-xl text-white/85 transition hover:bg-white/15 disabled:opacity-35 disabled:hover:bg-transparent">
            <Trash2 className="h-4 w-4" strokeWidth={1.9} />
          </button>
        </div>
      </div>

      <div className="relative z-10 flex shrink-0 flex-col items-center gap-2.5 px-6 pb-5 pt-1">
        <input value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="补充说明（可选）：例如 把音符改成闪电" disabled={busy} className={IMAGE_ANNOTATION_INSTRUCTION_INPUT_CLASS} />
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => !busy && onCancel()} disabled={busy} className="rounded-full border border-white/25 px-5 py-2 text-[13px] font-semibold text-white/90 transition hover:bg-white/10 disabled:opacity-50">取消</button>
          <button type="button" onClick={apply} disabled={busy || !loaded || !canApply} title={!canApply ? '先在图片上画出要修改的地方，或填写补充说明' : '应用修改'} className="flex items-center gap-2 rounded-full bg-white px-5 py-2 text-[13px] font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.2} /> : <Check className="h-4 w-4" strokeWidth={2.4} />}
            应用
          </button>
        </div>
      </div>
    </div>
  )
}
