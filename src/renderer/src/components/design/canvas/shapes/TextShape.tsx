import { memo, useEffect, useRef } from 'react'
import type { CanvasShape } from '../../../../design/canvas/canvas-types'
import { useCanvasSelectionStore } from '../../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../../design/canvas/canvas-shape-store'
import { useCanvasUndoStore } from '../../../../design/canvas/canvas-undo-store'

function TextShapeInner({ shape }: { shape: CanvasShape }) {
  const editingId = useCanvasSelectionStore((s) => s.editingId)
  const isEditing = editingId === shape.id
  const editorRef = useRef<HTMLDivElement>(null)
  const startTextRef = useRef<string>('')

  useEffect(() => {
    if (!isEditing) return
    startTextRef.current = shape.textContent ?? ''
    const el = editorRef.current
    if (!el) return
    el.focus()
    // Select all text on entry, like a fresh text-tool place.
    const range = window.document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing])

  const commit = (cancelled: boolean): void => {
    const el = editorRef.current
    if (!el) return
    const newText = cancelled ? startTextRef.current : el.innerText
    const oldText = startTextRef.current
    useCanvasSelectionStore.getState().setEditing(null)
    if (newText !== oldText) {
      useCanvasUndoStore.getState().withGroup('edit-text', () => {
        useCanvasShapeStore.getState().updateShape(shape.id, { textContent: newText })
      })
    } else if (cancelled) {
      // restore DOM so the visual matches the original text
      el.innerText = oldText
    }
  }

  return (
    <foreignObject x={0} y={0} width={shape.width} height={shape.height}>
      <div
        ref={editorRef}
        contentEditable={isEditing}
        suppressContentEditableWarning
        onPointerDown={(e) => {
          if (isEditing) e.stopPropagation()
        }}
        onKeyDown={(e) => {
          if (!isEditing) return
          if (e.key === 'Escape') {
            e.preventDefault()
            commit(true)
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            commit(false)
          }
        }}
        onBlur={() => {
          if (isEditing) commit(false)
        }}
        style={{
          width: '100%',
          height: '100%',
          fontFamily: shape.fontFamily ?? 'Inter, system-ui, sans-serif',
          fontSize: `${shape.fontSize ?? 16}px`,
          fontWeight: shape.fontWeight ?? 400,
          lineHeight: shape.lineHeight ?? 1.5,
          textAlign: shape.textAlign ?? 'left',
          color: shape.fontColor ?? '#000000',
          overflow: 'hidden',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          pointerEvents: isEditing ? 'auto' : 'none',
          userSelect: isEditing ? 'text' : 'none',
          outline: isEditing ? '1px solid #3b82d8' : 'none',
          cursor: isEditing ? 'text' : 'default'
        }}
      >
        {shape.textContent ?? ''}
      </div>
    </foreignObject>
  )
}

export const TextShape = memo(TextShapeInner)
