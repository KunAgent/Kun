/**
 * [INPUT]: 依赖 ResearchRun/ScopeAssessment，接收 scope 回答文本和标题清洗函数
 * [OUTPUT]: 对外提供含 workspace/final report/failed draft 路径的 API response、只从用户原话提炼的简洁澄清标题、scope requirements、追问识别和稳定 brief id
 * [POS]: research/runtime 的 scope 与响应纯函数层，被 ResearchRuntimeService 调用，不负责模型或状态流转，也不把模型 scope 摘要提升为用户需求真值
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import { dirname, join } from 'node:path'
import type { ResearchRun, ResearchScopeAssessment } from '../core/types.js'
import { resolveResearchReportTitle } from '../core/report-title.js'

export function researchRunTitle(topic: string): string {
  return resolveResearchReportTitle(topic)
}

export function responseForRun(run: ResearchRun): {
  run: ResearchRun
  reportPath: string | null
  draftPath: string | null
  workspaceRoot: string
  artifactPaths: ResearchRun['artifacts']
  completed: boolean
} {
  return {
    run,
    reportPath: run.status === 'done' ? run.artifacts.reportPath : null,
    draftPath: run.draftReportAvailable ? join(run.artifacts.machineDir, 'report-draft.md') : null,
    workspaceRoot: dirname(dirname(run.artifacts.rootDir)),
    artifactPaths: run.artifacts,
    completed: run.status === 'done'
  }
}

export function buildClarifiedTopic(
  topic: string,
  message: string,
  scope: ResearchScopeAssessment | undefined,
  cleanTitle: (value: string) => string
): string {
  const normalizedTopic = topic.trim()
  const normalizedMessage = message.trim()
  if (!normalizedMessage) return normalizedTopic
  if (isGenericResearchTopic(normalizedTopic)) return shortTitle(normalizedMessage, cleanTitle)
  if (scope?.readyForBrief && scope.summary.trim()) return normalizedTopic
  if (normalizedTopic.includes(normalizedMessage)) return normalizedTopic
  return `${normalizedTopic}；补充：${normalizedMessage}`
}

export function normalizedScopeRequirements(message: string): string[] {
  if (/^未选择可选补充，使用默认边界继续。?$/u.test(message.trim())) return []
  const requirements: string[] = []
  for (const block of message.split(/\n\s*\n/u)) {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    const question = lines.find((line) => /^\d+[.)、]\s*/u.test(line))?.replace(/^\d+[.)、]\s*/u, '').trim()
    const answer = lines.find((line) => /^(?:回答|答复)[:：]/u.test(line))?.replace(/^(?:回答|答复)[:：]\s*/u, '').trim()
    if (!answer || /未选择可选补充|使用默认边界继续/u.test(answer)) continue
    requirements.push(question ? `${question}：${answer}` : answer)
  }
  if (requirements.length > 0) return requirements
  const normalized = message.replace(/^补充说明[:：]\s*/u, '').trim()
  return normalized && !/未选择可选补充|使用默认边界继续/u.test(normalized) ? [normalized] : []
}

export function hashResearchTopicId(value: string): string {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

export function isScopeClarificationPrompt(value: string): boolean {
  return /您是否|你是否|您希望|你希望|请说明|请补充|待确认|等待用户|需要用户|希望对比.*(?:哪个|哪些)具体|(?:哪个|哪些)具体领域|主要受众是谁|时间范围是什么|是否有特定的比较角度|例如[:：]|例如，是想了解|可选补充[:：]?/u.test(value)
    || /(?:最后一题|此题|本题|该题|问题).{0,12}(?:选答|可选)|(?:选答|可选)题/u.test(value)
    || /(^|\n)\s*(回答|答复)[:：]/u.test(value)
}

function isGenericResearchTopic(value: string): boolean {
  const compact = value.replace(/\s+/g, '')
  return /^(帮我)?(做)?(研究|调研|分析|看看|了解)(一下)?[。！？!?\s]*$/.test(compact)
    || /^(这个|这个东西|它|他们|这件事)[。！？!?\s]*$/.test(compact)
    || /^research$/i.test(value.trim())
}

function shortTitle(value: string, cleanTitle: (value: string) => string): string {
  const source = cleanTitle(value)
  const cleaned = source
    .replace(/^用户希望/, '')
    .replace(/^用户想要/, '')
    .replace(/[。！？!?\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return resolveResearchReportTitle(cleaned || source)
}
