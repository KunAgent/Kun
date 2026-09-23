import { closingFencePattern, openingFence } from '../markdown-live-widgets'

/**
 * Open-time construct gate for the rich editor. The round-trip audit only
 * checks that serialization is idempotent — these constructs round-trip
 * "successfully" while silently rewriting the user's source (math gets
 * escaped, callouts/wikilinks/footnotes get mangled, raw HTML gets entity
 * encoded, reference definitions get inlined). Any hit keeps the document
 * out of rich mode so the file on disk is never rewritten.
 */

const FRONTMATTER_RE = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/

const CONSTRUCTS: ReadonlyArray<readonly [code: string, re: RegExp]> = [
  ['block-math', /^ {0,3}\$\$/m],
  ['escaped-dollar', /\\\$/],
  ['wikilink', /!?\[\[[^\]\n]+\]\]/],
  ['callout', /^ {0,3}>[ \t]*\[![A-Za-z0-9_-]+\]/m],
  ['footnote', /\[\^[^\]\s]+\]/],
  // `p<0.05` does not match: the tag name must be followed by whitespace,
  // `/` or `>`.
  ['html', /<(?:[A-Za-z][\w-]*[\s/>]|\/[A-Za-z]|!--)/],
  ['reference-definition', /^ {0,3}\[[^\]]+\]:[ \t]*\S/m]
]

/**
 * Blank out fenced code blocks so constructs inside them do not trigger the
 * gate. Line structure is preserved (stripped lines become empty lines) so
 * multi-line regexes still see the same document shape.
 */
function stripFencedBlocks(markdown: string): string {
  const lines = markdown.split('\n')
  const out: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const fence = openingFence(line)
    if (!fence) {
      out.push(line)
      index += 1
      continue
    }
    const closePattern = closingFencePattern(fence.marker)
    out.push('')
    index += 1
    while (index < lines.length) {
      const consumed = lines[index] ?? ''
      out.push('')
      index += 1
      if (closePattern.test(consumed)) break
    }
  }
  return out.join('\n')
}

function stripInlineCode(line: string): string {
  return line.replace(/(`+)[^`]*?\1/g, (match) => ' '.repeat(match.length))
}

/** Fenced blocks and inline code spans blanked out; line count preserved. */
export function stripCodeForConstructScan(markdown: string): string {
  return stripFencedBlocks(markdown)
    .split('\n')
    .map(stripInlineCode)
    .join('\n')
}

export function findUnsupportedConstructs(markdown: string): string[] {
  const codes: string[] = []
  if (FRONTMATTER_RE.test(markdown)) codes.push('frontmatter')
  const prose = stripCodeForConstructScan(markdown)
  for (const [code, re] of CONSTRUCTS) {
    if (re.test(prose)) codes.push(code)
  }
  return codes
}
