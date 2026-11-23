/**
 * Math editing:
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
import { Plugin, TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import i18n from '../../i18n'
import { annotateWorkSelection } from '../annotations/selection-target'
import { bodyZoom, toLayoutPx } from '../../lib/body-zoom'

type MathKind = 'block' | 'inline'

/** Keep ProseMirror's mouseup selection/focus from scrolling an atom away
 * before its native click can open the math editor. Scrollbars remain native. */
export function preserveMathPointerTarget(
  event: MouseEvent,
  editorRoot: HTMLElement,
  editable: boolean
): boolean {
  if (!editable || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey) return false
  const target = event.target
  if (!(target instanceof Element)) return false
  const glyph = target.closest('.katex-html, .katex-error')
  const atom = glyph?.closest('[data-type="inline-math"], [data-type="block-math"]')
  if (!atom || !editorRoot.contains(atom)) return false
  event.preventDefault()
  return true
}

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
const mathEditors = new Set<Editor>()

export function mathEditorFor(node: PmNode, pos: number, kind: MathKind): void {
  const owner = [...mathEditors].find((editor) =>
    !editor.isDestroyed && pos <= editor.state.doc.content.size && editor.state.doc.nodeAt(pos) === node)
  if (owner) openMathEditor(owner, node, pos, kind)
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
    if (closed) return
    const latex = textarea.value
    if (kind === 'block') editor.commands.updateBlockMath({ pos, latex })
    else editor.commands.updateInlineMath({ pos, latex })
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
  const pane = host.closest<HTMLElement>('[data-work-annotation-file]')
  const file = pane?.dataset.workAnnotationFile, workspace = pane?.dataset.workAnnotationRoot
  if (workspace && file) {
    const annotate = document.createElement('button')
    annotate.type = 'button'
    annotate.className = 'write-review-button self-start'
    annotate.textContent = i18n.t('common:writePaperReaderComment')
    annotate.addEventListener('mousedown', (event) => event.preventDefault())
    annotate.addEventListener('click', () => {
      const { selectionStart: from, selectionEnd: to, value } = textarea
      const part = to > from && to - from < value.length ? { from, to } : undefined
      const text = part ? value.slice(from, to) : value
      if (!text.trim()) return
      if (value === node.attrs.latex) close()
      else save()
      window.requestAnimationFrame(() => {
        if (editor.isDestroyed || !host.isConnected || editor.state.doc.nodeAt(pos)?.attrs.latex !== value) return
        const dom = editor.view.nodeDOM(pos)
        const rect = dom instanceof Element ? dom.getBoundingClientRect() : undefined
        annotateWorkSelection(workspace, file, {
          text, charCount: text.length, ranges: [], anchorRect: rect,
          richRange: { from: pos, to: pos + node.nodeSize, ...(part ? { latexRange: part } : {}) }
        })
      })
    })
    box.append(annotate)
  }
  box.addEventListener('focusout', (event) => {
    if (!(event.relatedTarget instanceof Node) || !box.contains(event.relatedTarget)) save()
  })
  textarea.addEventListener('blur', (event) => {
    if (!(event.relatedTarget instanceof Node) || !box.contains(event.relatedTarget)) save()
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

  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleDOMEvents: {
          mousedown: (view, event) => preserveMathPointerTarget(event, view.dom, this.editor.isEditable)
        }
      }
    })]
  },

  onCreate() {
    mathEditors.add(this.editor)
  },

  onDestroy() {
    mathEditors.delete(this.editor)
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
