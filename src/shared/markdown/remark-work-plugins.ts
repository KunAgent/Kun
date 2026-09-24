/**
 * Work-profile remark plugins shared by the renderer editor and the main
 * process export pipeline (implementation §3.1, §7):
 *
 * - `remarkCallout`: `> [!type] title` blockquotes → `callout` nodes
 *   (ported from Agentero `src/lib/markdown/callout.ts`).
 * - `remarkDemoteFalseMath`: remark-math runs with
 *   `singleDollarTextMath:true` so micromark tokenizes `$…$` on the raw
 *   source — LaTeX escapes survive and emphasis cannot split a formula.
 *   micromark does not apply Pandoc's spacing rules, so this pass demotes
 *   false positives back to text: formulas whose value starts/ends with
 *   whitespace, or whose closing `$` is immediately followed by a digit
 *   (`$5 and $6`).
 * - `remarkWorkInline`: `findAndReplace` splits `[[target#heading|alias]]`
 *   / `![[embed]]` into `wikiLink` nodes; a position pass then re-attaches
 *   the verbatim source slice so escapes inside the brackets survive.
 */
import { findAndReplace } from 'mdast-util-find-and-replace'
import type { Node, Parent } from 'unist'
import type { PhrasingContent, RootContent, Text } from 'mdast'

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

type Positioned = {
  type: string
  position?: {
    start?: { offset?: number }
    end?: { offset?: number }
  }
  children?: Positioned[]
}

/**
 * `findAndReplace` creates wikiLink nodes without positions and matches on
 * the *decoded* text value, so escapes inside `[[…]]` (e.g. `[[a\{b]]`)
 * would lose their backslashes. Re-anchor each wikiLink node to the raw
 * source by scanning the parent node's source slice: when the number of
 * raw `[[…]]` matches equals the number of wikiLink children they pair up
 * in order and get their verbatim `raw` + `position` back.
 */
function anchorWikiLinks(node: Positioned, source: string): void {
  const children = node.children
  if (!children) return
  const parentStart = node.position?.start?.offset
  const parentEnd = node.position?.end?.offset
  const wikiChildren = children.filter((child) => child.type === 'wikiLink')
  if (wikiChildren.length > 0 && typeof parentStart === 'number' && typeof parentEnd === 'number') {
    const slice = source.slice(parentStart, parentEnd)
    WIKI_LINK_RE.lastIndex = 0
    const matches = [...slice.matchAll(WIKI_LINK_RE)]
    if (matches.length === wikiChildren.length) {
      wikiChildren.forEach((child, index) => {
        const match = matches[index]
        const start = parentStart + match.index
        ;(child as { raw?: string }).raw = match[0]
        child.position = {
          start: { offset: start },
          end: { offset: start + match[0].length }
        }
      })
    }
  }
  for (const child of children) anchorWikiLinks(child, source)
}

/**
 * One `findAndReplace` pass over `text` nodes that splits out wiki links
 * (`[[target#heading|alias]]`, `![[embed]]`). `link`, `inlineCode`,
 * `code`, `math`, and `html` subtrees are skipped so their literal content
 * is untouched. Inline math is handled by remark-math +
 * {@link remarkDemoteFalseMath}, not here.
 */
export function remarkWorkInline() {
  return (tree: Node, file: { value?: unknown }) => {
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
      ]
    ], {
      ignore: [
        'link', 'linkReference', 'inlineCode', 'code', 'math', 'html',
        'definition', 'footnoteDefinition'
      ]
    })
    const source = typeof file?.value === 'string' ? file.value : ''
    if (source) anchorWikiLinks(tree as Positioned, source)
  }
}

type LooseMathNode = Positioned & { value?: string }

function demoteInlineMath(node: LooseMathNode, source: string): void {
  const children = node.children
  if (!children) return
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (child.type !== 'inlineMath') {
      demoteInlineMath(child, source)
      continue
    }
    const rawValue = (child as LooseMathNode).value
    const value = typeof rawValue === 'string' ? rawValue : ''
    const end = child.position?.end?.offset
    const start = child.position?.start?.offset
    const demote =
      !value.trim() ||
      /^\s|\s$/.test(value) ||
      (typeof end === 'number' && /[0-9]/.test(source.charAt(end)))
    if (!demote) continue
    const raw = typeof start === 'number' && typeof end === 'number'
      ? source.slice(start, end)
      : `$${value}$`
    children[index] = {
      type: 'text',
      value: raw,
      position: child.position
    } as Positioned
  }
}

/**
 * Pandoc's `$…$` spacing rules as a post-pass over remark-math output:
 * inline math whose value has leading/trailing whitespace, or whose
 * closing `$` is followed by an ASCII digit, was never a formula — restore
 * it to the literal source text.
 */
export function remarkDemoteFalseMath() {
  return (tree: Node, file: { value?: unknown }) => {
    const source = typeof file?.value === 'string' ? file.value : ''
    demoteInlineMath(tree as LooseMathNode, source)
  }
}

// Re-exported so converters can narrow on the custom node types.
export type { RootContent, Text }
