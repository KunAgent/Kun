/**
 * [INPUT]: 依赖 ResearchNote 与 AtomicClaim 结构化记录
 * [OUTPUT]: 对外提供 renderNotesMarkdown
 * [POS]: research/markdown 的研究笔记渲染器，负责 notes.md 产物
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */
import type { AtomicClaim, ResearchNote } from '../evidence/types.js'
import { confidenceLabel } from './labels.js'

export function renderNotesMarkdown(notes: ResearchNote[], claims: AtomicClaim[]): string {
  const claimsById = new Map(claims.map((claim) => [claim.id, claim]))
  return [
    '# 调研笔记',
    '',
    ...notes.map((note) => [
      `## ${note.id}`,
      '',
      `- 任务：${note.taskId}`,
      `- 对应问题：${note.questionIds.join(', ')}`,
      `- 置信度：${confidenceLabel(note.confidence)}`,
      '',
      note.summary,
      '',
      `对简报/报告的含义：${note.implicationForBrief}`,
      '',
      '论断：',
      ...note.claimIds.map((claimId) => {
        const claim = claimsById.get(claimId)
        return `- ${claimId}: ${claim?.text ?? '缺失论断'}`
      }),
      '',
      '局限：',
      ...(note.limitations.length > 0 ? note.limitations.map((limitation) => `- ${limitation}`) : ['- 暂无'])
    ].join('\n'))
  ].join('\n')
}
