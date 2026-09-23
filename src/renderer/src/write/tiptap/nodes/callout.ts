/**
 * `callout` — rich node for `> [!type] title` Obsidian/GitHub alerts
 * (implementation §7.3). Header shows a type icon button (cycles through
 * the Work callout table) and an editable title; the body is normal block
 * content. Serialization emits the blockquote marker form back.
 */
import { Node as TiptapNode, mergeAttributes } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/core'
import { WORK_CALLOUT_TYPES, resolveWorkCalloutType } from '@shared/markdown/work-profile'

const TYPE_ORDER = ['note', 'tip', 'important', 'warning', 'caution']

function iconFor(type: string): string {
  const canonical = resolveWorkCalloutType(type)
  switch (WORK_CALLOUT_TYPES[canonical]?.icon ?? 'note') {
    case 'tip': return '💡'
    case 'important': return '❗'
    case 'warning': return '⚠️'
    case 'caution': return '⛔'
    case 'success': return '✅'
    case 'question': return '❓'
    case 'failure': return '❌'
    case 'danger': return '🔥'
    case 'bug': return '🐞'
    case 'example': return '📋'
    case 'quote': return '💬'
    case 'abstract': return '📄'
    case 'todo': return '☑️'
    case 'info': return 'ℹ️'
    default: return '📝'
  }
}

function createCalloutNodeView(node: PmNode, editor: Editor, getPos: () => number | undefined): NodeView {
  const dom = document.createElement('div')
  dom.className = 'write-callout'

  const header = document.createElement('div')
  header.className = 'write-callout-header'
  header.contentEditable = 'false'

  const iconButton = document.createElement('button')
  iconButton.type = 'button'
  iconButton.className = 'write-callout-icon'
  iconButton.title = 'callout type'

  const title = document.createElement('input')
  title.className = 'write-callout-title'
  title.placeholder = 'Callout'
  title.spellcheck = false

  const body = document.createElement('div')
  body.className = 'write-callout-body'

  header.append(iconButton, title)
  dom.append(header, body)

  const applyType = (typeRaw: string): void => {
    const canonical = resolveWorkCalloutType(typeRaw)
    dom.dataset.calloutType = canonical
    dom.dataset.calloutTone = WORK_CALLOUT_TYPES[canonical]?.tone ?? 'blue'
    iconButton.textContent = iconFor(typeRaw)
    iconButton.title = `callout: ${typeRaw}`
    title.value = ''
    title.placeholder = typeRaw
  }
  applyType(String(node.attrs.calloutTypeRaw ?? node.attrs.calloutType ?? 'note'))
  title.value = String(node.attrs.title ?? '')

  iconButton.addEventListener('click', (event) => {
    event.preventDefault()
    const pos = getPos()
    if (pos === undefined || !editor.isEditable) return
    const current = resolveWorkCalloutType(String(node.attrs.calloutType ?? 'note'))
    const next = TYPE_ORDER[(TYPE_ORDER.indexOf(current) + 1) % TYPE_ORDER.length]
    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(pos, 'calloutType', next).setNodeAttribute(pos, 'calloutTypeRaw', next)
    )
  })

  title.addEventListener('input', () => {
    const pos = getPos()
    if (pos === undefined) return
    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(pos, 'title', title.value || null).setMeta('addToHistory', true)
    )
  })
  title.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      editor.commands.focus()
    }
  })

  return {
    dom,
    contentDOM: body,
    update: (updated) => {
      if (updated.type.name !== node.type.name) return false
      applyType(String(updated.attrs.calloutTypeRaw ?? updated.attrs.calloutType ?? 'note'))
      if (document.activeElement !== title) {
        title.value = String(updated.attrs.title ?? '')
      }
      return true
    },
    ignoreMutation: (mutation) => !body.contains(mutation.target),
    stopEvent: (event) => event.target instanceof globalThis.Node && header.contains(event.target)
  }
}

export const Callout = TiptapNode.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      calloutType: { default: 'note' },
      calloutTypeRaw: { default: 'note' },
      title: { default: null }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-callout-type]',
        getAttrs: (el) => ({
          calloutType: el.getAttribute('data-callout-type') ?? 'note',
          calloutTypeRaw: el.getAttribute('data-callout-type-raw') ?? el.getAttribute('data-callout-type') ?? 'note',
          title: el.getAttribute('data-callout-title')
        })
      }
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-callout-type': String(node.attrs.calloutType ?? 'note'),
      'data-callout-type-raw': String(node.attrs.calloutTypeRaw ?? node.attrs.calloutType ?? 'note'),
      'data-callout-title': node.attrs.title ?? null,
      class: 'write-callout'
    }), 0]
  },

  addNodeView() {
    return ({ node, editor, getPos }) =>
      createCalloutNodeView(node, editor, getPos as () => number | undefined)
  }
})
