import type { DispatchRecord, WorkerRecord } from '../contracts/ade.js'
import type { PermissionClamp } from './permission-clamp.js'

/**
 * Fixed-sentence `userReport` strings for manager tools (09 §4.4). The
 * manager relays these to the user verbatim — they must never contain model
 * speculation, only facts the host knows. Language follows the manager
 * thread's UI locale; unknown values fall back to English.
 */
export type ReportLanguage = 'en' | 'zh'

export function reportLanguage(locale: string | undefined): ReportLanguage {
  return locale?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

type CreatedInput = {
  worker: Pick<WorkerRecord, 'label' | 'route' | 'permissionMode'>
  dispatch: DispatchRecord
  /** Why the dispatch is not yet running: 'workspace' | 'worker-busy'. */
  pendingReason?: 'workspace' | 'worker-busy'
  permission: Pick<PermissionClamp, 'downgraded' | 'requestedMode'>
  harnessLabel?: string
}

function harnessName(input: CreatedInput): string {
  return input.harnessLabel?.trim() || input.worker.route.harnessId
}

export function reportWorkerCreated(input: CreatedInput, language: ReportLanguage): string {
  const engine = `${harnessName(input)} · ${input.worker.route.model}`
  if (language === 'zh') {
    const base = `已为「${input.worker.label}」创建 worker（${engine}）`
    const pending = input.pendingReason === 'workspace'
      ? '，工作区正在准备，就绪后自动开始。'
      : input.pendingReason === 'worker-busy'
        ? '，该 worker 正忙，本轮结束后自动开始。'
        : '，已派出。'
    const downgrade = input.permission.downgraded
      ? `请求的权限档 ${input.permission.requestedMode?.id ?? ''} 超出总管权限，已按 ${input.worker.permissionMode} 运行。`
      : ''
    return base + pending + downgrade
  }
  const base = `Created worker "${input.worker.label}" (${engine})`
  const pending = input.pendingReason === 'workspace'
    ? '; the workspace is being prepared and the dispatch will start automatically when ready.'
    : input.pendingReason === 'worker-busy'
      ? '; the worker is busy and the dispatch starts when its current turn ends.'
      : '; dispatched.'
  const downgrade = input.permission.downgraded
    ? ` The requested permission mode ${input.permission.requestedMode?.id ?? ''} exceeds the manager's authority; running at ${input.worker.permissionMode}.`
    : ''
  return base + pending + downgrade
}

export type BatchReportInput = {
  created: number
  failed: number
  skipped: number
  /** True when at least one created dispatch is already running. */
  dispatched: number
}

export function reportWorkerCreateBatch(input: BatchReportInput, language: ReportLanguage): string {
  if (language === 'zh') {
    if (input.created === 0) {
      return `没有创建任何 worker（失败 ${input.failed}，跳过 ${input.skipped}）。没有派出任何任务，请直接告诉用户原因。`
    }
    return `已创建 ${input.created} 个 worker，其中 ${input.dispatched} 个已派出` +
      (input.failed ? `，${input.failed} 个失败` : '') +
      (input.skipped ? `，${input.skipped} 个跳过` : '') + '。'
  }
  if (input.created === 0) {
    return `No workers were created (${input.failed} failed, ${input.skipped} skipped). Nothing was dispatched — tell the user why.`
  }
  return `Created ${input.created} worker(s), ${input.dispatched} dispatched` +
    (input.failed ? `, ${input.failed} failed` : '') +
    (input.skipped ? `, ${input.skipped} skipped` : '') +
    '.'
}
