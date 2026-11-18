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
  return { ...acpToolTargets(p),
    ...(mcp ? { kind: 'mcp', server: mcp[1], name: mcp[2] } : {}),
    ...(summary ? { title: summary.slice(0, 4096) } : {})
  }
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
