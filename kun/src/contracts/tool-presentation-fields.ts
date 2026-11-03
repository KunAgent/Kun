import type { ToolPresentation, ToolPresentationSearchResult } from './tool-presentation.js'
import { boundedToolPresentationContent } from './tool-presentation-content.js'
import { boundToolPresentation } from './tool-presentation-bounds.js'

/** Read-only normalization of established native/ACP evidence field names. */
export function toolPresentationFields(kind: string, input: unknown, output: unknown): Partial<ToolPresentation> {
  const args = record(input)
  const result = record(output)
  const filePath = string(args, 'file_path', 'filePath', 'path', 'file') ?? string(result, 'path', 'filePath', 'file_path')
  const locations = list(args.locations ?? result.locations).flatMap((item) => {
    const path = string(item, 'path', 'filePath', 'file_path')
    return path ? [{ path, ...numberField('line', item.line ?? item.line_number), ...numberField('endLine', item.endLine) }] : []
  })
  const diffs = list(result.diffs).flatMap((item) => {
    const path = string(item, 'path')
    return path && typeof item.newText === 'string' ? [{ path,
      oldText: typeof item.oldText === 'string' ? item.oldText : null, newText: item.newText }] : []
  })
  const results: ToolPresentationSearchResult[] = list(result.matches ?? result.results ?? result.hits).map((item) => ({
    path: string(item, 'path', 'file', 'filePath', 'file_path'),
    ...numberField('line', item.line ?? item.lineNumber ?? item.line_number),
    text: string(item, 'text', 'lineText', 'line_text', 'content', 'snippet'),
    url: string(item, 'url', 'uri'), title: string(item, 'title', 'name')
  }))
  const read = /^(read|read_file|read_text_file|fs\.read)$/i.test(kind)
  const edit = /^(edit|write|write_file|apply_patch|file_change)$/i.test(kind)
  const fetch = /^(fetch|web_fetch|fetch_url|http_request)$/i.test(kind)
  const nestedResult = record(result.result)
  const fields: Partial<ToolPresentation> = {
    filePath,
    command: string(args, 'command', 'cmd', 'script') ?? string(result, 'command', 'cmd'),
    cwd: string(args, 'cwd', 'workdir', 'working_directory') ?? string(result, 'cwd', 'workdir'),
    query: string(args, 'query', 'pattern', 'search') ?? string(result, 'query', 'pattern'),
    url: string(args, 'url', 'uri') ?? string(result, 'url', 'uri'),
    statusCode: numeric(result.statusCode ?? result.status_code ?? result.httpStatus ?? result.status),
    offset: numeric(args.offset ?? args.start_line ?? args.startLine),
    limit: numeric(args.limit ?? args.max_lines ?? args.maxLines),
    line: numeric(result.start_line ?? args.line ?? args.start_line ?? (read ? args.offset : undefined)),
    fileContent: read ? (typeof output === 'string' ? output : string(result, 'content', 'text'))
      : edit ? string(result, 'newText', 'after', 'content') : undefined,
    patch: string(result, 'patch'),
    server: string(args, 'server', 'serverId', 'serverName', 'server_id') ?? string(result, 'server', 'serverId', 'serverName', 'server_id'),
    text: typeof output === 'string' ? output : fetch ? string(result, 'text', 'content', 'body', 'output')
      : string(result, 'text', 'stdout', 'output'),
    ...(typeof result.serverId === 'string' && typeof result.toolName === 'string' ? { name: result.toolName } : {}),
    error: string(result, 'error'),
    durationMs: numeric(result.durationMs ?? result.duration_ms),
    ...(result.truncated === true || result.has_more === true || [args.locations, result.locations, result.diffs, result.matches, result.results, result.hits]
      .some((value) => Array.isArray(value) && value.length > 200) ? { truncated: true } : {}),
    ...(locations.length ? { locations } : filePath ? { locations: [{ path: filePath, ...numberField('line', args.line ?? args.start_line) }] } : {}),
    ...(diffs.length ? { diffs } : {}),
    ...(results.length ? { results } : {}),
    ...boundedToolPresentationContent(result.content ?? nestedResult.content ??
      (Array.isArray(nestedResult.contents) ? nestedResult.contents.map((resource) => ({ type: 'resource', resource })) : undefined))
  }
  const command = fields.command
  const terminalOutput = string(result, 'stdout', 'output', 'text')
  const exitCode = numeric(result.exitCode ?? result.exit_code)
  const signal = string(result, 'signal')
  if ((command || /^(bash|shell|execute|command_execution|exec_command)$/i.test(kind)) &&
    (terminalOutput !== undefined || exitCode !== undefined || signal !== undefined)) {
    fields.terminals = [{ terminalId: string(result, 'session_id', 'terminalId') ?? 'output',
      command, cwd: fields.cwd, output: terminalOutput ?? '', exitCode, signal }]
  }
  return boundToolPresentation(defined(fields))
}

export function toolPresentationKind(name: string, explicit?: string): string {
  if (name.startsWith('acp:')) return name.slice(4)
  if (/^(mcp[:_]|mcp__)/i.test(name)) return 'mcp'
  if (/^(read|read_file|read_text_file)$/i.test(name)) return 'read'
  if (/^(grep|rg|search|find|glob|web_search|search_web)$/i.test(name)) return 'search'
  if (/^(fetch|fetch_url|web_fetch|http_request)$/i.test(name)) return 'fetch'
  if (/^(bash|shell|exec_command|write_stdin|terminal)$/i.test(name) || explicit === 'command_execution') return 'execute'
  if (/^(write|edit|apply_patch|write_file|edit_file)$/i.test(name) || explicit === 'file_change') return 'edit'
  return name || explicit || 'other'
}

export function boundedToolValue(value: unknown, limit = 64 * 1024): unknown {
  if (value === undefined) return undefined
  try {
    const serialized = JSON.stringify(value)
    return serialized.length <= limit ? value : { truncated: true, preview: serialized.slice(0, limit) }
  } catch { return { omitted: true } }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function list(value: unknown): Record<string, unknown>[] { return Array.isArray(value) ? value.slice(0, 200).map(record) : [] }
function string(value: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) if (typeof value[key] === 'string') return value[key] as string
  return undefined
}
function numeric(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function numberField<K extends string>(key: K, value: unknown): Partial<Record<K, number>> {
  return numeric(value) === undefined ? {} : { [key]: value } as Record<K, number>
}
function defined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T
}
