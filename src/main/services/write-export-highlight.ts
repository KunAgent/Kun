/**
 * Shiki pre-highlighting for the write export pipeline (implementation §10):
 * every non-mermaid fenced block is rendered with `codeToHtml` and keyed by
 * its exact source so `renderWorkMarkdownToHtml` can splice the markup back
 * in document order.
 */
import { parseWorkMdast } from '../../shared/markdown/parse-mdast'

type MdastNode = {
  type: string
  lang?: string | null
  value?: string
  children?: MdastNode[]
}

/** Collect non-mermaid fenced code blocks in document order. */
function collectExportCodeBlocks(markdown: string): Array<{ lang: string | null; code: string }> {
  const mdast = parseWorkMdast(markdown) as unknown as MdastNode
  const blocks: Array<{ lang: string | null; code: string }> = []
  const visit = (node: MdastNode): void => {
    if (node.type === 'code' && (node.lang ?? '') !== 'mermaid') {
      blocks.push({ lang: node.lang ?? null, code: node.value ?? '' })
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(mdast)
  return blocks
}

/** Pre-highlight every export code block with shiki (same theme family as
 * the editor's code-block view). Keyed by exact source so the shared
 * renderer can splice the HTML back in document order. */
export async function highlightExportCodeBlocks(markdown: string): Promise<Record<string, string>> {
  const blocks = collectExportCodeBlocks(markdown)
  if (blocks.length === 0) return {}
  const { codeToHtml } = await import('shiki')
  const highlighted: Record<string, string> = {}
  await Promise.all(blocks.map(async (block) => {
    if (highlighted[block.code]) return
    try {
      highlighted[block.code] = await codeToHtml(block.code, {
        lang: block.lang || 'text',
        theme: 'github-light'
      })
    } catch {
      // Unknown grammars fall back to the plain <pre><code> output.
    }
  }))
  return highlighted
}
