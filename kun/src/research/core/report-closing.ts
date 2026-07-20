/**
 * [INPUT]: 依赖最终或占位引用 Markdown 的结论与局限二级章节
 * [OUTPUT]: 对外提供清洗后收尾深度与具体证据边界校验、无前置转折/反向连接修复纯函数；参考文献定义不参与局限句计数，缺失边界必须退回 Writer，不再确定性注入用户可见模板
 * [POS]: research/core 的报告收尾发布合同，被 Writer、Editor 与 QualityVerifier 共同复用，避免各阶段使用不同完整度标准或用固定句伪造完整度
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export type ResearchReportPreset = 'quick' | 'standard' | 'deep'

const CONCLUSION_TITLES = ['结论与建议', '结论', 'Conclusion', 'Recommendations']
const LIMITATION_TITLES = ['局限与不确定性', 'Caveats', 'Limitations']
const WEAK_CONCLUSION_MESSAGE = '报告结论在安全清洗后不足三句或少于 80 个有效字符，未形成完整综合判断。'
const MISSING_CONCLUSION_BOUNDARY_MESSAGE = '报告结论缺少具体证据边界，必须说明哪些对象、条件或场景未被当前证据覆盖。'
const WEAK_LIMITATIONS_MESSAGE = '报告的“局限与不确定性”必须至少说明两个具体证据边界或未解决缺口。'

export function reportClosingDepthIssue(markdown: string, preset: ResearchReportPreset): string | undefined {
  return reportConclusionDepthIssue(markdown, preset) ?? reportLimitationsDepthIssue(markdown, preset)
}

export function reportConclusionDepthIssue(markdown: string, preset: ResearchReportPreset): string | undefined {
  if (preset === 'quick') return undefined
  const body = secondLevelSectionBody(markdown, CONCLUSION_TITLES)
  if (meaningfulChars(body) < 80 || substantiveSentences(body).length < 3) return WEAK_CONCLUSION_MESSAGE
  return hasEvidenceBoundary(body) ? undefined : MISSING_CONCLUSION_BOUNDARY_MESSAGE
}

export function reportLimitationsDepthIssue(markdown: string, preset: ResearchReportPreset): string | undefined {
  const body = secondLevelSectionBody(markdown, LIMITATION_TITLES)
  if (meaningfulChars(body) < 12) return WEAK_LIMITATIONS_MESSAGE
  const sentences = substantiveSentences(body)
  if (preset !== 'quick' && sentences.length < 2) return WEAK_LIMITATIONS_MESSAGE
  if (preset !== 'quick' && sentences.filter((sentence) => !isGenericLimitation(sentence)).length < 2) {
    return WEAK_LIMITATIONS_MESSAGE
  }
  return undefined
}

function isGenericLimitation(sentence: string): boolean {
  return /^(?:本报告仅覆盖本次收集|不同来源的定义、统计口径和更新时间可能不一致|现有证据不足以覆盖所有相关对象、场景和反例)/u.test(sentence)
}

export function repairDanglingConclusionConnectors(markdown: string): string {
  let inConclusion = false
  return markdown.split('\n').map((line) => {
    const heading = line.trim().match(/^##\s+(.+?)\s*$/u)?.[1]?.replace(/[*`#]/gu, '').trim()
    if (heading) inConclusion = CONCLUSION_TITLES.includes(heading)
    if (!inConclusion) return line
    return line
      .replace(/^\s*(?:而|但是|但|相反|反而|然而|不过)[，,]?\s*/u, '')
      .replace(
        /((?:综合来看|总体而言|总体来看)[，,]\s*)(?:而|但是|但|相反|反而|然而|不过)[，,]?\s*/gu,
        '$1'
      )
  }).join('\n')
}

function secondLevelSectionBody(markdown: string, titles: string[]): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => {
    const title = line.trim().match(/^##\s+(.+?)\s*$/u)?.[1]?.replace(/[*`#]/gu, '').trim()
    return Boolean(title && titles.includes(title))
  })
  if (start < 0) return ''
  const nextBoundary = lines.slice(start + 1).findIndex((line) => (
    /^##\s+/u.test(line.trim()) || /^\[\d+\]:\s/u.test(line.trim())
  ))
  const end = nextBoundary < 0 ? lines.length : start + 1 + nextBoundary
  return lines.slice(start + 1, end).join('\n').trim()
}

function substantiveSentences(markdown: string): string[] {
  return markdown.split(/[。！？!?；;]/u)
    .map(stripReportMarkup)
    .filter((sentence) => sentence.length >= 12)
}

function hasEvidenceBoundary(markdown: string): boolean {
  return /(?:现有证据|当前证据|本章证据|现有材料|仅(?:支持|覆盖|限于)|(?:判断|结论)(?:只)?限于|未(?:覆盖|说明|验证|讨论)|不足以|无法回答|适用边界|边界条件|不能(?:据此)?外推|成立前提|限制在于)/u.test(markdown)
}

function meaningfulChars(markdown: string): number {
  return stripReportMarkup(markdown).replace(/\s+/gu, '').length
}

function stripReportMarkup(value: string): string {
  return value
    .replace(/\[(?:claim|evidence):[^\]]+\]/gu, '')
    .replace(/<sup\b[\s\S]*?<\/sup>/giu, '')
    .replace(/\[\d+\](?!:)/gu, '')
    .replace(/<[^>]+>/gu, '')
    .replace(/[*_`#>\[\](){}|~]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
}
