import type { PetActionResult } from '@shared/pets'
import type { ChatState } from '../store/chat-store-types'

export async function deliverPetChat(
  prompt: string,
  requestId: string,
  getState: () => Pick<ChatState, 'route' | 'setRoute' | 'createThread' | 'activeThreadId' | 'sendMessage'>
): Promise<PetActionResult> {
  if (!prompt.trim() || prompt.trim().length > 16_000) {
    return { ok: false, code: 'rejected', message: '请输入有效消息' }
  }
  try {
    const state = getState()
    if (state.route !== 'chat') state.setRoute('chat')
    const threadId = await state.createThread({ forceNew: true, conversation: true, agentSurface: 'code' })
    if (!threadId || getState().activeThreadId !== threadId) {
      return { ok: false, code: 'conflict', message: '会话已切换，请重新发送' }
    }
    const sent = await getState().sendMessage(prompt.trim(), 'agent', {
      agentSurface: 'code', expectedThreadId: threadId, clientRequestId: requestId,
      submissionGuard: () => getState().activeThreadId === threadId
    })
    return sent ? { ok: true } : { ok: false, code: 'rejected', message: '发送失败，请重试' }
  } catch (error) {
    return { ok: false, code: 'rejected', message: error instanceof Error ? error.message : '发送失败，请重试' }
  }
}
