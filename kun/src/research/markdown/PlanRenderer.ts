/**
 * [INPUT]: 依赖 ResearchPlan 和 markdown 展示标签
 * [OUTPUT]: 对外提供 renderPlanMarkdown，展示章节责任、问题、来源预算和任务状态
 * [POS]: research/markdown 的内部调研计划渲染器，把 Supervisor 任务映射为可审计 Markdown
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { ResearchPlan } from '../core/types.js'
import { priorityLabel, sourceTypeLabel, taskStatusLabel } from './labels.js'

export function renderPlanMarkdown(plan: ResearchPlan): string {
  return [
    '# 调研计划',
    '',
    plan.rationale,
    '',
    '## 任务',
    '',
    ...plan.tasks.map((task) => [
      `### ${task.id}`,
      '',
      `- 目标：${task.objective}`,
      `- 对应问题：${task.questionIds.join(', ')}`,
      ...(task.reportSectionIds?.length ? [`- 负责报告章节：${task.reportSectionIds.join('、')}`] : []),
      `- 优先级：${priorityLabel(task.priority)}`,
      `- 来源类型：${task.sourceTypes.map(sourceTypeLabel).join('、')}`,
      `- 最大来源数：${task.maxSources}`,
      `- 状态：${taskStatusLabel(task.status)}`,
      `- 预期证据：${task.expectedEvidence.join('；')}`,
      `- 搜索提示：${task.searchHints.join('；')}`
    ].join('\n'))
  ].join('\n')
}
