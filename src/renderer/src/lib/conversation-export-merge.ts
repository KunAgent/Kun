export type MergedConversationEntry = {
  title: string
  markdown: string
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/** Pushes every heading one level down (capped at h6), leaving fenced code untouched. */
export function demoteMarkdownHeadings(markdown: string): string {
  let fence = ''
  return markdown
    .split('\n')
    .map((line) => {
      const match = FENCE.exec(line)
      if (match) {
        const marker = match[1]!
        if (!fence) fence = marker
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''
        return line
      }
      if (fence) return line
      return /^ {0,3}#{1,5}\s/.test(line) ? `#${line.trimStart()}` : line
    })
    .join('\n')
}

function stripExportHeader(markdown: string): string {
  const separator = markdown.indexOf('\n\n---\n\n')
  return separator >= 0 ? markdown.slice(separator + 7) : markdown
}

/**
 * Joins per-conversation documents into one file: a title, a numbered
 * contents list, then each conversation under its own h2 with demoted headings.
 */
export function buildMergedConversationMarkdown(options: {
  title: string
  exportedAtLabel: string
  exportedAt: string
  contentsLabel: string
  entries: MergedConversationEntry[]
}): string {
  const header = `# ${options.title}\n\n> ${options.exportedAtLabel}: ${options.exportedAt}`
  const contents = [
    `## ${options.contentsLabel}`,
    options.entries.map((entry, index) => `${index + 1}. ${entry.title}`).join('\n')
  ].join('\n\n')
  const bodies = options.entries.map((entry, index) => {
    const body = demoteMarkdownHeadings(stripExportHeader(entry.markdown)).trim()
    return `## ${index + 1}. ${entry.title}\n\n${body}`
  })
  return [header, contents, ...bodies].join('\n\n---\n\n') + '\n'
}
