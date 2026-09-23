/**
 * Work-profile remark plugins shared by the renderer editor and the main
 * process export pipeline (implementation §3.1, §7):
 *
 * - `remarkCallout`: `> [!type] title` blockquotes → `callout` nodes
 *   (ported from Agentero `src/lib/markdown/callout.ts`).
 * - `remarkWorkInline`: one `findAndReplace` pass that splits
 *   `[[target#heading|alias]]` / `![[embed]]` into `wikiLink` nodes carrying
 *   the verbatim `raw`, and `$…$` with Pandoc's spacing rules into
 *   `inlineMath` (remark-math runs with `singleDollarTextMath:false`; this
 *   adds the strict variant back so `$5 and $6` stays text).
 */
import { findAndReplace } from 'mdast-util-find-and-replace'
import type { Node, Parent } from 'unist'
import type { PhrasingContent, RootContent, Text } from 'mdast'
import { WORK_INLINE_MATH_RE } from './work-profile'

export type WorkCalloutNode = Parent & {
  type: 'callout'
  calloutType: string
  calloutTypeRaw: string
  title?: string
}

export type WorkWikiLinkNode = Node & {
  type: 'wikiLink'
  raw: string
  target: string
  heading?: string
  alias?: string
  embed: boolean
}

type LooseParent = {
  type: string
  value?: string
  children?: LooseParent[]
  calloutType?: string
  calloutTypeRaw?: string
  title?: string
  position?: { start?: { offset?: number } }
}

const CALLOUT_MARKER_RE = /^\[!([A-Za-z0-9_-]+)\](?:[ \t]+(.*?))?[ \t]*$/

export function parseCalloutMarker(line: string): { type: string; typeRaw: string; title?: string } | null {
  const match = line.match(CALLOUT_MARKER_RE)
  if (!match) return null
  const typeRaw = match[1]
  const title = match[2]?.trim()
  return { type: typeRaw.toLowerCase(), typeRaw, ...(title ? { title } : {}) }
}

function calloutFromBlockquote(node: LooseParent, source: string): LooseParent | null {
  if (node.type !== 'blockquote') return null
  const firstParagraph = node.children?.[0]
  const firstText = firstParagraph?.children?.[0]
  if (
    firstParagraph?.type !== 'paragraph' ||
    firstText?.type !== 'text' ||
    typeof firstText.value !== 'string'
  ) {
    return null
  }
  // `\[!note]` is an escaped bracket, not a marker.
  const sourceOffset = firstText.position?.start?.offset
  if (sourceOffset !== undefined && source.slice(sourceOffset, sourceOffset + 2) === '\\[') {
    return null
  }

  const newline = firstText.value.indexOf('\n')
  const header = newline < 0 ? firstText.value : firstText.value.slice(0, newline)
  const marker = parseCalloutMarker(header)
  if (!marker) return null

  const body = [...(node.children ?? [])]
  if (newline < 0) {
    const paragraphChildren = firstParagraph.children ?? []
    if (paragraphChildren.length === 1) {
      body.shift()
    } else if (paragraphChildren[1]?.type === 'break') {
      const bodyChildren = paragraphChildren.slice(2)
      if (bodyChildren.length) {
        body[0] = { ...firstParagraph, children: bodyChildren }
      } else {
        body.shift()
      }
    } else {
      return null
    }
  } else {
    const bodyPrefix = firstText.value.slice(newline + 1)
    const paragraphChildren = [...(firstParagraph.children ?? [])]
    if (bodyPrefix) {
      paragraphChildren[0] = { ...firstText, value: bodyPrefix }
    } else {
      paragraphChildren.shift()
    }
    if (paragraphChildren.length) {
      body[0] = { ...firstParagraph, children: paragraphChildren }
    } else {
      body.shift()
    }
  }

  return {
    type: 'callout',
    calloutType: marker.type,
    calloutTypeRaw: marker.typeRaw,
    ...(marker.title ? { title: marker.title } : {}),
    children: body,
    position: node.position
  }
}

function transformChildren(node: LooseParent, transform: (child: LooseParent) => LooseParent | null): void {
  if (!node.children) return
  node.children = node.children.map((child) => {
    const replacement = transform(child)
    if (replacement) return replacement
    transformChildren(child, transform)
    return child
  })
}

/**
 * Translate Obsidian/GitHub blockquote markers into `callout` mdast nodes.
 * Serialization emits the blockquote form back from `workToMarkdown`.
 */
export function remarkCallout() {
  return (tree: LooseParent, file: { value?: unknown }) => {
    const source = typeof file?.value === 'string' ? file.value : file?.value ? String(file.value) : ''
    transformChildren(tree, (node) => calloutFromBlockquote(node, source))
  }
}

type WikiLinkParts = { target: string; heading?: string; alias?: string }

function parseWikiLinkInner(inner: string): WikiLinkParts | null {
  const trimmed = inner.trim()
  if (!trimmed) return null
  const pipe = trimmed.indexOf('|')
  const refPart = (pipe < 0 ? trimmed : trimmed.slice(0, pipe)).trim()
  const alias = pipe < 0 ? undefined : trimmed.slice(pipe + 1).trim() || undefined
  if (!refPart) return null
  const hash = refPart.indexOf('#')
  const target = (hash < 0 ? refPart : refPart.slice(0, hash)).trim()
  const heading = hash < 0 ? undefined : refPart.slice(hash + 1).trim() || undefined
  if (!target && !heading) return null
  return { target, heading, alias }
}

const WIKI_LINK_RE = /(!?)\[\[([^\]\n]+)\]\]/g
const PANDOC_MATH_RE = new RegExp(WORK_INLINE_MATH_RE.source, 'g')

/**
 * Single `findAndReplace` pass over `text` nodes that splits out both wiki
 * links (`[[target#heading|alias]]`, `![[embed]]`) and Pandoc-rule inline
 * math (`$…$`: opening `$` followed by non-space, closing `$` preceded by
 * non-space and not followed by a digit, `\$` never counts). One tree walk
 * for both constructs keeps large-document parsing cheaper.
 * `link`, `inlineCode`, `code`, `math`, and `html` subtrees are skipped so
 * their literal content is untouched.
 */
export function remarkWorkInline() {
  return (tree: Node) => {
    findAndReplace(tree as never, [
      [
        WIKI_LINK_RE,
        (raw: string, bang: string, inner: string): PhrasingContent | false => {
          const parts = parseWikiLinkInner(inner)
          if (!parts) return false
          return {
            type: 'wikiLink',
            raw,
            target: parts.target,
            ...(parts.heading ? { heading: parts.heading } : {}),
            ...(parts.alias ? { alias: parts.alias } : {}),
            embed: bang === '!'
          } as unknown as PhrasingContent
        }
      ],
      [
        PANDOC_MATH_RE,
        (raw: string): PhrasingContent | false => {
          const value = raw.slice(1, -1)
          if (!value.trim()) return false
          return { type: 'inlineMath', value } as unknown as PhrasingContent
        }
      ]
    ], {
      ignore: [
        'link', 'linkReference', 'inlineCode', 'code', 'math', 'html',
        'definition', 'footnoteDefinition'
      ]
    })
  }
}

// Re-exported so converters can narrow on the custom node types.
export type { RootContent, Text }
