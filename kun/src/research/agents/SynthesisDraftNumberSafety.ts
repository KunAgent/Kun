/**
 * [INPUT]: 依赖 SynthesisWriterInput 中的用户明确数量范围、Markdown 表格行、句级 claim/structured-claim 引用占位符和数字事实一致性校验
 * [OUTPUT]: 对外提供正文及表格数字断言和重试稿无证据数字句/表格行安全删除，用户范围数字只在明确证据不足边界句中保留，成品中英译写允许同币种金额数学等价表达，禁止用户问题或同行其他引用替正向事实数字背书
 * [POS]: research/agents 的 Writer 数字安全层，被 SynthesisWriter 与 ResearchEditor 复用，按句绑定支持文本且表格数据行不能绕过校验
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { isUserScopeNumericBoundary, unsupportedTranslatedNumericTokens } from '../evidence/ClaimSupport.js'
import { isMarkdownTableDataRow, splitCitationSentences } from '../evidence/CitationProximity.js'
import type { SynthesisWriterInput } from './types.js'

export function assertSupportedDraftNumbers(markdown: string, input: SynthesisWriterInput): void {
  const claimById = new Map(input.claims.map((claim) => [claim.id, claim]))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const lines = markdown.split('\n')
  const unsupported = [...new Set(lines.flatMap((line, index) => {
    const tableDataRow = isMarkdownTableDataRow(lines, index)
    if (!/\[(?:claim|structured-claim|evidence):/.test(line) && !tableDataRow) return []
    const units = tableDataRow ? [line] : splitCitationSentences(line)
    return units.flatMap((unit) => unsupportedDraftNumericTokens(
      unit,
      supportTextsForDraftLine(unit, claimById, spanById),
      input
    ))
  }))]
  if (unsupported.length > 0) {
    throw new Error(`report contains unsupported numeric tokens: ${unsupported.join(', ')}`)
  }
}

export function sanitizeUnsupportedDraftNumbers(markdown: string, input: SynthesisWriterInput): string {
  const claimById = new Map(input.claims.map((claim) => [claim.id, claim]))
  const spanById = new Map(input.evidenceSpans.map((span) => [span.id, span]))
  const sourceLines = markdown.split('\n')
  const lines = sourceLines.map((line, index) => {
    const tableDataRow = isMarkdownTableDataRow(sourceLines, index)
    if (!/\[(?:claim|structured-claim|evidence):/.test(line) && !tableDataRow) return line
    if (tableDataRow) {
      const supportTexts = supportTextsForDraftLine(line, claimById, spanById)
      return unsupportedDraftNumericTokens(line, supportTexts, input).length === 0 ? line : ''
    }
    return splitCitationSentences(line)
      .filter((segment) => unsupportedDraftNumericTokens(
        segment,
        supportTextsForDraftLine(segment, claimById, spanById),
        input
      ).length === 0)
      .join('')
      .trim()
  })
  return lines.filter((line, index) => {
    if (line.trim() !== '') return true
    return index === 0 || lines[index - 1]?.trim() !== ''
  }).join('\n').trim()
}

function supportTextsForDraftLine(
  line: string,
  claimById: Map<string, SynthesisWriterInput['claims'][number]>,
  spanById: Map<string, SynthesisWriterInput['evidenceSpans'][number]>
): string[] {
  const claimIds = [...line.matchAll(/\[(?:claim|structured-claim):([^\]]+)\]/g)]
    .flatMap((match) => (match[1] ?? '').split(/[,，;；]/u).map((claimId) => claimId.trim()))
    .filter((claimId): claimId is string => Boolean(claimId))
  const evidenceIds = [...line.matchAll(/\[evidence:([^\]]+)\]/g)]
    .map((match) => match[1]?.trim())
    .filter((evidenceId): evidenceId is string => Boolean(evidenceId))
  const claims = claimIds
    .map((claimId) => claimById.get(claimId))
    .filter((claim): claim is SynthesisWriterInput['claims'][number] => Boolean(claim))
  return [
    ...claims.map((claim) => claim.text),
    ...claims.flatMap((claim) => claim.supportSpanIds)
      .map((spanId) => spanById.get(spanId)?.text ?? '')
      .filter(Boolean),
    ...evidenceIds.map((evidenceId) => spanById.get(evidenceId)?.text ?? '').filter(Boolean)
  ]
}

function unsupportedDraftNumericTokens(
  line: string,
  supportTexts: string[],
  input: SynthesisWriterInput
): string[] {
  return unsupportedTranslatedNumericTokens(line, supportTexts)
    .filter((token) => !isUserScopeNumericBoundary(line, token, [
    input.brief.topic,
    input.brief.userIntent,
    input.frame.centralQuestion,
    input.frame.coreResearchThread,
    ...input.frame.coreQuestions.map((question) => question.text),
    ...(input.brief.userClarifications ?? []),
    ...(input.coverageContract?.requirements.map((requirement) => requirement.label) ?? [])
  ]))
}
