import type { ToolPresentation } from './tool-presentation.js'

/** Normalize Agent-reported display metadata, including snapshots saved by older Kun versions. */
export function acpToolDisplay(p: ToolPresentation): ToolPresentation {
  if (p.source !== 'acp') return p
  const input = p.input && typeof p.input === 'object' ? p.input as Record<string, unknown> : {}
  const summary = typeof input.toolSummary === 'string' ? input.toolSummary.trim() : ''
  const name = p.name && !p.name.startsWith('acp:') ? p.name : /^Run (mcp\S+)$/u.exec(p.title ?? '')?.[1]
  // Antigravity flattens Kun's own MCP descriptor using a single underscore.
  // Other server/tool names containing underscores are opaque; never guess their split.
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name ?? '') ?? /^mcp:([^:]+):(.+)$/.exec(name ?? '')
    ?? /^mcp_(kun-tools(?:_[a-f0-9]{8})?)_(.+)$/.exec(name ?? '')
  const targets = acpToolTargets(p)
  // Some agents (notably DeepSeek Harness) put only a bare tool id in the
  // title and send `other` for every call. Use an exact id and matching
  // arguments for presentation; never use prose or change the wire kind.
  const id = name ?? p.title
  let kind: string | undefined
  if (p.kind === 'other' && !mcp) {
    if ((id === 'bash' || id === 'shell' || id === 'exec_command') && targets.command) kind = 'execute'
    else if ((id === 'read' || id === 'read_file' || id === 'read_image') && targets.filePath) kind = 'read'
    else if ((id === 'write' || id === 'write_file') && targets.filePath && typeof input.content === 'string') kind = 'edit'
    else if ((id === 'edit' || id === 'edit_file') && targets.filePath &&
      typeof input.old_string === 'string' && typeof input.new_string === 'string') kind = 'edit'
    else if ((id === 'glob' || id === 'grep' || id === 'search_files') && targets.query) kind = 'search'
  }
  const displayTitle = summary || executeDescriptionTitle(kind ?? p.kind, p.title, name, targets.command, input.description)
  return { ...targets,
    ...(mcp ? { kind: 'mcp', server: mcp[1], name: mcp[2] } : kind ? { kind, name: id } : {}),
    ...(displayTitle ? { title: displayTitle.slice(0, 4096) } : {})
  }
}

const BARE_EXECUTE_IDS = new Set(['bash', 'shell', 'exec_command'])

/** Agents like Qoder stuff the full shell command into `title` even when `rawInput.description` has a concise label. */
function executeDescriptionTitle(
  effectiveKind: string,
  rawTitle: string | undefined,
  explicitName: string | undefined,
  command: string | undefined,
  description: unknown
): string {
  if (effectiveKind !== 'execute' || typeof description !== 'string') return ''
  const desc = description.trim()
  if (!desc) return ''
  const trimmedTitle = (rawTitle ?? '').trim()
  if (!trimmedTitle || trimmedTitle === explicitName || BARE_EXECUTE_IDS.has(trimmedTitle)) return desc
  if (!command) return ''
  const unquoted = trimmedTitle.startsWith('`') && trimmedTitle.endsWith('`') && trimmedTitle.length >= 2
    ? trimmedTitle.slice(1, -1).trim()
    : trimmedTitle
  if (unquoted === command.trim()) return desc
  if (rawTitle && rawTitle.endsWith('...') && rawTitle.length > 3 && command.startsWith(rawTitle.slice(0, -3))) {
    return desc
  }
  return ''
}

/** Keep the original wire name/title in the runtime; path and command are also
 * used there to attribute mediated filesystem/terminal evidence. */
export function acpToolTargets(p: ToolPresentation): ToolPresentation {
  const input = p.input && typeof p.input === 'object' ? p.input as Record<string, unknown> : {}
  return { ...p,
    ...(!p.filePath && typeof input.Path === 'string' ? { filePath: input.Path } : {}),
    ...(p.line === undefined && Number.isInteger(input.StartLine) ? { line: input.StartLine as number } : {}),
    ...(!p.command && typeof input.CommandLine === 'string' ? { command: input.CommandLine } : {}),
    ...(!p.cwd && typeof input.Cwd === 'string' ? { cwd: input.Cwd } : {})
  }
}

export function hasToolOutput(p: ToolPresentation): boolean {
  return p.output != null && (typeof p.output !== 'string' || Boolean(p.output.trim()))
}

/** Input/target metadata alone is not evidence that the Agent returned a result. */
export function hasAcpResult(p: ToolPresentation): boolean {
  return hasToolOutput(p) || p.fileContent !== undefined || Boolean((typeof p.text === 'string' && p.text.trim()) ||
    (typeof p.error === 'string' && p.error.trim()) || p.patch ||
    p.diffs?.length || p.terminals?.length || p.results?.length || p.content?.length)
}
