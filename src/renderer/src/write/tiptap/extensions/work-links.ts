/**
 * Link interactions for the Work editor (implementation §7.6/§7.7):
 *
 * - Plain click on a link opens an editing bubble (text, address input,
 *   open, copy, unlink); Cmd/Ctrl+click or middle click opens the target
 *   directly. `Mod-K` opens the bubble for the selection.
 * - `[text](url)` typed into a paragraph becomes a link mark.
 * - Cmd/Ctrl+click on a `wikiLink` atom resolves and opens the file;
 *   hovering a `footnoteReference` looks the `[^id]:` definition up in the
 *   document's raw blocks and shows it as a tooltip.
 */
import { Extension, markInputRule } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Editor } from '@tiptap/core'
import type { Node as PmNode } from '@tiptap/pm/model'
import {
  resolveWorkLinkTarget,
  resolveWikiLinkFilePath,
  workHeadingSlug
} from '../../work-link'

export type WorkLinkNavigation = {
  getFilePath: () => string
  getWorkspaceRoot: () => string
  openFile: (path: string, heading?: string) => void
  openExternal?: (url: string) => void
}

const LINK_INPUT_RE = /\[([^\]\n]+)\]\(([^)\s]+)\)$/

function openTarget(editor: Editor, nav: WorkLinkNavigation, href: string): void {
  const target = resolveWorkLinkTarget(href, nav.getFilePath(), nav.getWorkspaceRoot())
  switch (target.kind) {
    case 'external':
      ;(nav.openExternal ?? ((url: string) => {
        void window.kunGui?.openExternal?.(url)?.catch(() => undefined)
      }))(target.url)
      return
    case 'anchor': {
      const slug = target.slug
      let pos = -1
      editor.state.doc.descendants((node, position) => {
        if (pos >= 0) return false
        if (node.type.name === 'heading') {
          if (workHeadingSlug(node.textContent) === slug) pos = position
          return false
        }
        return true
      })
      if (pos >= 0) {
        editor.chain().focus().setTextSelection(pos + 1).scrollIntoView().run()
      }
      return
    }
    case 'workspace-file':
      nav.openFile(target.path, target.slug)
      return
    default:
      return
  }
}

function linkAt(editor: Editor, pos: number): { href: string; from: number; to: number } | null {
  const $pos = editor.state.doc.resolve(pos)
  const linkMark = editor.schema.marks.link
  if (!linkMark) return null
  const mark = $pos.marks().find((m) => m.type === linkMark)
    ?? $pos.parent.childAfter($pos.parentOffset)?.node?.marks.find((m) => m.type === linkMark)
  if (!mark) return null
  // Extend to the mark's full range.
  let from = pos
  let to = pos
  editor.state.doc.nodesBetween(Math.max(0, pos - 1), Math.min(editor.state.doc.content.size, pos + 1), (node, p) => {
    if (node.isText && node.marks.some((m) => m.eq(mark))) {
      from = p
      to = p + node.nodeSize
    }
  })
  return { href: String(mark.attrs.href ?? ''), from, to }
}

function openLinkBubble(editor: Editor, nav: WorkLinkNavigation, anchor: { href: string; from: number; to: number } | null): void {
  const host = editor.view.dom.parentElement
  if (!host) return
  const overlay = document.createElement('div')
  overlay.className = 'write-link-overlay'
  const box = document.createElement('div')
  box.className = 'write-link-bubble'
  const input = document.createElement('input')
  input.className = 'write-link-input'
  input.spellcheck = false
  input.placeholder = 'https://'
  input.value = anchor?.href ?? ''
  const openButton = document.createElement('button')
  openButton.type = 'button'
  openButton.className = 'write-link-button'
  openButton.textContent = 'open'
  const copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.className = 'write-link-button'
  copyButton.textContent = 'copy'
  const unlinkButton = document.createElement('button')
  unlinkButton.type = 'button'
  unlinkButton.className = 'write-link-button'
  unlinkButton.textContent = 'unlink'
  box.append(input, openButton, copyButton, unlinkButton)
  overlay.appendChild(box)
  host.appendChild(overlay)

  const anchorPos = anchor?.from ?? editor.state.selection.from
  try {
    const coords = editor.view.coordsAtPos(Math.min(anchorPos, editor.state.doc.content.size))
    const hostRect = host.getBoundingClientRect()
    box.style.left = `${Math.max(0, coords.left - hostRect.left)}px`
    box.style.top = `${coords.bottom - hostRect.top + 4}px`
  } catch {
    // Keep default position.
  }

  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    overlay.remove()
  }
  const applyHref = (): void => {
    const href = input.value.trim()
    if (!href) return
    // Editing a reference-style link (`[text][id]`) through the bubble must
    // produce a plain inline link — otherwise the kept identifier would
    // serialize back to `[text][id]` while the definition no longer matches
    // the new address.
    const attrs = { href, identifier: null, label: null, reference: null }
    const chain = editor.chain().focus()
    if (anchor) {
      chain.setTextSelection({ from: anchor.from, to: anchor.to }).extendMarkRange('link').setLink(attrs).run()
    } else if (!editor.state.selection.empty) {
      chain.extendMarkRange('link').setLink(attrs).run()
    }
    close()
  }

  openButton.addEventListener('click', () => {
    const href = input.value.trim()
    close()
    if (href) openTarget(editor, nav, href)
  })
  copyButton.addEventListener('click', () => {
    void navigator.clipboard?.writeText(input.value).catch(() => undefined)
    copyButton.textContent = 'copied'
    setTimeout(() => { copyButton.textContent = 'copy' }, 1200)
  })
  unlinkButton.addEventListener('click', () => {
    if (anchor) {
      editor.chain().focus().setTextSelection({ from: anchor.from, to: anchor.to }).extendMarkRange('link').unsetLink().run()
    } else {
      editor.chain().focus().unsetLink().run()
    }
    close()
  })
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      applyHref()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close()
      editor.commands.focus()
    }
  })
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) {
      event.preventDefault()
      applyHref()
    }
  })
  input.focus()
  input.select()
}

