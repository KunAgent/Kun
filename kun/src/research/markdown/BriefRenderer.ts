import type { ResearchBrief, ResearchFrame, ResearchRun } from '../core/types.js'
import { priorityLabel } from './labels.js'

export function renderBriefMarkdown(run: ResearchRun, brief: ResearchBrief, frame: ResearchFrame): string {
  return [
    `# 调研简报：${brief.topic}`,
    '',
    `- 运行 ID：${run.id}`,
    `- 简报版本：${brief.version}`,
    `- 简报哈希：${run.briefHash}`,
    `- 输出格式：${brief.outputFormat}`,
    brief.targetAudience ? `- 目标读者：${brief.targetAudience}` : undefined,
    '',
    '## 用户意图',
    '',
    brief.userIntent,
    '',
    ...(brief.userClarifications?.length ? [
      '## 用户补充原文',
      '',
      ...brief.userClarifications.map((item) => `- ${item}`),
      ''
    ] : []),
    '## 核心调研主线',
    '',
    frame.coreResearchThread,
    '',
    '## 中心问题',
    '',
    frame.centralQuestion,
    '',
    '## 核心问题',
    '',
    ...frame.coreQuestions.map((question) => `- [${priorityLabel(question.priority)}] ${question.text} (${question.id})`),
    '',
    '## 请确认',
    '',
    ...run.scope.confirmationChecklist.map((item) => `- ${item}`),
    '',
    '## 成功标准',
    '',
    ...brief.successCriteria.map((criterion) => `- ${criterion}`),
    '',
    '## 约束',
    '',
    ...(brief.constraints.length > 0 ? brief.constraints.map((constraint) => `- ${constraint}`) : ['- 暂无'])
  ].filter((line): line is string => typeof line === 'string').join('\n')
}
