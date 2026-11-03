import type { ToolPresentation, ToolPresentationState } from '@shared/tool-presentation'
import { boundedToolValue, toolPresentationFields, toolPresentationKind } from '../../../../kun/src/contracts/tool-presentation-fields'
import type { CoreTurnItemJson } from './kun-contract'
import type { ToolBlock } from './types'
import { boundCompleteToolPresentation } from '../../../../kun/src/contracts/tool-presentation-bounds'

const STATES = new Set<ToolPresentationState>(['pending', 'running', 'completed', 'failed', 'canceled'])
const TEXT_FIELDS = ['title', 'name', 'server', 'error', 'text', 'filePath', 'fileContent', 'patch', 'command', 'cwd', 'query', 'url', 'startedAt', 'finishedAt'] as const
const NUMBER_FIELDS = ['line', 'offset', 'limit', 'statusCode', 'durationMs'] as const

export function toolPresentationFromItem(item: CoreTurnItemJson): ToolPresentation {
  const explicit = record(item.meta?.toolPresentation ?? item.meta?.delegatedTool)
  const name = item.toolName ?? 'tool'
  const input = item.kind === 'tool_call' ? item.arguments : undefined
  const output = item.kind === 'tool_result' ? item.output : undefined
  const kind = toolPresentationKind(name, item.toolKind)
  const result = record(output)
  const state: ToolPresentationState = result.code === 'tool_cancelled_by_user' || item.status === 'aborted' ? 'canceled'
    : item.status === 'failed' || item.isError ? 'failed'
      : item.status === 'running' ? 'running' : item.status === 'pending' ? 'pending' : 'completed'
  const fields = toolPresentationFields(kind, input, output)
  const base: ToolPresentation = {
    version: 1, source: name.startsWith('acp:') ? 'acp' : 'native', kind, state, canCancel: false,
    name, ...fields,
    ...(input !== undefined ? { input: boundedToolValue(input) } : {}),
    ...(output !== undefined ? { output: boundedToolValue(output) } : {}),
    ...(typeof item.summary === 'string' ? { title: item.summary } : {}),
    ...(item.finishedAt ? { finishedAt: item.finishedAt } : {})
  }
  if (name.startsWith('acp:')) {
    const args = record(input)
    if (args.rawInput !== undefined) base.input = boundedToolValue(args.rawInput)
    if (typeof args.title === 'string') base.title = args.title
    Object.assign(base, toolPresentationFields(kind, args.rawInput, output))
  }
  const normalized = normalizePresentation(explicit, base)
  // Canonical terminal evidence always clears stale running/cancel capability.
  if (terminal(state)) normalized.state = state
  if (normalized.source === 'acp' || terminal(normalized.state)) normalized.canCancel = false
  if (normalized.state !== 'failed' && normalized.state !== 'canceled') delete normalized.error
  else if (!normalized.error) normalized.error = typeof result.error === 'string' ? result.error
    : item.isError && typeof output === 'string' ? output : undefined
  inferMcpIdentity(normalized)
  return boundCompleteToolPresentation(normalized)
}

/** Public UI reader: new snapshots, older ACP metadata and native history share one view. */
type PresentationBlock = Pick<ToolBlock, 'meta' | 'summary' | 'status' | 'detail' | 'toolKind' | 'filePath' | 'createdAt'>
const presentationCache = new WeakMap<object, { fields: unknown[]; value: ToolPresentation }>()
export function readToolPresentation(block: PresentationBlock): ToolPresentation {
  const fields = [block.meta, block.summary, block.status, block.detail, block.toolKind, block.filePath, block.createdAt]
  const cached = presentationCache.get(block)
  if (cached && fields.every((field, index) => field === cached.fields[index])) return cached.value
  const value = readPresentation(block)
  presentationCache.set(block, { fields, value })
  return value
}

