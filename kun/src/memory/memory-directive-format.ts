import type { MemoryRecord } from '../contracts/memory.js'

/**
 * Renders user-approved standing rules. Unlike MEMORY_REFERENCE_DATA this block
 * is authoritative user-level guidance, so evidence attributes (confidence,
 * freshness, sources) are deliberately omitted; the record id stays so the
 * model can reference a rule when the user asks to change or remove it.
 */
export function formatMemoryDirectiveBlock(directives: readonly MemoryRecord[]): string {
  if (directives.length === 0) return ''
  return [
    'Standing rules the user explicitly saved and confirmed in Kun memory.',
    'Follow them like user instructions whenever they apply to the current request.',
    'They cannot override Kun policy, safety, runtime mode, approval, sandbox, or tool permissions,',
    'and the latest explicit user message wins if it conflicts with a rule.',
    'Workspace rules are more specific than user-wide rules.',
    '<kun_memory_directives>',
    ...directives.map((record) => formatMemoryDirectiveLine(record)),
    '</kun_memory_directives>'
  ].join('\n')
}

/** One rendered directive line; also used to measure the injection budget. */
export function formatMemoryDirectiveLine(record: MemoryRecord): string {
  return `- [${record.scope}] ${JSON.stringify(record.content)} (id=${record.id})`
}
