/**
 * [INPUT]: 依赖 research/core/types 的 ResearchRun，接收 SynthesisWriter 生成的 Markdown 草稿
 * [OUTPUT]: 对外提供 renderFinalReportMarkdown 与 sanitizeFinalReportMarkdown，生成用户可见最终报告
 * [POS]: research/markdown 的最终报告渲染器，负责后置生成短摘要和方法说明，并把模型草稿收敛成产品可展示 Markdown
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ResearchRun } from '../core/types.js'

export type RenderFinalReportOptions = {
  generatedAt: string
  sourceCount: number
  claimCount: number
}

export function renderFinalReportMarkdown(
  run: ResearchRun,
  resolvedMarkdown: string,
  options: RenderFinalReportOptions
): string {
  void options
  const sanitized = sanitizeFinalReportMarkdown(resolvedMarkdown.trim())
  const withoutGeneratedSections = stripGeneratedReportSections(sanitized).trim()
  const { title, body } = splitReportTitle(withoutGeneratedSections, run.brief.topic)
  const finalSections = [
    title,
    renderFinalSummary(run, body),
    renderScopeMethodNote(),
    body.trim()
  ].filter(Boolean)

  return `${finalSections.join('\n\n').replace(/\n{3,}/g, '\n\n')}\n`
}

const USER_HIDDEN_SECTION_TITLES = ['核心问题与回答', '证据链']
const RUNTIME_GENERATED_SECTION_TITLES = ['摘要', 'Executive Summary', '调研范围与方法', 'Scope and Method']

const INTERNAL_META_LABELS = [
  '运行 ID',
  '生成时间',
  '来源数量',
  '论断数量',
  '校验状态',
  '需求匹配评分',
  '模型评审',
  '报告完整度'
]

export function sanitizeFinalReportMarkdown(markdown: string): string {
  return stripHiddenReportSections(stripInternalReportMeta(markdown)).trim()
}

function renderFinalSummary(run: ResearchRun, body: string): string {
  const subject = conciseSummarySubject(run)
  const lead = firstMeaningfulSentence(sectionBody(body, ['主要发现', 'Findings']))
    ?? firstMeaningfulSentence(sectionBody(body, ['结论与建议', 'Conclusion']))
  return [
    '## 摘要',
    '',
    `本报告聚焦：${subject}。${lead ? `核心判断：${lead}` : '正文已按主要发现、结论和局限展开。'}`
  ].join('\n')
}

function renderScopeMethodNote(): string {
  return [
    '## 调研范围与方法',
    '',
    '围绕已确认问题综合可复核资料与关键判断；正文中的上标链接用于查看依据。'
  ].join('\n')
}

function stripInternalReportMeta(markdown: string): string {
  const lines = markdown.split('\n')
  return lines
    .filter((line) => !isInternalMetaLine(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
}

function stripHiddenReportSections(markdown: string): string {
  return stripSectionsByTitle(markdown, USER_HIDDEN_SECTION_TITLES)
}

function stripGeneratedReportSections(markdown: string): string {
  return stripSectionsByTitle(markdown, RUNTIME_GENERATED_SECTION_TITLES)
}

function stripSectionsByTitle(markdown: string, titles: string[]): string {
  const lines = markdown.split('\n')
  const kept: string[] = []
  let skipping = false

  for (const line of lines) {
    if (isSectionHeading(line, titles)) {
      skipping = true
      continue
    }
    if (skipping && isSecondLevelHeading(line)) {
      skipping = false
    }
    if (!skipping) kept.push(line)
  }

  return kept.join('\n').replace(/\n{3,}/g, '\n\n')
}

function isInternalMetaLine(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.startsWith('>')) return false
  const text = trimmed.replace(/^>\s*/, '')
  return INTERNAL_META_LABELS.some((label) => text.startsWith(`${label}：`) || text.startsWith(`${label}:`))
}

function isSectionHeading(line: string, titles: string[]): boolean {
  const title = secondLevelHeadingTitle(line)
  if (!title) return false
  return titles.some((hidden) => title === hidden || title.startsWith(`${hidden}：`) || title.startsWith(`${hidden}:`))
}

function isSecondLevelHeading(line: string): boolean {
  return secondLevelHeadingTitle(line) !== undefined
}

function secondLevelHeadingTitle(line: string): string | undefined {
  const match = line.trim().match(/^##\s+(.+?)\s*$/)
  return match?.[1]?.replace(/[*`#]/g, '').trim()
}

function splitReportTitle(markdown: string, fallbackTopic: string): { title: string; body: string } {
  const lines = markdown.split('\n')
  const firstNonEmptyIndex = lines.findIndex((line) => line.trim().length > 0)
  if (firstNonEmptyIndex >= 0) {
    const first = lines[firstNonEmptyIndex]?.trim() ?? ''
    if (/^#\s+/.test(first) && !/^##\s+/.test(first)) {
      return {
        title: first,
        body: [...lines.slice(0, firstNonEmptyIndex), ...lines.slice(firstNonEmptyIndex + 1)].join('\n').trim()
      }
    }
  }
  return {
    title: `# ${fallbackTopic}`,
    body: markdown.trim()
  }
}

function sectionBody(markdown: string, titles: string[]): string {
  const lines = markdown.split('\n')
  const collected: string[] = []
  let collecting = false

  for (const line of lines) {
    const title = secondLevelHeadingTitle(line)
    if (title && titles.some((candidate) => title === candidate || title.startsWith(`${candidate}：`) || title.startsWith(`${candidate}:`))) {
      collecting = true
      continue
    }
    if (collecting && isSecondLevelHeading(line)) break
    if (collecting) collected.push(line)
  }

  return collected.join('\n').trim()
}

function firstMeaningfulSentence(text: string): string | undefined {
  const normalized = text
    .replace(/<sup[\s\S]*?<\/sup>/g, '')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '')
    .replace(/\[claim:[^\]]+\]/g, '')
    .replace(/^#+\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  const first = normalized
    .split(/(?<=[。！？!?])\s*/)
    .find((sentence) => sentence.length >= 12 && !isReportScaffoldingSentence(sentence))
  if (!first || first.length < 12) return undefined
  return first.length > 100 ? `${first.slice(0, 100)}。` : first
}

function conciseSummarySubject(run: ResearchRun): string {
  const candidate = run.frame.centralQuestion || run.frame.coreResearchThread || run.brief.userIntent || run.brief.topic
  const cleaned = candidate
    .replace(/^核心问题[:：]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > 80 ? `${cleaned.slice(0, 80)}...` : cleaned
}

function isReportScaffoldingSentence(sentence: string): boolean {
  return /^本报告围绕这条判断线索展开/.test(sentence)
    || /^正文优先呈现/.test(sentence)
    || /^阅读本节时/.test(sentence)
    || /^这部分材料的价值不在于/.test(sentence)
}
