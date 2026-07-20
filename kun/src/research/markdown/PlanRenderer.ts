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
      `- 优先级：${priorityLabel(task.priority)}`,
      `- 来源类型：${task.sourceTypes.map(sourceTypeLabel).join('、')}`,
      `- 最大来源数：${task.maxSources}`,
      `- 状态：${taskStatusLabel(task.status)}`,
      `- 预期证据：${task.expectedEvidence.join('；')}`,
      `- 搜索提示：${task.searchHints.join('；')}`
    ].join('\n'))
  ].join('\n')
}
