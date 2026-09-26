/**
 * Math editing (implementation §7.1):
 *
 * - Clicking a `blockMath`/`inlineMath` node opens a floating editor:
 *   textarea + live KaTeX preview (`throwOnError:false`, errors shown
 *   greyed). Cmd/Ctrl+Enter or blur saves via `update*Math`, Esc cancels.
 * - `$$` + Enter in an empty paragraph inserts an empty block math and
 *   opens the editor; a closing `$` typed in a paragraph converts
 *   `$…$` to inline math when the Pandoc spacing rules hold (the char
 *   before the opening `$` is not `\`, and math never starts inside
 *   code).
 */
import { Extension, InputRule } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import { bodyZoom, toLayoutPx } from '../../lib/body-zoom'

type MathKind = 'block' | 'inline'

function renderKatexPreview(preview: HTMLElement, latex: string, displayMode: boolean): void {
  void import('katex').then((katex) => {
    if (!preview.isConnected) return
    try {
      ;(katex.default ?? katex).render(latex, preview, {
        throwOnError: false,
        displayMode
      })
      preview.classList.remove('is-error')
    } catch (error) {
      preview.textContent = error instanceof Error ? error.message : String(error)
      preview.classList.add('is-error')
    }
  }).catch(() => undefined)
}

// The math extensions' `onClick` option only receives (node, pos); the
// editor reference is stashed when the extension instance is created.
let mathEditorRef: Editor | null = null

export function mathEditorFor(node: PmNode, pos: number, kind: MathKind): void {
  if (mathEditorRef) openMathEditor(mathEditorRef, node, pos, kind)
}

export function openMathEditor(editor: Editor, node: PmNode, pos: number, kind: MathKind): void {
  const host = editor.view.dom.parentElement
  if (!host || !editor.isEditable) return

  const overlay = document.createElement('div')
  overlay.className = 'write-math-overlay'
  const box = document.createElement('div')
  box.className = 'write-math-editor'
  const textarea = document.createElement('textarea')
  textarea.className = 'write-math-input'
  textarea.spellcheck = false
  textarea.value = String(node.attrs.latex ?? '')
  textarea.rows = kind === 'block' ? 4 : 1
  const preview = document.createElement('div')
  preview.className = 'write-math-preview'
  box.append(textarea, preview)
  overlay.appendChild(box)
  host.appendChild(overlay)

  try {
    const coords = editor.view.coordsAtPos(Math.min(pos, editor.state.doc.content.size))
    const hostRect = host.getBoundingClientRect()
    const zoom = bodyZoom()
    box.style.left = `${Math.max(0, toLayoutPx(coords.left - hostRect.left, zoom))}px`
    box.style.top = `${toLayoutPx(coords.bottom - hostRect.top, zoom) + 4}px`
  } catch {
    // Keep default position.
  }

  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    overlay.remove()
  }
  const save = (): void => {
    const latex = textarea.value
    const commands = editor.commands as unknown as Record<string, ((p: number, attrs: { latex: string }) => void) | undefined>
    commands[kind === 'block' ? 'updateBlockMath' : 'updateInlineMath']?.(pos, { latex })
    close()
  }

  renderKatexPreview(preview, textarea.value, kind === 'block')
  textarea.addEventListener('input', () => {
    renderKatexPreview(preview, textarea.value, kind === 'block')
  })
  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      save()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
      editor.commands.focus()
    }
  })
  textarea.addEventListener('blur', () => {
    // Blur fires when clicking inside the preview box is impossible, so any
    // blur means the editor lost focus — save like the plan specifies.
    save()
  })
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) {
      event.preventDefault()
      save()
    }
  })
  textarea.focus()
  textarea.select()
}

/**
 * Pandoc `$…$` check on text typed into a paragraph: the match ends with
 * the just-typed closing `$`; the opening `$` must not be `\`-escaped and
 * must be followed by a non-space, and the char before the closing `$`
 * must be non-space.
 */
const INLINE_MATH_INPUT_RE = /(^|[^\\$])\$([^\s](?:[^$\\]|\\[\s\S])*?[^\s])\$$/

export const WriteMathInput = Extension.create({
  name: 'writeMathInput',

  onCreate() {
    mathEditorRef = this.editor
  },

  onDestroy() {
    if (mathEditorRef === this.editor) mathEditorRef = null
  },

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { $from } = this.editor.state.selection
        if ($from.parent.type.name !== 'paragraph' || $from.parent.textContent !== '$$') {
          return false
        }
        const from = $from.before()
        const to = $from.after()
        const tr = this.editor.state.tr.replaceWith(from, to, [
          this.editor.schema.nodes.blockMath.create({ latex: '' }),
          this.editor.schema.nodes.paragraph.create()
        ])
        tr.setSelection(TextSelection.create(tr.doc, Math.min(from + 2, tr.doc.content.size)))
        this.editor.view.dispatch(tr.scrollIntoView())
        const mathNode = tr.doc.nodeAt(from)
        if (mathNode) openMathEditor(this.editor, mathNode, from, 'block')
        return true
      }
    }
  },

  addInputRules() {
    const inlineMathType = this.editor.schema.nodes.inlineMath
    return [
      new InputRule({
        find: INLINE_MATH_INPUT_RE,
        handler: ({ state, range, match }) => {
          if (!inlineMathType) return
          const latex = match[2]
          if (latex === undefined) return
          // `$x$` is 2 chars wider than latex; match[1] is the prefix char.
          const mathStart = range.from + match[1].length
          const mathEnd = range.to
          state.tr.replaceWith(
            mathStart,
            mathEnd,
            inlineMathType.create({ latex })
          )
        }
      })
    ]
  }
})
