import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { toMarkdown } from 'mdast-util-to-markdown'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { mathToMarkdown } from 'mdast-util-math'
import type { Root } from 'mdast'

type ExportNode = {
  type: string
  value?: string
  alt?: string | null
  label?: string | null
  identifier?: string
  lang?: string | null
  meta?: string | null
  children?: ExportNode[]
}

const parser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath, { singleDollarTextMath: false })
  .freeze()

function literalCodeHtml(text: string): string {
  // Work's unclosed-math prepass also scans fenced code. A generated HTML code
  // block avoids changing literal $$ lines, backticks or boundary whitespace.
  // Only this fixed wrapper is HTML; every source delimiter is escaped.
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('$', '&#36;').replaceAll('\n', '&#10;')
  return `<pre><code>${escaped}</code></pre>`
}

function passiveNodes(node: ExportNode): ExportNode[] {
  // These are the same source constructs suppressed by PassiveAssistantMarkdown.
  // Remove destinations before serialization, including reference definitions:
  // another message must not be able to reactivate a bounded reply's links.
  if (node.type === 'html' || node.type === 'definition') return []
  if (node.type === 'link' || node.type === 'linkReference') {
    return (node.children ?? []).flatMap(passiveNodes)
  }
  if (node.type === 'image' || node.type === 'imageReference') {
    return passiveNodes({ type: 'text', value: node.alt ?? '' })
  }
  if (node.type === 'footnoteReference') {
    return passiveNodes({ type: 'text', value: `[${node.label ?? node.identifier ?? ''}]` })
  }
  if (node.type === 'footnoteDefinition') {
    return [{
      type: 'blockquote',
      children: [
        { type: 'paragraph', children: passiveNodes({ type: 'text', value: `[${node.label ?? node.identifier ?? ''}]` }) },
        ...(node.children ?? []).flatMap(passiveNodes)
      ]
    }]
  }
  // Keep fenced source literal in consumers with Mermaid/chart extensions too.
  if (node.type === 'code') return [{ type: 'html', value: literalCodeHtml(node.value ?? '') }]
  // GFM's AST autolink pass can relink even escaped URLs after reparsing.
  // Literal code is portable and cannot acquire a destination in that pass.
  if (node.type === 'text' && /https?:\/\/|www\.|[^\s@]+@[^\s@]+\./i.test(node.value ?? '')) {
    return [{ type: 'inlineCode', value: node.value ?? '' }]
  }
  // These formulas already fall back under KaTeX trust:false. Keep their source
  // literal: a different consumer's math grammar must not expose embedded URLs
  // or HTML when it declines to parse the formula.
  if ((node.type === 'math' || node.type === 'inlineMath') &&
    /https?:\/\/|www\.|[^\s@]+@[^\s@]+\.|[<>]|\\(?:href|url|includegraphics|html\w*)\b/i.test(node.value ?? '')) {
    return [node.type === 'math'
      ? { type: 'html', value: literalCodeHtml(node.value ?? '') }
      : { type: 'inlineCode', value: node.value ?? '' }]
  }
  if (node.children) node.children = node.children.flatMap(passiveNodes)
  return [node]
}

/**
 * Bake the bounded reply's render policy into the portable Markdown itself.
 * Both Markdown downloads and the existing PDF renderer consume this result;
 * no downstream policy flag can be dropped and reactivate source resources.
 * The serializer escapes literal autolinks, HTML and unresolved references.
 */
export function assistantExportMarkdown(
  text: string,
  renderMode?: 'plain-text' | 'safe-markdown'
): string {
  if (renderMode === 'plain-text') {
    return literalCodeHtml(text)
  }
  if (renderMode !== 'safe-markdown') return text
  const tree = parser.parse(text)
  passiveNodes(tree as ExportNode)
  return toMarkdown(tree as Root, {
    // Work exports support single-dollar inline math; using that canonical
    // syntax avoids mistaking a standalone inline formula for a block fence.
    extensions: [gfmToMarkdown(), mathToMarkdown()],
    fences: true
  }).trim()
}
