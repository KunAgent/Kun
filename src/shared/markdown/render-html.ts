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
  /**
   * 'html' renders KaTeX spans (editor previews); 'mathml' emits native
   * MathML (Chromium export surfaces); 'latex' writes the TeX source into
   * monospace elements for consumers without math support (DOCX).
   */
  math: 'html' | 'mathml' | 'latex'
  /** Pre-rendered mermaid SVG keyed by diagram source. */
  renderedDiagrams?: Record<string, string>
  /**
   * Pre-highlighted code-block HTML keyed by exact fence source. Callers
   * compute it asynchronously (e.g. shiki) and pass the map in.
   */
  highlightedCode?: Record<string, string>
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

/**
 * Replace mermaid code blocks with placeholder nodes (raw svg slots) and
 * record every remaining fenced block's source in `codeSlots`, in document
 * order — the post-sanitize pass zips them with `<pre>` elements.
 */
function markMermaidBlocks(tree: LooseNode, slots: string[], codeSlots: string[]): void {
  const visit = (node: LooseNode): LooseNode => {
    if (node.type === 'code') {
      if ((node.lang ?? '') === 'mermaid') {
        const source = node.value ?? ''
        slots.push(source)
        return {
          type: 'workMermaidSlot',
          value: String(slots.length - 1)
        }
      }
      codeSlots.push(node.value ?? '')
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

/**
 * 'latex' math mode handlers: mdast `math`/`inlineMath` become monospace
 * wrappers holding the raw TeX so Word/DOCX keeps the formula readable.
 */
const latexMathRehypeHandlers = {
  math(_state: unknown, node: LooseNode): Element {
    return el('pre', { className: ['work-math-latex'] }, [
      el('code', {}, [{ type: 'text', value: node.value ?? '' }])
    ])
  },
  inlineMath(_state: unknown, node: LooseNode): Element {
    return el('code', { className: ['work-math-latex'] }, [
      { type: 'text', value: node.value ?? '' }
    ])
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

/** Post-sanitize passes: mermaid svg injection + shiki slot injection +
 * resource rewriting. */
function workPostProcess(slots: string[], codeSlots: string[], options: WorkRenderHtmlOptions) {
  return (tree: HastRoot) => {
    let preIndex = 0
    const visit = (node: Node | HastRoot): void => {
      if (node.type === 'root') {
        for (const child of (node as HastRoot).children ?? []) visit(child)
        return
      }
      if (node.type !== 'element') return
      const element = node as Element
      if (element.tagName === 'pre' && options.highlightedCode) {
        const highlighted = options.highlightedCode[codeSlots[preIndex] ?? '']
        preIndex += 1
        if (highlighted) {
          element.children = [{ type: 'raw', value: highlighted } as ElementContent]
        }
        return
      }
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
      if ((element.tagName === 'img' || element.tagName === 'a') && options.resolveResource) {
        const key = element.tagName === 'img' ? 'src' : 'href'
        const value = element.properties?.[key]
        if (typeof value === 'string' && value) {
          element.properties = { ...element.properties, [key]: options.resolveResource(value) }
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
  const codeSlots: string[] = []
  markMermaidBlocks(mdast as unknown as LooseNode, slots, codeSlots)

  const pipeline = unified()
    .use(remarkRehype, {
      allowDangerousHtml: true,
      handlers: {
        ...workRehypeHandlers,
        ...(options.math === 'latex' ? latexMathRehypeHandlers : {})
      } as never
    })
    .use(rehypeRaw)
    .use(rehypeSanitize, workSanitizeSchema)
  if (options.math !== 'latex') {
    pipeline.use(rehypeKatex, { output: options.math === 'mathml' ? 'mathml' : 'html' })
  }
  const hast = pipeline
    .use(workPostProcess, slots, codeSlots, options)
    .runSync(mdast) as Parent

  return toHtml(hast as HastRoot, { allowDangerousHtml: true })
}
