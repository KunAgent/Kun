/**
 * Inline atom nodes for Work constructs (implementation §7):
 *
 * - `wikiLink`: `[[target#heading|alias]]` / `![[embed]]`, carries the
 *   verbatim `raw` so serialization never reconstructs the syntax.
 * - `footnoteReference`: `[^id]` reference anchor.
 * - `inlineHtml`: inline HTML preserved as an atom (`<kbd>`, `<br>`, …).
 *
 * NodeViews are plain DOM (no React) per the implementation note; all DOM
 * access is lazy so the schema can be built in node/test environments.
 */
import { Node as TiptapNode, mergeAttributes } from '@tiptap/core'
import type { NodeView } from '@tiptap/pm/view'

export const WikiLink = TiptapNode.create({
  name: 'wikiLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      target: { default: '' },
      heading: { default: null },
      alias: { default: null },
      embed: { default: false },
      raw: { default: '' }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-wiki-link]',
        getAttrs: (el) => ({
          target: el.getAttribute('data-target') ?? '',
          heading: el.getAttribute('data-heading'),
          alias: el.getAttribute('data-alias'),
          embed: el.getAttribute('data-embed') === 'true',
          raw: el.getAttribute('data-raw') ?? ''
        })
      }
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, {
      'data-wiki-link': '',
      'data-target': String(node.attrs.target ?? ''),
      'data-heading': node.attrs.heading ?? null,
      'data-alias': node.attrs.alias ?? null,
      'data-embed': String(node.attrs.embed === true),
      'data-raw': String(node.attrs.raw ?? ''),
      class: node.attrs.embed ? 'work-wiki-embed' : 'work-wiki-link'
    }), node.attrs.alias ?? node.attrs.target ?? '']
  },

  addNodeView() {
    return ({ node }): NodeView => {
      const dom = document.createElement('span')
      dom.className = node.attrs.embed ? 'work-wiki-embed' : 'work-wiki-link'
      const render = (attrs: Record<string, unknown>): void => {
        dom.textContent = String(attrs.alias ?? attrs.target ?? '')
        dom.dataset.target = String(attrs.target ?? '')
        if (attrs.embed) dom.dataset.embed = 'true'
        else delete dom.dataset.embed
        dom.title = String(attrs.raw ?? '')
      }
      render(node.attrs)
      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== node.type.name) return false
          render(updated.attrs)
          return true
        }
      }
    }
  }
})

export const FootnoteReference = TiptapNode.create({
  name: 'footnoteReference',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      identifier: { default: '' },
      label: { default: null }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'sup[data-footnote-ref]',
        getAttrs: (el) => ({
          identifier: el.getAttribute('data-identifier') ?? '',
          label: el.getAttribute('data-label')
        })
      }
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['sup', mergeAttributes(HTMLAttributes, {
      'data-footnote-ref': '',
      'data-identifier': String(node.attrs.identifier ?? ''),
      'data-label': node.attrs.label ?? null,
      class: 'work-footnote-ref'
    }), node.attrs.label ?? node.attrs.identifier ?? '']
  },

  addNodeView() {
    return ({ node }): NodeView => {
      const dom = document.createElement('sup')
      dom.className = 'work-footnote-ref'
      const render = (attrs: Record<string, unknown>): void => {
        dom.textContent = `[${String(attrs.label ?? attrs.identifier ?? '')}]`
        dom.title = 'footnote'
      }
      render(node.attrs)
      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== node.type.name) return false
          render(updated.attrs)
          return true
        }
      }
    }
  }
})

export const InlineHtml = TiptapNode.create({
  name: 'inlineHtml',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      raw: { default: '' }
    }
  },

  parseHTML() {
    return [
      {
        tag: 'code[data-inline-html]',
        getAttrs: (el) => ({ raw: el.getAttribute('data-raw') ?? el.textContent ?? '' })
      }
    ]
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['code', mergeAttributes(HTMLAttributes, {
      'data-inline-html': '',
      'data-raw': String(node.attrs.raw ?? ''),
      class: 'work-inline-html'
    }), String(node.attrs.raw ?? '')]
  },

  addNodeView() {
    return ({ node }): NodeView => {
      const dom = document.createElement('code')
      dom.className = 'work-inline-html'
      const render = (attrs: Record<string, unknown>): void => {
        dom.textContent = String(attrs.raw ?? '')
        dom.title = 'inline html'
      }
      render(node.attrs)
      return {
        dom,
        update: (updated) => {
          if (updated.type.name !== node.type.name) return false
          render(updated.attrs)
          return true
        }
      }
    }
  }
})
