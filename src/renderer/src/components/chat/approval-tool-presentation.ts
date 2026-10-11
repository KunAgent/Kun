import type { ToolPresentation, ToolPresentationDiff } from '@shared/tool-presentation'
import type { CoreApprovalActionJson } from '../../agent/kun-contract-approval'

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined

/** Only consume the runtime's bounded, credential-redacted approval envelope. */
export function approvalToolPresentation(action: CoreApprovalActionJson | undefined): ToolPresentation | null {
  if (!action) return null
  const input = action.arguments ?? {}
  const raw = record(input.rawInput ?? input)
  const targets = action.targets ?? []
  const filePath = targets.find((target) => target.kind === 'file')?.value ?? text(raw.path ?? raw.filePath ?? raw.file_path)
  const command = targets.find((target) => target.kind === 'command')?.value ?? text(raw.command ?? raw.cmd)
  const diffSources = Array.isArray(input.changes) ? input.changes : Array.isArray(raw.diffs) ? raw.diffs : [raw]
  const diffs = diffSources.flatMap((value): ToolPresentationDiff[] => {
    const diff = record(value)
    const path = text(diff.path ?? diff.filePath) ?? filePath
    const newText = diff.newText ?? diff.newString ?? diff.new_string
    const oldText = diff.oldText ?? diff.oldString ?? diff.old_string
    return path && typeof newText === 'string'
      ? [{ path, newText, oldText: typeof oldText === 'string' ? oldText : null }] : []
  })
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
