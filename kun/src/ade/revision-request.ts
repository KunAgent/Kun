import type { ReviewComment } from '../contracts/review.js'

/**
 * Deterministic revision-request rendering (11 §4.4): the host, not the
 * model, assembles the batch text so the worker receives a stable,
 * numbered list regardless of which client pressed send.
 */
export function renderRevisionRequest(input: {
  workspaceId: string
  round: number
  comments: ReviewComment[]
  note?: string
}): string {
  const comments = [...input.comments].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.side.localeCompare(b.side) ||
      a.line - b.line ||
      a.commentId.localeCompare(b.commentId)
  )
  const parts: string[] = [
    `<kun_review_request round="${input.round}" workspace="${input.workspaceId}">`,
    '请根据以下审查意见修改。每条意见都对应具体位置。'
  ]
  if (input.note?.trim()) parts.push(input.note.trim())
  parts.push('')
  comments.forEach((comment, index) => {
    const header = comment.outdated
      ? `${index + 1}. ${comment.path} 第 ${comment.line} 行（代码已变化，原文：${comment.anchor.lineText}）`
      : `${index + 1}. ${comment.path} 第 ${comment.line} 行（${comment.side === 'old' ? '旧版本' : '新版本'}）`
    parts.push(header)
    if (!comment.outdated) parts.push(`   代码：${comment.anchor.lineText}`)
    parts.push(`   意见：${comment.body}`, '')
  })
  parts.push('完成后，逐条说明处理结果：已修改 / 不同意（附原因）。', '</kun_review_request>')
  return parts.join('\n')
}