function footnoteDefinitionFor(editor: Editor, identifier: string): string | null {
  const needle = `[^${identifier}]:`
  let found: string | null = null
  editor.state.doc.descendants((node) => {
    if (found !== null) return false
    if (node.type.name === 'rawMarkdownBlock') {
      const raw = String(node.attrs.raw ?? '')
      const index = raw.indexOf(needle)
      if (index >= 0) {
        found = raw.slice(index + needle.length).split('\n')[0]?.trim() || null
      }
      return false
    }
    return true
  })
  return found
}

export const WriteWorkLinks = Extension.create<{ navigation?: WorkLinkNavigation }>({
  name: 'writeWorkLinks',

  addOptions() {
    return { navigation: undefined }
  },

  addInputRules() {
    const linkMark = this.editor.schema.marks.link
    return [
      markInputRule({
        find: LINK_INPUT_RE,
        type: linkMark,
        getAttributes: (match) => ({ href: match[2] })
      })
    ]
  },

  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        const navigation = this.options.navigation
        if (!navigation) return false
        const { from } = this.editor.state.selection
        openLinkBubble(this.editor, navigation, linkAt(this.editor, from))
        return true
      }
    }
  },

  addProseMirrorPlugins() {
    const navigation = this.options.navigation
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('writeWorkLinks'),
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              if (!(event instanceof MouseEvent)) return false
              const button = event.button
              const modified = event.metaKey || event.ctrlKey || button === 1
              if (!modified) return false
              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
              if (pos === undefined) return false
              const $pos = view.state.doc.resolve(pos)
              const node = $pos.nodeAfter ?? $pos.nodeBefore
              if (node?.type.name === 'wikiLink') {
                event.preventDefault()
                if (navigation) {
                  const resolved = resolveWikiLinkFilePath(
                    String(node.attrs.target ?? ''),
                    navigation.getFilePath(),
                    navigation.getWorkspaceRoot()
                  )
                  if (resolved) navigation.openFile(resolved.path, node.attrs.heading ?? undefined)
                }
                return true
              }
              const link = linkAt(editor, pos)
              if (link) {
                event.preventDefault()
                if (navigation) openTarget(editor, navigation, link.href)
                return true
              }
              return false
            },
            click(view, event) {
              if (!(event instanceof MouseEvent) || event.button !== 0) return false
              if (event.metaKey || event.ctrlKey) return false
              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
              if (pos === undefined) return false
              const link = linkAt(editor, pos)
              if (!link || !navigation) return false
              event.preventDefault()
              openLinkBubble(editor, navigation, link)
              return true
            },
            mouseover(view, event) {
              const target = event.target as HTMLElement | null
              const ref = target?.closest?.('.work-footnote-ref')
              if (!ref) return false
              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos
              if (pos === undefined) return false
              const $pos = view.state.doc.resolve(pos)
              const node: PmNode | null = $pos.nodeAfter ?? $pos.nodeBefore
              if (node?.type.name !== 'footnoteReference') return false
              const definition = footnoteDefinitionFor(editor, String(node.attrs.identifier ?? ''))
              if (definition) (ref as HTMLElement).title = definition
              return false
            }
          }
        }
      })
    ]
  }
})
