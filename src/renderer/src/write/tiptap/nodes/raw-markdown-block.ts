/**
 * `rawMarkdownBlock` — atom block for constructs the rich schema cannot
 * represent (implementation §5). Stores the verbatim Markdown source in
 * `raw`, shows a sanitized preview plus a `source` badge, and opens a small
 * CodeMirror editor on click:
 *   - Cmd/Ctrl+Enter saves and reparses the fragment — recognizable
 *     constructs become normal nodes, otherwise the raw stays.
 *   - Esc cancels.
 */
import { Node as TiptapNode, mergeAttributes } from '@tiptap/core'
import { Slice, Fragment } from '@tiptap/pm/model'
import { TextSelection } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { markdown } from '@codemirror/lang-markdown'
import { parseWorkDocument } from '../../markdown/document-codec'
import { loadWriteMarkdownImage } from '../../markdown-image'

export type RawMarkdownReason = string

export type RawMarkdownBlockOptions = {
  /** Current file path — relative images inside previews resolve via IPC. */
  getFilePath: () => string
}

/** A rendered preview whose visible payload is empty (HTML comments,
 * link/footnote definitions, bare closing tags) must not collapse to a
 * zero-height ghost — fall back to the faded monospace source. */
function hasVisiblePayload(root: HTMLElement): boolean {
  if (root.textContent?.trim()) return true
  return Boolean(root.querySelector('img,video,svg,table,math,iframe,hr,input,object'))
}

function resolvePreviewImages(root: HTMLElement, filePath: string): void {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (!src || src.startsWith('data:')) continue
    void loadWriteMarkdownImage(src, filePath).then((result) => {
      if (img.isConnected && result.ok) img.src = result.src
    })
  }
}

function renderPreview(dom: HTMLElement, raw: string, getFilePath: () => string): void {
  dom.textContent = ''
  const preview = document.createElement('div')
  preview.className = 'write-raw-preview'
  // Lazy: rendering + sanitizing only happens in the browser.
  void Promise.all([
    import('@shared/markdown/render-html'),
    import('dompurify')
  ])
    .then(([renderer, purify]) => {
      if (!preview.isConnected) return
      const html = renderer.renderWorkMarkdownToHtml(raw, { math: 'html' })
      preview.innerHTML = (purify.default ?? purify).sanitize(html)
      if (!hasVisiblePayload(preview)) {
        preview.classList.add('write-raw-preview-plain')
        preview.textContent = raw
        return
      }
      resolvePreviewImages(preview, getFilePath())
    })
    .catch(() => {
      preview.classList.add('write-raw-preview-plain')
      preview.textContent = raw
    })
  dom.appendChild(preview)
}

type RawViewParts = {
  dom: HTMLElement
  badge: HTMLElement
  previewHost: HTMLElement
}

function buildDom(reason: string): RawViewParts {
  const dom = document.createElement('div')
  dom.className = 'write-raw-block'
  dom.dataset.rawMarkdown = ''
  const badge = document.createElement('span')
  badge.className = 'write-raw-badge'
  badge.textContent = 'source'
  badge.title = reason ? `raw markdown · ${reason}` : 'raw markdown'
  const previewHost = document.createElement('div')
  previewHost.className = 'write-raw-preview-host'
  dom.append(badge, previewHost)
  return { dom, badge, previewHost }
}

function reparseAndReplace(
  editor: Editor,
  getPos: () => number | undefined,
  node: PmNode,
  raw: string
): void {
  const pos = getPos()
  if (pos === undefined) return
  const parsed = parseWorkDocument(raw)
  const content = parsed.doc.content ?? []
  const tr = editor.state.tr
  // Still raw (or unparseable): just update the attribute.
  if (content.length === 1 && content[0].type === 'rawMarkdownBlock') {
    tr.setNodeAttribute(pos, 'raw', raw)
    editor.view.dispatch(tr.scrollIntoView())
    return
  }
  const fragment = Fragment.from(
    content.map((child) => editor.schema.nodeFromJSON(child))
  )
  tr.replace(pos, pos + node.nodeSize, Slice.maxOpen(fragment))
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos, tr.doc.content.size))))
  editor.view.dispatch(tr.scrollIntoView())
}

function createRawNodeView(
  node: PmNode,
  editor: Editor,
  getPos: () => number | undefined,
  getFilePath: () => string
): NodeView {
  const { dom, badge, previewHost } = buildDom(String(node.attrs.reason ?? ''))
  renderPreview(previewHost, String(node.attrs.raw ?? ''), getFilePath)

  let editing = false
  let cm: EditorView | undefined

  const stopEditing = (): void => {
    editing = false
    cm?.destroy()
    cm = undefined
    previewHost.textContent = ''
    renderPreview(previewHost, String(node.attrs.raw ?? ''), getFilePath)
    dom.classList.remove('is-editing')
  }

  const startEditing = (): void => {
    if (editing || !editor.isEditable) return
    editing = true
    dom.classList.add('is-editing')
    previewHost.textContent = ''
    const host = document.createElement('div')
    host.className = 'write-raw-editor'
    previewHost.appendChild(host)
    cm = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: String(node.attrs.raw ?? ''),
        extensions: [
          keymap.of([
            {
              key: 'Mod-Enter',
              run: (view) => {
                const raw = view.state.doc.toString()
                stopEditing()
                reparseAndReplace(editor, getPos, node, raw)
                return true
              }
            },
            {
              key: 'Escape',
              run: () => {
                stopEditing()
                editor.commands.focus()
                return true
              }
            }
          ]),
          markdown(),
          EditorView.lineWrapping
        ]
      })
    })
    cm.focus()
  }

  dom.addEventListener('click', (event) => {
    if (editing) return
    event.preventDefault()
    event.stopPropagation()
    startEditing()
  })

  return {
    dom,
    stopEvent: (event) => editing && event.target instanceof globalThis.Node && dom.contains(event.target),
    ignoreMutation: () => true,
    update: (updated) => {
      if (updated.type.name !== node.type.name) return false
      if (updated.attrs.raw !== node.attrs.raw && !editing) {
        renderPreview(previewHost, String(updated.attrs.raw ?? ''), getFilePath)
      }
      badge.title = `raw markdown · ${String(updated.attrs.reason ?? '')}`
      return true
    },
    selectNode: () => dom.classList.add('is-selected'),
    deselectNode: () => dom.classList.remove('is-selected'),
    destroy: () => cm?.destroy()
  }
}

export const RawMarkdownBlock = TiptapNode.create<RawMarkdownBlockOptions>({
  name: 'rawMarkdownBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return {
      getFilePath: () => ''
    }
  },

  addAttributes() {
    return {
      raw: { default: '' },
      reason: { default: 'unknown' }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-raw-markdown]',
        getAttrs: (el) => ({
          raw: el.getAttribute('data-raw') ?? '',
          reason: el.getAttribute('data-reason') ?? 'unknown'
        })
      }
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-raw-markdown': '',
      'data-raw': String(node.attrs.raw ?? ''),
      'data-reason': String(node.attrs.reason ?? ''),
      class: 'write-raw-block'
    })]
  },

  addNodeView() {
    const getFilePath = () => this.options.getFilePath()
    return ({ node, editor, getPos }) =>
      createRawNodeView(node, editor, getPos as () => number | undefined, getFilePath)
  }
})