function readPresentation(block: PresentationBlock): ToolPresentation {
  const meta = block.meta ?? {}
  const explicit = record(meta.toolPresentation)
  const name = typeof meta.toolName === 'string' ? meta.toolName : block.summary
  const legacyAcp = typeof meta.acpKind === 'string'
  const kind = legacyAcp ? String(meta.acpKind) : toolPresentationKind(name, block.toolKind)
  const fallbackState = block.status === 'running' ? 'running' : block.status === 'error' ? 'failed' : 'completed'
  const detail = parseLegacyDetail(block.detail)
  const legacyInput = meta.acpInput ?? (meta.sourceItemKind === 'tool_call' ? detail : undefined)
  const legacyOutput = meta.acpOutput ?? (meta.sourceItemKind !== 'tool_call' ? detail : undefined)
  const base: ToolPresentation = {
    version: 1, source: legacyAcp ? 'acp' : 'legacy', kind, name,
    state: fallbackState, canCancel: false,
    ...toolPresentationFields(kind, legacyInput, legacyOutput),
    ...(block.filePath ? { filePath: block.filePath } : {}),
    ...(typeof meta.acpTitle === 'string' ? { title: meta.acpTitle } : { title: block.summary }),
    ...(legacyInput !== undefined ? { input: legacyInput } : {}),
    ...(legacyOutput !== undefined ? { output: legacyOutput } : {}),
    ...(typeof meta.acpText === 'string' ? { text: meta.acpText } : !legacyAcp && block.detail ? { text: block.detail } : {}),
    ...(typeof meta.acpFileContent === 'string' ? { fileContent: meta.acpFileContent } : {}),
    ...(typeof meta.command === 'string' ? { command: meta.command } : {}),
    ...(typeof meta.cwd === 'string' ? { cwd: meta.cwd } : {}),
    ...(typeof meta.pattern === 'string' ? { query: meta.pattern } : {}),
    ...(typeof meta.acpLine === 'number' ? { line: meta.acpLine } : {}),
    ...(meta.acpTruncated === true ? { truncated: true } : {})
  }
  const presentation = normalizePresentation({ ...defined({ diffs: meta.acpDiffs, terminals: meta.acpTerminals }), ...explicit }, base)
  if (terminal(presentation.state) || presentation.source === 'acp') presentation.canCancel = false
  inferMcpIdentity(presentation)
  return boundCompleteToolPresentation(presentation)
}

export function mergeToolPresentations(current: unknown, incoming: unknown, preferCurrentOutput = false): ToolPresentation | undefined {
  const left = record(current), right = record(incoming)
  if (left.version !== 1 && right.version !== 1) return undefined
  if (left.version !== 1) return incoming as ToolPresentation
  if (right.version !== 1) return current as ToolPresentation
  const a = current as ToolPresentation, b = incoming as ToolPresentation
  const stale = preferCurrentOutput || (terminal(a.state) && !terminal(b.state))
  const merged = { ...a, ...defined(b) }
  if (a.state === 'running' && b.state === 'pending') {
    merged.state = a.state
    merged.canCancel = a.canCancel
  }
  if (stale) {
    for (const key of ['state', 'output', 'error', 'text', 'fileContent', 'patch', 'diffs', 'terminals', 'results', 'content', 'finishedAt', 'durationMs'] as const) {
      if (a[key] !== undefined) Object.assign(merged, { [key]: a[key] })
    }
  }
  if (merged.state === 'completed' && merged.kind === 'edit' && /^(write|write_file)$/.test(merged.name ?? '')) {
    const output = record(merged.output), input = record(merged.input)
    if (typeof output.bytes_written === 'number' && typeof input.content === 'string') merged.fileContent ??= input.content
  }
  if (terminal(merged.state) || merged.source === 'acp') merged.canCancel = false
  return boundCompleteToolPresentation(merged)
}

