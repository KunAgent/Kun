import { memo, useEffect, useRef } from 'react'
import type { CanvasShape } from '../../../../design/canvas/canvas-types'
import { useCanvasSelectionStore } from '../../../../design/canvas/canvas-selection-store'
import { useCanvasShapeStore } from '../../../../design/canvas/canvas-shape-store'
import { useCanvasUndoStore } from '../../../../design/canvas/canvas-undo-store'
import {
  requestStickyKun,
  STICKY_PALETTE,
  stickyAddressesKun
} from '../../../../design/canvas/canvas-sticky'
import { StickyCard } from './StickyCard'

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
        useCanvasShapeStore.getState().updateShape(shape.id, {
          textContent: newText,
          // Editing a note that was already sent reopens it as a new draft.
          ...(shape.sticky && shape.sticky.status !== 'draft'
            ? { sticky: { color: shape.sticky.color, status: 'draft' as const } }
            : {})
        })
      })
    } else if (cancelled) {
      // restore DOM so the visual matches the original text
      el.innerText = oldText
    }
  }

  const sticky = shape.sticky
  const palette = sticky ? STICKY_PALETTE[sticky.color] : null

  return (
    <>
    {sticky ? <StickyCard shape={shape} sticky={sticky} editing={isEditing} /> : null}
    <foreignObject
      x={0}
      y={0}
      width={shape.width}
      height={sticky ? Math.max(0, shape.height - 34) : shape.height}
    >
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
            const text = e.currentTarget.innerText
            commit(false)
            if (shape.sticky && stickyAddressesKun({ textContent: text, sticky: shape.sticky })) requestStickyKun(shape.id)
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
          color: shape.fontColor ?? palette?.ink ?? '#000000',
          ...(sticky ? { padding: '12px 14px 0', boxSizing: 'border-box' as const } : {}),
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
    </>
  )
}

export const TextShape = memo(TextShapeInner)
