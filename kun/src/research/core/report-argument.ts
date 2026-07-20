/**
 * [INPUT]: 依赖带占位引用或最终数字引用的单章 Markdown 正文和 ReportBlueprint 章节证据模式
 * [OUTPUT]: 对外提供兼容 claim、数字和 cit_N 引用占位符的章节可见字符、完整句子、段落、排除“完全不同/共同影响”空综合后的独立句首证据综合、直接事实对比、具体证据边界信号、明确场景章识别、按证据数量统一增长的 standard/deep 最小章节字符数、条件应用所需全部已筛选机制前提数和常规/多证据比较/显式单证据降置信深度判定；单独出现“影响/策略”不误判为场景，短事实摘要不能绕过完整论证门
 * [POS]: research/core 的章节发布合同，被 Section Writer、QualityVerifier 与 Judge 共同复用，避免只按字数放行事实摘要
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

import type { ResearchReportBlueprintSection } from './types.js'

export type ReportArgumentSignals = {
  chars: number
  sentences: number
  paragraphs: number
  hasSynthesis: boolean
  hasDirectComparison: boolean
  hasEvidenceBoundary: boolean
}

export type ReportArgumentDepthInput = {
  markdown: string
  minimumChars: number
  evidenceCount: number
  allowDirectComparison?: boolean
  allowTerseArgument?: boolean
}

export function minimumReportArgumentChars(
  evidenceCount: number,
  evidenceMode: ResearchReportBlueprintSection['evidenceMode'] = 'direct'
): number {
  if (evidenceMode === 'evidence_gap') return 60
  if (evidenceMode === 'conditional_application') return 220
  if (evidenceCount >= 4) return 360
  if (evidenceCount === 3) return 300
  if (evidenceCount === 2) return 210
  return 180
}

export function reportArgumentSignals(markdown: string): ReportArgumentSignals {
  const prose = stripArgumentMarkup(markdown)
  const synthesisCandidates = markdown
    .split(/[。！？!?；;]/u)
    .map((sentence) => sentence
      .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
      .replace(/\[cit_\d+\]/gu, '')
      .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/giu, '')
      .replace(/\[\d+\](?!:)/gu, '')
      .trim())
    .filter((sentence) => sentence.length > 0)
    .filter((sentence) => !/^(?:(?:现有|当前|本章)(?:证据|材料)|证据只(?:支持|覆盖)|这一判断只(?:覆盖|限于)|(?:判断|结论)(?:只)?限于|未(?:覆盖|说明|验证|讨论)|适用边界|边界条件)/u.test(sentence))
  const hasSynthesis = synthesisCandidates.some((sentence) =>
    /^(?:由此判断|综合判断|总体而言|总体来看|这(?:表明|说明|意味着|反映|显示)|因此|因而|从而|区别在于|关键在于|作用在于|取决于|共同构成)/u.test(sentence)
      && !isVagueArgumentSynthesis(sentence)
  )
  const hasDirectComparison = synthesisCandidates.some((sentence) =>
    /^(?:相比|相较|对比|与之相反|不同于)/u.test(sentence)
  )
  return {
    chars: prose.replace(/\s+/gu, '').length,
    sentences: markdown.split(/[。！？!?；;]/u)
      .filter((sentence) => stripArgumentMarkup(sentence).trim().length >= 12)
      .length,
    paragraphs: markdown.split(/\n\s*\n/gu)
      .filter((paragraph) => stripArgumentMarkup(paragraph).trim().length >= 20)
      .length,
    hasSynthesis,
    hasDirectComparison,
    hasEvidenceBoundary: /(?:现有证据|当前证据|本章证据|现有材料|证据只(?:支持|覆盖)|仅(?:支持|覆盖|限于)|(?:判断|结论)(?:只)?限于|未(?:覆盖|说明|验证|讨论)|不足以|无法回答|适用边界|边界条件|不能外推|成立前提|限制在于)/u.test(markdown)
  }
}

function isVagueArgumentSynthesis(sentence: string): boolean {
  return /事实\s*[AB].{0,80}事实\s*[AB]|(?:两者|二者|这两个|这些|上述).{0,24}(?:作用机制|触发条件|风险点).{0,16}(?:完全不同|各不相同|存在差异)|(?:共同)?(?:构成|揭示).{0,36}(?:风险点|行为差异|不同影响)|共同.{0,12}(?:决定|影响|塑造|左右).{0,28}(?:程度|水平|表现|效果|结果|走向|态势)/u.test(sentence)
}

export function reportArgumentMeetsDepth(input: ReportArgumentDepthInput): boolean {
  const signals = reportArgumentSignals(input.markdown)
  const fullArgument = signals.chars >= input.minimumChars &&
    signals.sentences >= 5 &&
    signals.paragraphs >= 2 &&
    signals.hasSynthesis &&
    input.evidenceCount >= 1
  if (fullArgument) return true
  const compactArgument = input.evidenceCount >= 2 &&
    signals.chars >= input.minimumChars &&
    signals.sentences >= 4 &&
    signals.paragraphs >= 1 &&
    signals.hasSynthesis &&
    signals.hasEvidenceBoundary
  if (compactArgument) return true
  const terseArgument = input.allowTerseArgument === true &&
    input.evidenceCount >= 2 &&
    signals.chars >= 110 &&
    signals.sentences >= 3 &&
    signals.paragraphs >= 2 &&
    signals.hasSynthesis &&
    signals.hasEvidenceBoundary
  if (terseArgument) return true
  const directComparisonArgument = input.allowDirectComparison === true &&
    input.minimumChars <= 220 &&
    input.evidenceCount >= 2 &&
    signals.chars >= 100 &&
    signals.sentences >= 2 &&
    signals.paragraphs >= 1 &&
    (signals.hasSynthesis || signals.hasDirectComparison) &&
    signals.hasEvidenceBoundary
  if (directComparisonArgument) return true
  return input.evidenceCount === 1 &&
    signals.chars >= input.minimumChars &&
    signals.sentences >= 3 &&
    signals.paragraphs >= 2 &&
    signals.hasSynthesis &&
    signals.hasEvidenceBoundary
}

export function isContextualReportSection(title: string): boolean {
  return /(?:场景|应用|实践|用例|案例|scenario|use\s*case|application|practice|case\s*study)/iu.test(title)
}

export function requiredConditionalContextClaimCount(section: ResearchReportBlueprintSection): number {
  return section.contextClaimIds?.length ?? 0
}

function stripArgumentMarkup(value: string): string {
  return value
    .replace(/\[(?:claim|structured-claim|evidence):[^\]]+\]/gu, '')
    .replace(/\[cit_\d+\]/gu, '')
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/giu, '')
    .replace(/\[\d+\](?!:)/gu, '')
    .replace(/^[\s\d.*+-]+/gmu, '')
    .replace(/[`*_>#]/gu, '')
    .replace(/\s+/gu, ' ')
}
