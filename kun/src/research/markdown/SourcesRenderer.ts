/**
 * [INPUT]: 依赖 SourceRecord、EvidenceSpan 和展示标签
 * [OUTPUT]: 对外提供 renderSourcesMarkdown
 * [POS]: research/markdown 的来源清单渲染器，负责 sources.md 产物
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { EvidenceSpan, SourceRecord } from '../evidence/types.js'
import { sourceReliabilityLabel, sourceStatusLabel, sourceTypeLabel } from './labels.js'

export function renderSourcesMarkdown(sources: SourceRecord[], spans: EvidenceSpan[]): string {
  const spanCountBySource = new Map<string, number>()
  for (const span of spans) {
    spanCountBySource.set(span.sourceId, (spanCountBySource.get(span.sourceId) ?? 0) + 1)
  }
  return [
    '# 来源',
    '',
    ...sources.map((source) => [
      `## ${source.title}`,
      '',
      `- 标识：${source.id}`,
      `- 类型：${sourceTypeLabel(source.sourceType)}`,
      source.canonicalUrl ? `- 链接：${source.canonicalUrl}` : undefined,
      source.path ? `- 路径：${sourcePathLabel(source.path)}` : undefined,
      `- 访问时间：${source.accessedAt}`,
      `- 状态：${sourceStatusLabel(source.status)}`,
      `- 可靠性：${sourceReliabilityLabel(source.reliability)}`,
      source.reliabilityReason ? `- 可靠性说明：${source.reliabilityReason}` : undefined,
      `- 证据片段数：${spanCountBySource.get(source.id) ?? 0}`,
      `- 指纹：${source.fingerprint}`
    ].filter((line): line is string => typeof line === 'string').join('\n'))
  ].join('\n')
}

function sourcePathLabel(path: string): string {
  return path.startsWith('synthetic://') ? '模拟来源：已确认调研简报' : path
}
