import type { PetActionResult, PetActivityItem, PetAnimationState } from '@shared/pets'
import type { ChatState } from '../store/chat-store-types'

const FALLBACK_BODY: Partial<Record<PetAnimationState, string>> = {
  running: '正在思考并生成回答',
  waiting: '需要你回复后继续',
  failed: '这次运行遇到阻塞',
  review: '已有新的结果可查看'
}

export function petBubbleBody(input: {
  status: PetActivityItem['status']
  stalled: boolean
  subtitle?: string
  queued?: string
  sending: boolean
}): string {
  if (input.queued) return input.sending ? '正在发送…' : '跟进消息将在本轮结束后发送'
  if (input.stalled) return FALLBACK_BODY.failed ?? ''
  return input.subtitle || FALLBACK_BODY[input.status] || ''
}

export function petBubbleClock(body: string, status: string, liveSinceMs: number | undefined, nowMs: number): string {
  if (status !== 'running' || typeof liveSinceMs !== 'number' || !Number.isFinite(liveSinceMs)) return body
  const elapsed = formatPetElapsed(Math.max(0, nowMs - liveSinceMs))
  return body ? `${body} · ${elapsed}` : elapsed
}

function formatPetElapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
  const totalSeconds = Math.round(ms / 1000)
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`
}

export async function deliverPetFollowUp(input: {
  threadId: string
  requestId: string
  prompt: string
  knownThreadIds: ReadonlySet<string>
  selectThread: (threadId: string) => Promise<unknown>
  getActiveThreadId: () => string | null
  sendMessage: ChatState['sendMessage']
}): Promise<PetActionResult> {
  const prompt = input.prompt.trim()
  if (!prompt || prompt.length > 16_000 || !input.knownThreadIds.has(input.threadId)) {
    return { ok: false, code: 'rejected', message: '无法发送跟进消息' }
  }
  const threadId = input.threadId
  const requestId = input.requestId
  const selected = (): boolean => input.getActiveThreadId() === threadId
  await input.selectThread(threadId)
  if (!selected()) return { ok: false, code: 'conflict', message: '会话已切换，请重新发送' }
  const sent = await input.sendMessage(prompt, 'agent', {
    expectedThreadId: threadId,
    clientRequestId: requestId,
    submissionGuard: selected
  })
  if (!sent && !selected()) return { ok: false, code: 'conflict', message: '会话已切换，请重新发送' }
  if (!sent) return { ok: false, code: 'rejected', message: '发送失败，请按回车重试' }
  return { ok: true }
}
