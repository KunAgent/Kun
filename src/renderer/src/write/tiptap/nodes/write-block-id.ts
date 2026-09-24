/**
 * `blockId` global attribute for top-level blocks + a plugin that keeps ids
 * unique. Splitting/copying a block duplicates its attrs, so after every
 * document-changing transaction the second and later occurrences of an id
 * get a fresh one — otherwise two live blocks could claim the same source
 * fragment during serialization.
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'

const TOP_LEVEL_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'codeBlock',
  'bulletList',
  'orderedList',
  'taskList',
  'table',
  'horizontalRule',
  'callout',
  'blockMath',
  'rawMarkdownBlock'
]

let blockIdCounter = 0

export function generateBlockId(): string {
  blockIdCounter += 1
  return `w${blockIdCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

const blockIdPluginKey = new PluginKey('writeBlockId')

function duplicateBlockIds(doc: PmNode): { pos: number; node: PmNode }[] {
  const seen = new Set<string>()
  const dupes: { pos: number; node: PmNode }[] = []
  doc.forEach((node, pos) => {
    const id = node.attrs.blockId
    if (typeof id !== 'string' || !id) return
    if (seen.has(id)) {
      dupes.push({ pos, node })
    } else {
      seen.add(id)
    }
  })
  return dupes
}

export const WriteBlockId = Extension.create({
  name: 'writeBlockId',

  addGlobalAttributes() {
    return [
      {
        types: TOP_LEVEL_TYPES,
        attributes: {
          blockId: {
            default: null,
            rendered: false,
            keepOnSplit: false
          }
        }
      },
      {
        types: ['paragraph'],
        attributes: {
          // Marks a paragraph synthesized to satisfy PM content constraints
          // (e.g. listItem's required leading paragraph) — serialization
          // drops it so the source fragment round-trips.
          workAuto: {
            default: null,
            rendered: false,
            keepOnSplit: false
          },
          // Continuation line of a multi-line source paragraph: its own
          // block, rejoined with a single newline on save. Enter inside a
          // run of such lines keeps adding lines to the same paragraph.
          softLine: {
            default: null,
            keepOnSplit: true,
            parseHTML: (element) => (element.hasAttribute('data-soft-line') ? true : null),
            renderHTML: (attributes) => (attributes.softLine ? { 'data-soft-line': 'true' } : {})
          }
        }
      }
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockIdPluginKey,
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((tr) => tr.docChanged)) return null
          const dupes = duplicateBlockIds(newState.doc)
          if (dupes.length === 0) return null
          const tr = newState.tr
          for (const { pos } of dupes) {
            tr.setNodeAttribute(pos, 'blockId', generateBlockId())
          }
          tr.setMeta('addToHistory', false)
          return tr
        }
      })
    ]
  }
})
