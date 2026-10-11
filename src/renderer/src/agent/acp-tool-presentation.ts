import type { CoreTurnItemJson } from './kun-contract'

/** Normalize both current sideband evidence and older ACP arguments/results. */
export function acpToolPresentation(item: CoreTurnItemJson): {
  meta: Record<string, unknown>; filePath?: string; command?: string
} | undefined {
  if (!item.toolName?.startsWith('acp:')) return undefined
  const side = record(item.meta?.delegatedTool)
  const args = record(item.arguments)
  const output = record(item.output)
  const rawInput = record(side.input ?? args.rawInput)
  const locations = Array.isArray(args.locations) ? args.locations : []
  const diffs = Array.isArray(side.diffs) ? side.diffs : Array.isArray(output.diffs) ? output.diffs : undefined
  const path = string(side.filePath) ?? string(rawInput.file_path ?? rawInput.filePath ?? rawInput.path ?? rawInput.file)
    ?? string(record(locations[0]).path) ?? string(record(diffs?.[0]).path) ?? string(args.path)
  const command = string(side.command) ?? string(rawInput.command ?? rawInput.cmd)
  const meta: Record<string, unknown> = {
    acpKind: string(side.kind) ?? string(args.kind) ?? item.toolName.slice(4),
    acpTitle: string(side.title) ?? string(args.title),
    acpInput: side.input ?? args.rawInput,
    acpOutput: side.output,
    acpText: string(side.text) ?? (item.kind === 'tool_result' && typeof item.output === 'string' ? item.output : string(output.text)),
    acpFileContent: string(side.fileContent), acpDiffs: diffs,
    acpTerminals: Array.isArray(side.terminals) ? side.terminals : undefined,
    acpTruncated: side.truncated,
    command, cwd: string(side.cwd) ?? string(rawInput.cwd),
    pattern: string(side.query) ?? string(rawInput.query ?? rawInput.pattern),
    acpLine: typeof side.line === 'number' ? side.line : undefined
  }
  return { meta: Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined)), filePath: path, command }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length ? value : undefined
}
