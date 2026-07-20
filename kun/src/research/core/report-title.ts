/**
 * [INPUT]: 接收完整 research topic 和可选历史/模型标题
 * [OUTPUT]: 对外提供 resolveResearchReportTitle，生成不带展示截断省略号的稳定语义标题
 * [POS]: research/core 的标题真值层，被 run、Architect、Writer、Editor 和 ReportRenderer 共同复用；文件名长度仍由 storage 层处理
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

const GENERATED_ELLIPSIS = /(?:\.\.\.|…)\s*$/u

export function resolveResearchReportTitle(topic: string, candidateTitle?: string): string {
  const canonical = canonicalTitleFromTopic(topic)
  const candidate = cleanTitle(candidateTitle ?? '')
  if (candidate && !GENERATED_ELLIPSIS.test(candidate)) return candidate
  return canonical || candidate.replace(GENERATED_ELLIPSIS, '').trim() || 'DeepResearch 报告'
}

function canonicalTitleFromTopic(topic: string): string {
  const firstSentence = cleanTitle(topic).split(/[。！？!?；;\n]/u)[0]?.trim() ?? ''
  return firstSentence
    .replace(/^仅(?:限|基于)[^，,]{2,80}[，,]\s*/u, '')
    .replace(/^(?:请|帮我|请帮我)?(?:用(?:中文|英文)(?:简洁|简短|完整|详细)?(?:地)?)?\s*(?:解释|分析|研究|调研)\s*/u, '')
    .replace(/[，,]\s*(?:输出|请输出|最终输出).+$/u, '')
    .trim()
}

function cleanTitle(value: string): string {
  return value.replace(/^#\s+/u, '').replace(/\s+/gu, ' ').trim()
}
