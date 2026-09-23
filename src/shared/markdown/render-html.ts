/**
 * Shared Work-Markdown → HTML renderer (implementation §10.1).
 *
 * Used by the editor's raw-block previews and the main-process export
 * pipeline so both produce identical markup:
 *
 *   frontmatter split → remark parse (same pipeline as the editor)
 *   → remark-rehype (custom handlers for callout/wikiLink/mermaid slots)
 *   → rehype-raw (source HTML becomes real elements)
 *   → rehype-sanitize (Work profile schema)
 *   → rehype-katex (math; generated markup is trusted, runs post-sanitize)
 *   → mermaid slot injection + resource rewriting
 *   → hast-util-to-html
 */
import { unified } from 'unified'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import rehypeKatex from 'rehype-katex'
import { toHtml } from 'hast-util-to-html'
import type { Node, Parent } from 'unist'
import type { Element, ElementContent, Properties, Root as HastRoot } from 'hast'
import { splitFrontmatter } from './frontmatter'
import { parseWorkMdast } from './parse-mdast'

export type WorkRenderHtmlOptions = {
  /** KaTeX output mode. Export uses 'mathml' when targeting DOCX. */
  math: 'html' | 'mathml'
  /** Pre-rendered mermaid SVG keyed by diagram source. */
  renderedDiagrams?: Record<string, string>
  /** Rewrite resource URLs (images) before serialization. */
  resolveResource?: (src: string) => string
}

type LooseNode = Node & {
  type: string
  value?: string
  lang?: string | null
  children?: LooseNode[]
  calloutType?: string
  calloutTypeRaw?: string
  title?: string
  raw?: string
  target?: string
  heading?: string
  alias?: string
  embed?: boolean
}

const MERMAID_SLOT_TAG = 'work-mermaid-slot'

/** Replace mermaid code blocks with placeholder nodes (raw svg slots). */
function markMermaidBlocks(tree: LooseNode, slots: string[]): void {
  const visit = (node: LooseNode): LooseNode => {
    if (node.type === 'code' && (node.lang ?? '') === 'mermaid') {
      const source = node.value ?? ''
      slots.push(source)
      return {
        type: 'workMermaidSlot',
        value: String(slots.length - 1)
      }
    }
    if (node.children) {
      node.children = node.children.map((child) => visit(child))
    }
    return node
  }
  tree.children = (tree.children ?? []).map((child) => visit(child))
}

function el(
  tagName: string,
  properties: Properties,
  children: ElementContent[] = []
): Element {
  return { type: 'element', tagName, properties, children }
}

type RehypeState = {
  all: (node: LooseNode) => ElementContent[]
}

const workRehypeHandlers = {
  callout(state: RehypeState, node: LooseNode): Element {
    const type = String(node.calloutType ?? 'note')
    const children: ElementContent[] = [
      el('div', { className: ['work-callout-title'] }, [
        { type: 'text', value: node.title ?? (node.calloutTypeRaw ?? type) }
      ]),
      ...state.all(node)
    ]
    return el('div', {
      className: ['work-callout', `work-callout-${type}`],
      dataCalloutType: type
    }, children)
  },
  wikiLink(_state: unknown, node: LooseNode): Element {
    const label = node.alias || node.heading
      ? `${node.alias ?? node.target ?? ''}${node.heading ? `#${node.heading}` : ''}`
      : node.alias || node.target || ''
    return el('span', {
      className: [node.embed ? 'work-wiki-embed' : 'work-wiki-link'],
      dataTarget: node.target ?? '',
      ...(node.heading ? { dataHeading: node.heading } : {})
    }, [{ type: 'text', value: label }])
  },
  workMermaidSlot(_state: unknown, node: LooseNode): Element {
    return el(MERMAID_SLOT_TAG, { dataMermaidIndex: node.value ?? '0' }, [])
  }
}

/** Schema: GitHub defaults + Work profile extras + our data-* slots. */
const workSanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'center', 'details', 'summary', 'font', 'u', 'mark', MERMAID_SLOT_TAG
  ],
  attributes: {
    ...defaultSchema.attributes,
    '*': [
      ...(defaultSchema.attributes?.['*'] ?? []),
      'dataCalloutType', 'dataTarget', 'dataHeading', 'dataMermaidIndex', 'align'
    ],
    div: [...(defaultSchema.attributes?.div ?? []), 'className'],
    span: [...(defaultSchema.attributes?.span ?? []), 'className'],
    font: ['color', 'face', 'size'],
    img: [...(defaultSchema.attributes?.img ?? []), 'width', 'height']
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), 'obsidian']
  }
}

/** Post-sanitize passes: mermaid svg injection + resource rewriting. */
function workPostProcess(slots: string[], options: WorkRenderHtmlOptions) {
  return (tree: HastRoot) => {
    const visit = (node: Node): void => {
      if (node.type !== 'element') return
      const element = node as Element
      if (element.tagName === MERMAID_SLOT_TAG) {
        const index = Number(element.properties?.dataMermaidIndex ?? 0)
        const svg = options.renderedDiagrams?.[slots[index]]
        element.tagName = 'div'
        element.properties = { className: ['work-mermaid'] }
        element.children = svg
          ? [{ type: 'raw', value: svg } as ElementContent]
          : [el('pre', { className: ['work-mermaid-source'] }, [
              { type: 'text', value: slots[index] ?? '' }
            ])]
        return
      }
      if (element.tagName === 'img' && options.resolveResource) {
        const src = element.properties?.src
        if (typeof src === 'string' && src) {
          element.properties = { ...element.properties, src: options.resolveResource(src) }
        }
      }
      for (const child of element.children ?? []) visit(child)
    }
    visit(tree)
  }
}

/** Render a Work Markdown document (or fragment) to sanitized HTML. */
export function renderWorkMarkdownToHtml(
  markdown: string,
  options: WorkRenderHtmlOptions = { math: 'html' }
): string {
  const { body } = splitFrontmatter(markdown)
  const mdast = parseWorkMdast(body)
  const slots: string[] = []
  markMermaidBlocks(mdast as unknown as LooseNode, slots)

  const hast = unified()
    .use(remarkRehype, {
      allowDangerousHtml: true,
      handlers: workRehypeHandlers as never
    })
    .use(rehypeRaw)
    .use(rehypeSanitize, workSanitizeSchema)
    .use(rehypeKatex, { output: options.math === 'mathml' ? 'mathml' : 'html' })
    .use(workPostProcess, slots, options)
    .runSync(mdast) as Parent

  return toHtml(hast as HastRoot, { allowDangerousHtml: true })
}
