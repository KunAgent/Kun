import type { PaperHighlight } from '@shared/paper/paper-marks-types'

/**
 * Export marks into the unit's NOTES.md through the workspace file IPC.
 * Idempotent: each mark carries a stable `<!-- paper-mark:<id> -->` anchor,
 * so re-exporting never duplicates entries.
 */

function blockForHighlight(mark: PaperHighlight): string {
  const lines = [
    `<!-- paper-mark:${mark.id} -->`,
    `> ${mark.quote.replace(/\n+/g, ' ')}`,
    ``,
    `- p.${mark.page} · ${mark.color}`
  ]
  if (mark.comment) lines.push(`- ${mark.comment.replace(/\n+/g, ' ')}`)
  return lines.join('\n')
}

function blockForCard(card: unknown): string | null {
  const item = card as {
    id?: string
    kind?: string
    page?: number
    quote?: string
    translation?: string
    question?: string
  }
  if (!item?.id || !item.kind) return null
  if (item.kind === 'translate') {
    return [
      `<!-- paper-mark:${item.id} -->`,
      `> ${(item.quote ?? '').replace(/\n+/g, ' ')}`,
      ``,
      `- p.${item.page ?? '?'} · 翻译`,
      `- ${(item.translation ?? '').replace(/\n+/g, ' ')}`
    ].join('\n')
  }
  if (item.kind === 'ask') {
    return [
      `<!-- paper-mark:${item.id} -->`,
      `> ${(item.quote ?? '').replace(/\n+/g, ' ')}`,
      ``,
      `- p.${item.page ?? '?'} · 提问`,
      item.question ? `- ${item.question.replace(/\n+/g, ' ')}` : `-`
    ].join('\n')
  }
  return null
}

export async function appendPaperNotes(input: {
  workspaceRoot: string
  notesPath: string
  items: readonly PaperHighlight[]
  cards: Record<string, unknown>
}): Promise<{ ok: boolean; appended: number }> {
  const { workspaceRoot, notesPath, items, cards } = input
  if (typeof window.kunGui?.readWorkspaceFile !== 'function') {
    return { ok: false, appended: 0 }
  }
  const blocks = [
    ...items.map(blockForHighlight),
    ...Object.values(cards).flatMap((card) => {
      const block = blockForCard(card)
      return block ? [block] : []
    })
  ]
  if (blocks.length === 0) return { ok: true, appended: 0 }

  const existing = await window.kunGui
    .readWorkspaceFile({ path: notesPath, workspaceRoot })
    .then((result) => (result.ok ? result.content : ''))
    .catch(() => '')

  const missing = blocks.filter((block) => {
    const anchor = block.match(/<!-- paper-mark:[^ ]+ -->/)?.[0]
    return anchor ? !existing.includes(anchor) : !existing.includes(block)
  })
  if (missing.length === 0) return { ok: true, appended: 0 }

  const head = existing.replace(/[\r\n]+$/, '')
  const heading = existing.includes('<!-- paper-mark:') ? '' : '## 批注\n\n'
  const next = `${head ? `${head}\n\n` : ''}${heading}${missing.join('\n\n')}\n`
  const write = await window.kunGui.writeWorkspaceFile({
    path: notesPath,
    workspaceRoot,
    content: next,
    force: true
  }).catch(() => null)
  return { ok: Boolean(write?.ok), appended: missing.length }
}
