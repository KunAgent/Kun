import type { ToolPresentation, ToolPresentationDiff } from '@shared/tool-presentation'
import type { CoreApprovalActionJson } from '../../agent/kun-contract-approval'

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined

/*
 * Edit-shaped arguments: ACP `changes` / `diffs`, one replacement
 * (`oldText`/`newText`, `old_string`/`new_string`), several replacements in
 * one file (`edits: [...]`) or a whole-file write (`content`, no old text).
 */
function approvalDiffs(
  input: Record<string, unknown>,
  raw: Record<string, unknown>,
  filePath: string | undefined
): ToolPresentationDiff[] {
  const sources = Array.isArray(input.changes) ? input.changes
    : Array.isArray(raw.diffs) ? raw.diffs
      : Array.isArray(raw.edits) ? raw.edits.map((edit) => ({ ...record(edit), path: filePath }))
        : [raw]
  const diffs = sources.flatMap((value): ToolPresentationDiff[] => {
    const diff = record(value)
    const path = text(diff.path ?? diff.filePath ?? diff.file_path) ?? filePath
    const newText = diff.newText ?? diff.newString ?? diff.new_string
    const oldText = diff.oldText ?? diff.oldString ?? diff.old_string
    return path && typeof newText === 'string'
      ? [{ path, newText, oldText: typeof oldText === 'string' ? oldText : null }] : []
  })
  if (diffs.length || !filePath || typeof raw.content !== 'string') return diffs
  return [{ path: filePath, newText: raw.content, oldText: null }]
}

/** Only consume the runtime's bounded, credential-redacted approval envelope. */
export function approvalToolPresentation(action: CoreApprovalActionJson | undefined): ToolPresentation | null {
  if (!action) return null
  const input = action.arguments ?? {}
  const raw = record(input.rawInput ?? input)
  const targets = action.targets ?? []
  const filePath = targets.find((target) => target.kind === 'file')?.value ?? text(raw.path ?? raw.filePath ?? raw.file_path)
  const command = targets.find((target) => target.kind === 'command')?.value ?? text(raw.command ?? raw.cmd)
  const diffs = approvalDiffs(input, raw, filePath)
  return {
    version: 1, kind: diffs.length ? 'edit' : action.kind === 'command' ? 'shell' : action.kind === 'file' ? 'read' : action.kind === 'network' ? 'fetch' : 'unknown',
    state: 'pending', canCancel: false, source: action.toolName?.startsWith('acp:') ? 'acp' : 'native',
    name: action.toolName, input, command, filePath, cwd: action.cwd ?? action.workspace,
    ...(input.__truncated__ === true ? { truncated: true } : {}),
    ...(diffs.length ? { diffs } : {}),
    url: targets.find((target) => target.kind === 'url')?.value ?? text(raw.url),
    locations: targets.filter((target) => target.kind === 'file').map((target) => ({ path: target.value }))
  }
}
