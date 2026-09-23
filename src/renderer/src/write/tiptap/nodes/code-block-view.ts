/**
 * Code block NodeView (implementation §7.2/§7.3): header bar with a
 * language selector + copy button, `pre > code` as the editable region,
 * and a Mermaid preview below the code for `language === 'mermaid'`.
 * While the selection is outside a mermaid block the source is hidden and
 * only the diagram shows; inside, the source is editable and the diagram
 * refreshes debounced.
 */
import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import type { NodeView } from '@tiptap/pm/view'
import { renderMermaid } from '../../../lib/mermaid-render'

export const CODE_LANGUAGE_OPTIONS = [
  'plaintext', 'bash', 'c', 'cpp', 'csharp', 'css', 'diff', 'go', 'html',
  'ini', 'java', 'javascript', 'json', 'jsonc', 'jsx', 'kotlin', 'lua',
  'markdown', 'mermaid', 'php', 'powershell', 'python', 'ruby', 'rust',
  'scss', 'sql', 'swift', 'toml', 'typescript', 'tsx', 'vue', 'xml', 'yaml'
]

const MERMAID_REFRESH_MS = 300

function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

function buildLanguageSelect(): HTMLSelectElement {
  const select = document.createElement('select')
  select.className = 'write-codeblock-lang'
  select.title = 'language'
  for (const lang of CODE_LANGUAGE_OPTIONS) {
    const option = document.createElement('option')
    option.value = lang === 'plaintext' ? '' : lang
    option.textContent = lang
    select.appendChild(option)
  }
  return select
}

function isSelectionInside(editor: Editor, getPos: () => number | undefined, node: PmNode): boolean {
  const pos = getPos()
  if (pos === undefined) return false
  const { from, to } = editor.state.selection
  return from > pos && to < pos + node.nodeSize
}

export function createCodeBlockNodeView(
  node: PmNode,
  editor: Editor,
  getPos: () => number | undefined
): NodeView {
  const dom = document.createElement('div')
  dom.className = 'write-codeblock'

  const header = document.createElement('div')
  header.className = 'write-codeblock-header'
  header.contentEditable = 'false'

  const select = buildLanguageSelect()
  const copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.className = 'write-codeblock-copy'
  copyButton.textContent = 'copy'

  const pre = document.createElement('pre')
  const code = document.createElement('code')
  pre.appendChild(code)

  const mermaidHost = document.createElement('div')
  mermaidHost.className = 'write-codeblock-mermaid'

  header.append(select, copyButton)
  dom.append(header, pre, mermaidHost)

  let mermaidTimer: ReturnType<typeof setTimeout> | undefined
  let lastMermaidCode: string | null = null
  let lastMermaidError = false

  const isMermaid = (): boolean => String(node.attrs.language ?? '').trim().toLowerCase() === 'mermaid'

  const refreshMermaid = (codeText: string): void => {
    if (!isMermaid()) {
      mermaidHost.textContent = ''
      lastMermaidCode = null
      return
    }
    if (codeText === lastMermaidCode && !lastMermaidError) return
    lastMermaidCode = codeText
    lastMermaidError = false
    void renderMermaid(codeText, currentTheme()).then((result) => {
      if (!mermaidHost.isConnected || codeText !== lastMermaidCode) return
      if (result.ok) {
        mermaidHost.innerHTML = result.svg
        mermaidHost.classList.remove('is-error')
      } else {
        lastMermaidError = true
        mermaidHost.textContent = result.message
        mermaidHost.classList.add('is-error')
      }
    })
  }

  const scheduleMermaid = (): void => {
    if (!isMermaid()) return
    if (mermaidTimer !== undefined) clearTimeout(mermaidTimer)
    mermaidTimer = setTimeout(() => {
      mermaidTimer = undefined
      refreshMermaid(node.textContent)
    }, MERMAID_REFRESH_MS)
  }

  const syncMode = (): void => {
    const mermaid = isMermaid()
    dom.classList.toggle('is-mermaid', mermaid)
    const inside = isSelectionInside(editor, getPos, node)
    dom.classList.toggle('is-editing-code', inside || !mermaid)
    const language = String(node.attrs.language ?? '')
    if (select.value !== language) select.value = language
    if (mermaid) scheduleMermaid()
    else mermaidHost.textContent = ''
  }

  select.addEventListener('change', () => {
    const pos = getPos()
    if (pos === undefined) return
    editor.view.dispatch(
      editor.state.tr.setNodeAttribute(pos, 'language', select.value || null)
    )
  })

  copyButton.addEventListener('click', () => {
    void navigator.clipboard?.writeText(node.textContent).catch(() => undefined)
    copyButton.textContent = 'copied'
    setTimeout(() => { copyButton.textContent = 'copy' }, 1200)
  })

  const onSelectionUpdate = (): void => {
    if (!isMermaid()) return
    dom.classList.toggle('is-editing-code', isSelectionInside(editor, getPos, node))
  }
  editor.on('selectionUpdate', onSelectionUpdate)

  syncMode()

  return {
    dom,
    contentDOM: code,
    update: (updated) => {
      if (updated.type.name !== node.type.name) return false
      node = updated
      syncMode()
      if (isMermaid()) scheduleMermaid()
      return true
    },
    stopEvent: (event) =>
      event.target instanceof globalThis.Node && header.contains(event.target),
    ignoreMutation: (mutation) => !code.contains(mutation.target),
    destroy: () => {
      editor.off('selectionUpdate', onSelectionUpdate)
      if (mermaidTimer !== undefined) clearTimeout(mermaidTimer)
    }
  }
}
