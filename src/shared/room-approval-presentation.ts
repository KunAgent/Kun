import type { ApprovalRequest } from '../../kun/src/domain/approval'
export type RoomApprovalView = Pick<ApprovalRequest, 'id' | 'toolName' | 'summary'> & Partial<Pick<ApprovalRequest, 'action'>>
export function roomApprovalPresentation(approval: RoomApprovalView) {
  const action = approval.action
  const command = typeof action?.arguments.command === 'string' ? action.arguments.command :
    action?.targets.find((target) => target.kind === 'command')?.value
  return { kind: action?.kind ?? 'unknown', tool: approval.toolName,
    workspace: action?.cwd ?? action?.workspace,
    content: (command || (action && Object.keys(action.arguments).length ? JSON.stringify(action.arguments, null, 2) : undefined) || action?.targets.map((target) => target.value).join('\n') || approval.summary).slice(0, 12000),
    details: action?.reason ?? approval.summary }
}
export const roomApprovalCopy = (zh: boolean) => zh ? {
  title: '需要你确认', command: '运行命令', file: '访问文件', network: '网络操作', mcp: '调用连接工具',
  'external-effect': '执行外部操作', unknown: '执行操作', workspace: '作用目录', details: '更多信息',
  allow: '允许一次', deny: '拒绝执行', cancel: '取消', once: '仅决定本次操作，不改变后续权限。',
  changeTitle: '更改此会话的权限', apply: '应用设置', next: '用于之后发送的新消息；当前运行保持原权限。',
  modes: { 'ask-for-approval': '请求审批', 'approve-for-me': '替我审批', 'full-access': '完全访问' },
  full: '允许此 Agent 无需逐次审批地访问本地文件、执行命令和使用联网工具。',
  auto: '由审批模型检查需要确认的操作；审批失败时不会自动放行。', ask: '需要审批的操作会等待你确认。'
} : {
  title: 'Your confirmation is needed', command: 'Run command', file: 'Access files', network: 'Network action', mcp: 'Use connected tool',
  'external-effect': 'External action', unknown: 'Run action', workspace: 'Working directory', details: 'Details',
  allow: 'Allow once', deny: 'Deny action', cancel: 'Cancel', once: 'Applies only to this action. Future permissions stay unchanged.',
  changeTitle: 'Change conversation permissions', apply: 'Apply settings', next: 'Applies to new messages. Current runs keep their accepted permissions.',
  modes: { 'ask-for-approval': 'Ask for approval', 'approve-for-me': 'Approve for me', 'full-access': 'Full access' },
  full: 'Allow this Agent to access local files, run commands and use network tools without individual approvals.',
  auto: 'The approval model reviews actions. Failed reviews do not allow execution.', ask: 'Actions that need approval wait for your confirmation.'
}
