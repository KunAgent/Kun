/**
 * ProseMirror JSON → mdast conversion (implementation §3.2 reverse path).
 *
 * Custom constructs stay as their mdast-shaped nodes (`callout`, `wikiLink`,
 * `workRaw`); `to-markdown.ts` expands/serializes them. Inline marks are
 * applied outermost-first in a canonical order (link → bold → italic →
 * strike → underline → code on the text) so signatures stay stable.
 */
import type { JSONContent } from '@tiptap/core'
import type { BlockContent, DefinitionContent, List, ListItem, PhrasingContent, RootContent, Table, TableCell, TableRow, TopLevelContent } from 'mdast'

type MdastBlock = TopLevelContent | BlockContent | DefinitionContent | RootContent

const MARK_ORDER: Record<string, number> = {
  link: 0,
  bold: 1,
  italic: 2,
  strike: 3,
  underline: 4,
  code: 5
}

function sortedMarks(node: JSONContent): NonNullable<JSONContent['marks']> {
  return [...(node.marks ?? [])].sort(
    (a, b) => (MARK_ORDER[a.type] ?? 99) - (MARK_ORDER[b.type] ?? 99)
  )
}

function applyMark(inner: PhrasingContent[], mark: NonNullable<JSONContent['marks']>[number]): PhrasingContent[] {
  switch (mark.type) {
    case 'bold':
      return [{ type: 'strong', children: inner }]
    case 'italic':
      return [{ type: 'emphasis', children: inner }]
    case 'strike':
      return [{ type: 'delete', children: inner }]
    case 'link': {
      const attrs = mark.attrs ?? {}
      const identifier = typeof attrs.identifier === 'string' ? attrs.identifier : null
      if (identifier) {
        return [{
          type: 'linkReference',
          identifier,
          label: (attrs.label as string | null) ?? identifier,
          referenceType: (attrs.reference as 'shortcut' | 'collapsed' | 'full' | undefined) ?? 'full',
          children: inner
        }]
      }
      return [{
        type: 'link',
        url: (attrs.href as string) ?? '',
        title: (attrs.title as string | null) ?? null,
        children: inner
      }]
    }
    case 'underline':
      return [
        { type: 'html', value: '<u>' },
        ...inner,
        { type: 'html', value: '</u>' }
      ]
    case 'code':
    default:
      return inner
  }
}

function inlineNodes(content: JSONContent[] | undefined): PhrasingContent[] {
  const out: PhrasingContent[] = []
  for (const node of content ?? []) {
    switch (node.type) {
      case 'text': {
        const marks = sortedMarks(node)
        const codeMark = marks.find((m) => m.type === 'code')
        let inner: PhrasingContent[] = codeMark
          ? [{ type: 'inlineCode', value: node.text ?? '' }]
          : [{ type: 'text', value: node.text ?? '' }]
        for (const mark of marks) {
          if (mark.type === 'code') continue
          inner = applyMark(inner, mark)
        }
        out.push(...inner)
        break
      }
      case 'hardBreak':
        out.push({ type: 'break' })
        break
      case 'image': {
        const attrs = node.attrs ?? {}
        const identifier = typeof attrs.identifier === 'string' ? attrs.identifier : null
        if (identifier) {
          out.push({
            type: 'imageReference',
            identifier,
            label: (attrs.label as string | null) ?? identifier,
            referenceType: (attrs.reference as 'shortcut' | 'collapsed' | 'full' | undefined) ?? 'full',
            alt: (attrs.alt as string | null) ?? ''
          })
        } else {
          out.push({
            type: 'image',
            url: (attrs.src as string) ?? '',
            title: (attrs.title as string | null) ?? null,
            alt: (attrs.alt as string | null) ?? null
          })
        }
        break
      }
      case 'inlineMath':
        out.push({ type: 'inlineMath', value: String(node.attrs?.latex ?? '') })
        break
      case 'wikiLink': {
        const attrs = node.attrs ?? {}
        out.push({
          type: 'wikiLink',
          raw: String(attrs.raw ?? ''),
          target: String(attrs.target ?? ''),
          ...(attrs.heading ? { heading: String(attrs.heading) } : {}),
          ...(attrs.alias ? { alias: String(attrs.alias) } : {}),
          embed: attrs.embed === true
        } as unknown as PhrasingContent)
        break
      }
      case 'footnoteReference':
        out.push({
          type: 'footnoteReference',
          identifier: String(node.attrs?.identifier ?? ''),
          label: (node.attrs?.label as string | null) ?? null
        })
        break
      case 'inlineHtml':
        out.push({ type: 'html', value: String(node.attrs?.raw ?? '') })
        break
      default:
        break
    }
  }
  return out
}

