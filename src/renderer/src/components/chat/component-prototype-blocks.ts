import type { ToolBlock } from '../../agent/types'

type PrototypeTarget = { key: string; failed: boolean }

/**
 * The published file is the card's identity: `design_component` mints a fresh
 * artifactId on every call, so a call that rewrites the same prototype.html is
 * an update of one design, not a second one.
 */
function prototypeTarget(block: ToolBlock): PrototypeTarget {
  const value = block.meta?.componentPrototype
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { key: block.id, failed: false }
  }
  const raw = value as Record<string, unknown>
  const relativePath = typeof raw.relativePath === 'string' ? raw.relativePath.trim().toLowerCase() : ''
  const artifactId = typeof raw.artifactId === 'string' ? raw.artifactId.trim().toLowerCase() : ''
  return { key: relativePath || artifactId || block.id, failed: raw.status === 'failed' }
}

/**
 * One design view per prototype target in a turn. Without this, a turn that
 * publishes a prototype twice stacks two previews of the same file, and the
 * earlier iframe keeps rendering the version it mounted with. The newest call
 * wins; a newer failure keeps the last card that actually published.
 */
export function latestComponentPrototypeBlocks(blocks: readonly ToolBlock[]): ToolBlock[] {
  const order: string[] = []
  const latest = new Map<string, ToolBlock>()
  const latestPublished = new Map<string, ToolBlock>()
  for (const block of blocks) {
    const target = prototypeTarget(block)
    if (!latest.has(target.key)) order.push(target.key)
    latest.set(target.key, block)
    if (!target.failed) latestPublished.set(target.key, block)
  }
  return order.flatMap((key) => {
    const block = latestPublished.get(key) ?? latest.get(key)
    return block ? [block] : []
  })
}
