import type { DelegatedToolPresentation, DelegatedTerminalPresentation } from '../../contracts/delegated-tool-presentation.js'
import type { AcpToolCallWire } from './acp-tool-call-mapper.js'

const LIMIT = 64 * 1024
export type AcpToolEvidence = {
  fileContent?: string
  terminals?: DelegatedTerminalPresentation[]
}

export function acpToolPresentation(call: AcpToolCallWire, evidence?: AcpToolEvidence): DelegatedToolPresentation {
  let truncated = false
  const bound = (text: string): string => {
    if (text.length <= LIMIT) return text
    truncated = true
    return text.slice(0, LIMIT) + '\n[truncated]'
  }
  const raw = (value: unknown): unknown => {
    if (value == null) return undefined
    try {
      const encoded = JSON.stringify(value)
      if (encoded.length <= LIMIT) return value
      truncated = true
      return { truncated: true, preview: bound(encoded) }
    } catch { return undefined }
  }
  const input = record(call.rawInput)
  const output = record(call.rawOutput)
  const first = call.locations?.[0]
  const diffs: NonNullable<DelegatedToolPresentation['diffs']> = []
  const texts: string[] = []
  const terminalIds: string[] = []
  for (const entry of call.content ?? []) {
    const content = record(entry)
    if (content.type === 'content') {
      const block = record(content.content)
      if (block.type === 'text' && typeof block.text === 'string') texts.push(block.text)
      if (block.type === 'resource') {
        const resource = record(block.resource)
        if (typeof resource.text === 'string') texts.push(resource.text)
      }
    }
    if (content.type === 'diff' && typeof content.path === 'string' && typeof content.newText === 'string') {
      diffs.push({ path: content.path, oldText: typeof content.oldText === 'string' ? bound(content.oldText) : null, newText: bound(content.newText) })
    }
    if (content.type === 'terminal' && typeof content.terminalId === 'string') terminalIds.push(content.terminalId)
  }
  const terminals = evidence?.terminals?.filter((terminal) => terminalIds.includes(terminal.terminalId))
  const command = string(input, 'command', 'cmd', 'script')
  const args = Array.isArray(input.args) ? input.args.filter((arg): arg is string => typeof arg === 'string') : []
  const detail: DelegatedToolPresentation = {
    version: 1,
    kind: call.kind ?? 'other',
    title: call.title ?? undefined,
    name: string(record(call), 'name'),
    filePath: first?.path ?? string(input, 'file_path', 'filePath', 'path', 'file') ?? diffs[0]?.path,
    line: first?.line ?? number(input, 'offset', 'line', 'start_line'),
    command: command ? [command, ...args].join(' ') : terminals?.[0]?.command,
    cwd: string(input, 'cwd', 'workdir') ?? terminals?.[0]?.cwd,
    query: string(input, 'query', 'pattern'),
    input: raw(call.rawInput), output: raw(call.rawOutput),
    text: texts.length ? bound(texts.join('\n')) : undefined,
    fileContent: evidence?.fileContent !== undefined ? bound(evidence.fileContent)
      : call.kind === 'read' ? string(output, 'content', 'text') : undefined,
    diffs: diffs.length ? diffs : undefined,
    terminals: terminals?.length ? terminals.map((terminal) => {
      // Keep live snapshots small: repeated tool updates are durable events.
      // Settlement retains a larger tail without writing full logs each tick.
      const limit = terminal.exitCode !== undefined || terminal.signal !== undefined ? LIMIT : 4 * 1024
      const clipped = terminal.output.length > limit
      truncated ||= clipped
      return { ...terminal, output: clipped ? `[earlier output omitted]\n${terminal.output.slice(-limit)}` : terminal.output,
        truncated: terminal.truncated || clipped }
    }) : undefined
  }
  if (detail.fileContent) detail.fileContent = bound(detail.fileContent)
  if (truncated || terminals?.some((terminal) => terminal.truncated)) detail.truncated = true
  return detail
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function string(value: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) if (typeof value[key] === 'string' && value[key]) return value[key] as string
  return undefined
}
function number(value: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const key of keys) if (typeof value[key] === 'number' && Number.isFinite(value[key])) return value[key] as number
  return undefined
}