function textContent(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(textContent).join('')
}

function pmList(node: JSONContent): List {
  const isTask = node.type === 'taskList'
  const children: ListItem[] = (node.content ?? []).map((item) => {
    const checked = isTask ? item.attrs?.checked === true : null
    return {
      type: 'listItem',
      checked,
      spread: false,
      children: pmBlocks(item.content) as ListItem['children']
    }
  })
  return {
    type: 'list',
    ordered: node.type === 'orderedList',
    start: node.type === 'orderedList' ? (node.attrs?.start ?? 1) : undefined,
    spread: node.attrs?.tight === false,
    children
  }
}

function pmTable(node: JSONContent): Table {
  const rows: TableRow[] = (node.content ?? []).map((row) => ({
    type: 'tableRow',
    children: (row.content ?? []).map((cell): TableCell => ({
      type: 'tableCell',
      children: cell.content?.length === 1 && cell.content[0].type === 'paragraph'
        ? inlineNodes(cell.content[0].content)
        : [{ type: 'text', value: textContent(cell) }]
    }))
  }))
  const header = node.content?.[0]?.content ?? []
  const align = header.map((cell) => {
    const a = cell.attrs?.align
    return a === 'left' || a === 'center' || a === 'right' ? a : null
  })
  return { type: 'table', align, children: rows }
}

/** Convert one PM block node to mdast. `workRaw` carries raw-block source. */
export function pmBlockToMdast(node: JSONContent): MdastBlock {
  switch (node.type) {
    case 'paragraph':
      return { type: 'paragraph', children: inlineNodes(node.content) }
    case 'heading':
      return {
        type: 'heading',
        depth: Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1))) as 1 | 2 | 3 | 4 | 5 | 6,
        children: inlineNodes(node.content)
      }
    case 'blockquote':
      return { type: 'blockquote', children: pmBlocks(node.content) as BlockContent[] }
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return pmList(node)
    case 'codeBlock':
      return {
        type: 'code',
        lang: (node.attrs?.language as string | null) ?? null,
        meta: (node.attrs?.meta as string | null) ?? null,
        value: textContent(node)
      }
    case 'blockMath':
      return { type: 'math', value: String(node.attrs?.latex ?? ''), meta: null }
    case 'horizontalRule':
      return { type: 'thematicBreak' }
    case 'table':
      return pmTable(node)
    case 'callout':
      return {
        type: 'callout',
        calloutType: String(node.attrs?.calloutType ?? 'note'),
        calloutTypeRaw: String(node.attrs?.calloutTypeRaw ?? node.attrs?.calloutType ?? 'note'),
        ...(node.attrs?.title ? { title: String(node.attrs.title) } : {}),
        children: pmBlocks(node.content) as BlockContent[]
      } as unknown as MdastBlock
    case 'rawMarkdownBlock':
      return { type: 'workRaw', raw: String(node.attrs?.raw ?? '') } as unknown as MdastBlock
    default:
      return { type: 'paragraph', children: [{ type: 'text', value: textContent(node) }] }
  }
}

export function pmBlocks(content: JSONContent[] | undefined): MdastBlock[] {
  return (content ?? []).map(pmBlockToMdast)
}

/** Top-level conversion for serialization. */
export function pmDocToMdast(doc: JSONContent): MdastBlock[] {
  return pmBlocks(doc.content)
}
