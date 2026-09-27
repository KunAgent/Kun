import type { WorkerNotice } from '../contracts/ade.js'
import { reportLanguage, type ReportLanguage } from './user-report.js'

/**
 * Host-generated manager wake-up text (09 §6.2). One `<kun_worker_updates>`
 * block aggregates every pending notice into deterministic per-worker rows
 * so the manager can review, answer questions, or summarize without any
 * model-authored framing. Dynamic fields are XML-escaped; the renderer
 * parses rows back for the worker-update card.
 */
const KIND_LABEL: Record<WorkerNotice['kind'], Record<ReportLanguage, string>> = {
  dispatch_completed: { zh: '完成', en: 'Completed' },
  dispatch_failed: { zh: '失败', en: 'Failed' },
  dispatch_cancelled: { zh: '取消', en: 'Cancelled' },
  question: { zh: '提问', en: 'Question' },
  worker_released: { zh: '已释放', en: 'Released' },
  worker_detached: { zh: '已分离', en: 'Detached' },
  worker_taken_over: { zh: '用户接管', en: 'Taken over' },
  worker_handed_back: { zh: '已交还', en: 'Handed back' },
  worker_approval: { zh: '待审批', en: 'Approval needed' },
  review_completed: { zh: '审查完成', en: 'Review done' },
  team_budget: { zh: '预算提醒', en: 'Budget warning' },
  race_ready: { zh: '赛马就绪', en: 'Race ready' }
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function clipDetail(detail: string): string {
  return Array.from(detail.trim()).slice(0, 1_500).join('')
}

function noticeHeader(notice: WorkerNotice, language: ReportLanguage): string {
  const label = KIND_LABEL[notice.kind][language]
  const harness = notice.harnessLabel?.trim()
  const ref =
    notice.approvalId ?? notice.questionId ?? notice.dispatchId ?? notice.noticeId
  const name = escapeXml(notice.title)
  return `- [${label}] ${name}${harness ? `（${escapeXml(harness)}）` : ''}${ref ? ` ${escapeXml(ref)}` : ''}`
}

function noticeRows(notice: WorkerNotice, language: ReportLanguage): string[] {
  const zh = language === 'zh'
  const rows: string[] = []
  if (notice.capture) {
    const verdict = zh ? '待定' : 'pending'
    rows.push(zh
      ? `  改动：${notice.capture.changedFiles} 个文件 +${notice.capture.insertions} −${notice.capture.deletions}；验收：${verdict}`
      : `  changes: ${notice.capture.changedFiles} files +${notice.capture.insertions} −${notice.capture.deletions}; verdict: ${verdict}`)
  }
  const detail = notice.detail?.trim()
  if (detail) {
    if (notice.kind === 'question') {
      const options = notice.options?.length
        ? zh ? ` 选项：${notice.options.map(escapeXml).join(' / ')}` : ` options: ${notice.options.map(escapeXml).join(' / ')}`
        : ''
      rows.push(`${zh ? '  问题：' : '  question: '}${escapeXml(clipDetail(detail))}${options}`)
    } else {
      rows.push(`${zh ? '  worker 汇报：' : '  worker report: '}${escapeXml(clipDetail(detail))}`)
    }
  }
  return rows
}

export type RenderedWorkerUpdates = {
  /** Structured `<kun_worker_updates>` block used as the wake-up prompt. */
  prompt: string
  /** Short title surfaced in the UI instead of the raw block. */
  displayText: string
}

export function renderWorkerUpdates(
  notices: readonly WorkerNotice[],
  language: ReportLanguage | string | undefined
): RenderedWorkerUpdates {
  const lang = typeof language === 'string' ? reportLanguage(language) : (language ?? 'en')
  const lines = notices.flatMap((notice) => [noticeHeader(notice, lang), ...noticeRows(notice, lang)])
  return {
    prompt: ['<kun_worker_updates>', ...lines, '</kun_worker_updates>'].join('\n'),
    displayText: lang === 'zh'
      ? `${notices.length} 个 worker 有更新`
      : `${notices.length} worker update${notices.length === 1 ? '' : 's'}`
  }
}
