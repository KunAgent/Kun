import type { PetActionResult, PetActivityItem, PetAnimationState } from '@shared/pets'

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

export async function deliverPetFollowUp(input: {
  threadId: string
  prompt: string
  knownThreadIds: ReadonlySet<string>
  selectThread: (threadId: string) => Promise<unknown>
  sendMessage: (prompt: string) => Promise<boolean>
}): Promise<PetActionResult> {
  const prompt = input.prompt.trim()
  if (!prompt || prompt.length > 16_000 || !input.knownThreadIds.has(input.threadId)) {
    return { ok: false, code: 'rejected', message: '无法发送跟进消息' }
  }
  await input.selectThread(input.threadId)
  const sent = await input.sendMessage(prompt)
  if (!sent) return { ok: false, code: 'rejected', message: '发送失败，请按回车重试' }
  return { ok: true }
}
