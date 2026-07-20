/**
 * [INPUT]: 依赖 SynthesisWriterInput 和 SynthesisWriterSupport 的 claim 清理能力
 * [OUTPUT]: 对外提供 quick diagnostic 报告的最低长度估算与补充模板
 * [POS]: research/agents 的 quick/debug 专用辅助模块，不得进入 standard/deep 用户可见报告
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { SynthesisWriterInput } from './types.js'
import {
  claimsForPrompt,
  cleanClaimForPrompt,
  MIN_DETAILED_REPORT_CHARS,
  usableClaimsForSynthesis
} from './SynthesisWriterSupport.js'

export function minDiagnosticReportChars(input: SynthesisWriterInput): number {
  const usableClaims = claimsForPrompt(input)
  const usableSpanIds = new Set(usableClaims.flatMap((claim) => claim.supportSpanIds))
  const usableSourceCount = new Set(input.evidenceSpans
    .filter((span) => usableSpanIds.has(span.id))
    .map((span) => span.sourceId)).size
  if (usableClaims.length < 4 || usableSourceCount < 3) return input.budget.preset === 'quick' ? 900 : 1_000
  const base = input.frame.coreQuestions.length >= 3 ? MIN_DETAILED_REPORT_CHARS : 1_200
  const questionWeight = input.frame.coreQuestions.length * 260
  const taskWeight = Math.min(360, input.plan.tasks.length * 60)
  const evidenceWeight = Math.min(700, input.evidenceSpans.length * 90)
  return Math.min(1_600, Math.max(base, 650 + questionWeight + taskWeight + evidenceWeight))
}

export function countMeaningfulChars(markdown: string): number {
  return markdown
    .replace(/<[^>]+>/g, '')
    .replace(/\[claim:[^\]]+\]/g, '')
    .replace(/[`*_#[\](){}|>~\-\s:：，。、；;,.!?！？]/g, '')
    .length
}

export function extendDiagnosticReportIfNeeded(
  lines: string[],
  input: SynthesisWriterInput,
  usedClaimIds: string[]
): void {
  if (countMeaningfulChars(lines.join('\n')) >= minDiagnosticReportChars(input)) return
  lines.push('', '## 补充分析框架', '')
  lines.push('以下内容仅整理现有证据覆盖和缺口，不构成正式 DeepResearch 结论。')
  lines.push('')

  const usableClaims = usableClaimsForSynthesis(input)
  const usableClaimIds = new Set(usableClaims.map((claim) => claim.id))
  const leadClaim = usableClaims[0]
  for (const task of input.plan.tasks.slice(0, 6)) {
    const relatedQuestions = input.frame.coreQuestions.filter((question) => task.questionIds.includes(question.id))
    const relatedNotes = input.notes.filter((note) => note.taskId === task.id || note.questionIds.some((id) => task.questionIds.includes(id)))
    const questionText = relatedQuestions.map((question) => question.text).join('；') || task.objective
    lines.push(`### ${questionText}`, '')
    if (relatedNotes.length > 0) {
      const noteText = relatedNotes.map((note) => note.implicationForBrief).join('；')
      const claimId = relatedNotes.flatMap((note) => note.claimIds).find((id) => usableClaimIds.has(id))
      lines.push(`${cleanClaimForPrompt(noteText)}${claimId ? ` [claim:${claimId}]` : ''}。`)
      if (claimId) usedClaimIds.push(claimId)
    } else if (leadClaim) {
      lines.push(`当前任务没有独立证据，只能暂时关联已有论断：${leadClaim.text} [claim:${leadClaim.id}]。`)
      usedClaimIds.push(leadClaim.id)
    }
    lines.push('')
    if (countMeaningfulChars(lines.join('\n')) >= minDiagnosticReportChars(input)) break
  }
}
