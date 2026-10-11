import type { ChatBlock } from './types'

/** Hide a host write echo only when a native tool reports the exact same diff. */
export function dedupeAcpMediatedChanges(blocks: ChatBlock[]): ChatBlock[] {
  const native = new Set(blocks.flatMap((block) => {
    if (block.kind !== 'tool' || block.status !== 'success' || block.meta?.acpKind === 'fs.write') return []
    const key = diffKey(block)
    return key ? [key] : []
  }))
  return blocks.filter((block) => {
    if (block.kind !== 'tool' || block.meta?.acpKind !== 'fs.write' || block.status !== 'success') return true
    const key = diffKey(block)
    return !key || !native.has(key)
  })
}

function diffKey(block: Extract<ChatBlock, { kind: 'tool' }>): string | undefined {
  const diffs = block.meta?.acpDiffs
  if (!Array.isArray(diffs) || !diffs.length || block.meta?.acpTruncated) return undefined
  if (!diffs.every((diff) => diff && typeof diff.path === 'string' && typeof diff.newText === 'string')) return undefined
  return JSON.stringify([block.turnId, diffs.map((diff) => [diff.path, diff.oldText ?? null, diff.newText])])
}