function normalizePresentation(raw: Record<string, unknown>, fallback: ToolPresentation): ToolPresentation {
  const result = { ...fallback }
  if (typeof raw.kind === 'string') result.kind = raw.kind
  if (STATES.has(raw.state as ToolPresentationState)) result.state = raw.state as ToolPresentationState
  if (raw.source === 'native' || raw.source === 'acp' || raw.source === 'legacy') result.source = raw.source
  result.canCancel = raw.canCancel === true
  for (const key of TEXT_FIELDS) if (typeof raw[key] === 'string') result[key] = raw[key]
  for (const key of NUMBER_FIELDS) if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) result[key] = raw[key]
  for (const key of ['input', 'output'] as const) if (raw[key] !== undefined) result[key] = raw[key]
  if (Array.isArray(raw.locations)) result.locations = raw.locations.slice(0, 200).flatMap((value) => {
    const item = record(value)
    return typeof item.path === 'string' ? [{ path: item.path,
      ...(typeof item.line === 'number' && Number.isFinite(item.line) ? { line: item.line } : {}),
      ...(typeof item.endLine === 'number' && Number.isFinite(item.endLine) ? { endLine: item.endLine } : {}) }] : []
  })
  if (Array.isArray(raw.diffs)) result.diffs = raw.diffs.slice(0, 200).flatMap((value) => {
    const item = record(value)
    return typeof item.path === 'string' && typeof item.newText === 'string'
      ? [{ path: item.path, newText: item.newText, oldText: typeof item.oldText === 'string' ? item.oldText : null }] : []
  })
  if (Array.isArray(raw.terminals)) result.terminals = raw.terminals.slice(0, 200).flatMap((value) => {
    const item = record(value)
    if (typeof item.terminalId !== 'string' || typeof item.output !== 'string') return []
    return [{ terminalId: item.terminalId, output: item.output,
      ...(typeof item.command === 'string' ? { command: item.command } : {}),
      ...(typeof item.cwd === 'string' ? { cwd: item.cwd } : {}),
      ...(typeof item.exitCode === 'number' || item.exitCode === null ? { exitCode: item.exitCode } : {}),
      ...(typeof item.signal === 'string' || item.signal === null ? { signal: item.signal } : {}),
      ...(item.truncated === true ? { truncated: true } : {}) }]
  })
  if (Array.isArray(raw.results)) result.results = raw.results.slice(0, 200).filter((value) => Boolean(value && typeof value === 'object')).map((value) => {
    const item = record(value)
    return defined({ path: typeof item.path === 'string' ? item.path : undefined,
      line: typeof item.line === 'number' && Number.isFinite(item.line) ? item.line : undefined,
      text: typeof item.text === 'string' ? item.text : undefined,
      url: typeof item.url === 'string' ? item.url : undefined,
      title: typeof item.title === 'string' ? item.title : undefined })
  })
  if (Array.isArray(raw.content)) result.content = raw.content.slice(0, 200).flatMap((value) => {
    const item = record(value)
    if (typeof item.type !== 'string') return []
    const content: NonNullable<ToolPresentation['content']>[number] = { type: item.type }
    for (const key of ['text', 'data', 'mimeType', 'uri', 'name'] as const) if (typeof item[key] === 'string') content[key] = item[key]
    if (item.resource && typeof item.resource === 'object') {
      const resource = record(item.resource)
      content.resource = {}
      for (const key of ['uri', 'mimeType', 'text', 'blob'] as const) if (typeof resource[key] === 'string') content.resource[key] = resource[key]
    }
    if (item.raw !== undefined) content.raw = item.raw
    if (item.omitted === true) content.omitted = true
    if (typeof item.originalBytes === 'number') content.originalBytes = item.originalBytes
    return [content]
  })
  if (raw.truncated === true || ['locations', 'diffs', 'terminals', 'results', 'content'].some((key) => Array.isArray(raw[key]) && raw[key].length > 200)) result.truncated = true
  return result
}

function inferMcpIdentity(presentation: ToolPresentation): void {
  const match = /^mcp__(.+?)__(.+)$/.exec(presentation.name ?? '') ?? /^mcp:([^:]+):(.+)$/.exec(presentation.name ?? '')
  if (!match) return
  presentation.server ??= match[1]
  presentation.name = match[2]
  presentation.kind = 'mcp'
}
function terminal(state: ToolPresentationState): boolean { return state === 'completed' || state === 'failed' || state === 'canceled' }
function parseLegacyDetail(value: string | undefined): unknown {
  if (!value || value.length > 256 * 1024) return value
  try { return JSON.parse(value) } catch { return value }
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function defined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as Partial<T>
}
