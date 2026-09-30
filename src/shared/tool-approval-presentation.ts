import type { ApprovalRequest } from '../../kun/src/domain/approval'
import { roomApprovalCopy } from './room-approval-presentation'

/** Runtime-authored targets are the scope; argument previews are supplemental. */
export function toolApprovalPresentation(approval: ApprovalRequest, title: string, zh: boolean) {
  const copy = roomApprovalCopy(zh)
  const action = approval.action
  const changesFiles = action?.kind === 'file' &&
    (action.toolKind === 'file_change' || ['write', 'edit', 'apply_patch'].includes(approval.toolName))
  const labels = zh
    ? { command: '命令', file: '文件', url: '网址', recipient: '接收方', mcp: '连接工具', resource: '资源' }
    : { command: 'Command', file: 'File', url: 'URL', recipient: 'Recipient', mcp: 'Connected tool', resource: 'Resource' }
  const targets = action?.targets ?? []
  const reason = action?.reason ?? approval.summary
  const description = reason === 'runtime tool policy requires approval'
    ? zh ? '确认后，Agent 将执行下面的操作。' : 'The Agent will perform this action after you confirm.'
    : reason
  const body = targets.length === 1 ? targets[0]!.value : targets.length
    ? targets.map((target) => `${labels[target.kind]}\n${target.value}`).join('\n\n')
    : approval.summary
  const workspace = action?.cwd && action.cwd !== action.workspace
    ? `${action.cwd}\n${zh ? '工作区' : 'Workspace'}: ${action.workspace}`
    : action?.cwd ?? action?.workspace
  return {
    kind: action?.kind ?? 'unknown',
    title: changesFiles ? zh ? '修改文件' : 'Modify files' : copy[action?.kind ?? 'unknown'],
    subtitle: `${title || 'Kun'} · ${approval.toolName}`,
    description,
    body,
    bodyLabel: targets.length === 1 ? labels[targets[0]!.kind] : zh ? '操作范围' : 'Action scope',
    workspace,
    workspaceLabel: copy.workspace,
    ...(action && Object.keys(action.arguments).length ? {
      details: JSON.stringify(action.arguments, null, 2),
      detailsLabel: zh ? '补充参数（可能经过缩略）' : 'Additional arguments (may be shortened)'
    } : {}),
    footnote: copy.once,
    cancelLabel: copy.cancel,
    language: zh ? 'zh' as const : 'en' as const
  }
}
