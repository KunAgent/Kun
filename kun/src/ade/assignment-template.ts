import type { DispatchRecord, WorkerRecord } from '../contracts/ade.js'
import type { TaskWorkspaceRecord } from '../contracts/task-workspace.js'
import type { ReportLanguage } from './user-report.js'

/**
 * The worker's first-turn input (09 §4.3). Rendered by the host from the
 * persisted dispatch/worker/workspace records — never model-authored. The
 * `<kun_assignment>` wrapper lets the renderer fold it into an
 * AssignmentCard while keeping the original text in history.
 */
export type AssignmentTemplateInput = {
  dispatch: DispatchRecord
  worker: WorkerRecord
  /** Task workspace record when the dispatch runs isolated; absent for 'local'. */
  workspace?: TaskWorkspaceRecord | null
  /** Manager display name in the `from` attribute; defaults by language. */
  managerLabel?: string
  /** Template language — follows the manager thread's UI locale. */
  language?: ReportLanguage
}

const SETUP_LABELS_EN: Record<string, string> = {
  pending: 'pending (not run yet)',
  running: 'running',
  ready: 'completed',
  failed: 'FAILED — inspect the workspace before relying on dependencies',
  skipped: 'skipped (no setup steps declared)',
  'not-approved': 'skipped (setup steps not approved)'
}
const SETUP_LABELS_ZH: Record<string, string> = {
  pending: '未执行',
  running: '进行中',
  ready: '已完成',
  failed: '失败——依赖不可用前先检查工作区',
  skipped: '跳过（未声明安装步骤）',
  'not-approved': '跳过（安装步骤未获批准）'
}

const CONTEXT_TITLES = {
  en: { files: 'Files', links: 'Links', constraints: 'Constraints', notes: 'Notes' },
  zh: { files: '文件', links: '链接', constraints: '约束', notes: '备注' }
} as const

function contextLines(dispatch: DispatchRecord, language: ReportLanguage): string[] {
  const context = dispatch.context
  if (!context) return []
  const titles = CONTEXT_TITLES[language]
  const lines: string[] = []
  if (context.files?.length) {
    lines.push(`${titles.files}:\n${context.files.map((f) => `- ${f}`).join('\n')}`)
  }
  if (context.links?.length) {
    lines.push(`${titles.links}:\n${context.links.map((l) => `- ${l}`).join('\n')}`)
  }
  if (context.constraints?.length) {
    lines.push(`${titles.constraints}:\n${context.constraints.map((c) => `- ${c}`).join('\n')}`)
  }
  if (context.notes?.trim()) lines.push(`${titles.notes}:\n${context.notes.trim()}`)
  return lines
}

function startFromLabel(startFrom: TaskWorkspaceRecord['startFrom'], language: ReportLanguage): string {
  const zh = language === 'zh'
  switch (startFrom.kind) {
    case 'default-branch': return zh ? '默认分支' : 'default branch'
    case 'current-head': return zh ? '当前 HEAD' : 'current HEAD'
    case 'branch': return zh ? `分支 ${startFrom.name}` : `branch ${startFrom.name}`
    case 'commit': return zh ? `提交 ${startFrom.sha.slice(0, 12)}` : `commit ${startFrom.sha.slice(0, 12)}`
    case 'remote-branch':
      return zh ? `远端分支 ${startFrom.remote}/${startFrom.name}` : `remote branch ${startFrom.remote}/${startFrom.name}`
    case 'change-request':
      return zh ? `变更请求 #${startFrom.number}` : `change request #${startFrom.number}`
  }
}

function workspaceLines(input: AssignmentTemplateInput, language: ReportLanguage): string[] {
  const workspace = input.workspace
  if (!workspace) return []
  const setup = (language === 'zh' ? SETUP_LABELS_ZH : SETUP_LABELS_EN)[workspace.setup.status]
    ?? workspace.setup.status
  if (language === 'zh') {
    return [
      `路径：${workspace.path}`,
      ...(workspace.branch ? [`分支：${workspace.branch}`] : []),
      `起点：${startFromLabel(workspace.startFrom, language)}`,
      `依赖安装：${setup}`
    ]
  }
  return [
    `Path: ${workspace.path}`,
    ...(workspace.branch ? [`Branch: ${workspace.branch}`] : []),
    `Start point: ${startFromLabel(workspace.startFrom, language)}`,
    `Dependency setup: ${setup}`
  ]
}

/**
 * Callback channel wording (09 §4.3): workers on the native loop see the
 * tools directly; external harnesses reach the same tools through the Kun
 * MCP bridge, where client-side prefixes may decorate the names.
 */
function collaborationLines(worker: WorkerRecord, language: ReportLanguage): string[] {
  const bridged = worker.route.harnessId !== 'kun'
  if (language === 'zh') {
    const via = bridged ? '通过 Kun MCP server（kun）调用同名工具' : '调用'
    return [
      `- 需要做决定、而任务说明没有覆盖时：${via} \`ask_manager\`。`,
      `- 阶段性进展：${via} \`report_progress\`。`,
      `- 完成时（或无法恢复地受阻时）：${via} \`submit_result\`。`,
      `- 需要总管这边的更早上下文：${via} \`read_manager_context\`。`
    ]
  }
  const via = bridged ? ' via the `kun` MCP server (same tool names)' : ''
  return [
    `- If you need a decision the task brief does not cover: call \`ask_manager\`${via}.`,
    `- Report meaningful progress phases: call \`report_progress\`${via}.`,
    `- When finished (or blocked past recovery): call \`submit_result\`${via}.`,
    `- To read earlier manager-thread context: call \`read_manager_context\`${via}.`
  ]
}

export function renderAssignment(input: AssignmentTemplateInput): string {
  const { dispatch, worker, workspace } = input
  const language = input.language ?? 'en'
  const zh = language === 'zh'
  const from = input.managerLabel?.trim() || (zh ? '总管' : 'Manager')
  const context = contextLines(dispatch, language)
  const sections = [
    `${zh ? '## 任务' : '## Task'}\n${dispatch.task.trim()}`,
    ...(context.length
      ? [`${zh ? '## 背景与约束' : '## Context'}\n${context.join('\n\n')}`]
      : []),
    ...(workspace
      ? [`${zh ? '## 工作区' : '## Workspace'}\n${workspaceLines(input, language).join('\n')}`]
      : []),
    `${zh ? '## 协作方式' : '## Collaboration'}\n${collaborationLines(worker, language).join('\n')}`
  ]
  return `<kun_assignment dispatch="${dispatch.dispatchId}" worker="${worker.workerId}" from="${from}">\n${sections.join('\n\n')}\n</kun_assignment>`
}
