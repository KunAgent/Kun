import { PET_IPC, type PetActionResult, type PetChatRequest, type PetFollowUpRequest } from '../../shared/pets'

type FollowUpTarget = { webContents: { send(channel: string, payload: unknown): void } }

const pending = new Map<string, (result: PetActionResult) => void>()

export function askPetFollowUp(target: FollowUpTarget, request: { threadId: string; prompt: string }): Promise<PetActionResult> {
  return askPetConversation(target, PET_IPC.followUpRequested, request)
}

export function askPetChat(target: FollowUpTarget, prompt: string): Promise<PetActionResult> {
  return askPetConversation(target, PET_IPC.chatRequested, { prompt })
}

function askPetConversation(
  target: FollowUpTarget,
  channel: string,
  request: Omit<PetFollowUpRequest, 'requestId'> | Omit<PetChatRequest, 'requestId'>
): Promise<PetActionResult> {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  const payload = { ...request, requestId }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      resolve({ ok: false, code: 'rejected', message: '发送失败，请按回车重试' })
    }, 20_000)
    pending.set(requestId, (result) => {
      clearTimeout(timer)
      resolve(result)
    })
    target.webContents.send(channel, payload)
  })
}

export function settlePetFollowUp(requestId: string, result: PetActionResult): void {
  const resolve = pending.get(requestId)
  if (!resolve) return
  pending.delete(requestId)
  resolve(result)
}

export function parseFollowUpResult(value: unknown): { requestId: string; result: PetActionResult } | null {
  if (!value || typeof value !== 'object') return null
  const payload = value as { requestId?: unknown; result?: unknown }
  if (typeof payload.requestId !== 'string' || !payload.requestId || !payload.result || typeof payload.result !== 'object') return null
  const result = payload.result as { ok?: unknown; code?: unknown; message?: unknown }
  if (result.ok === true) return { requestId: payload.requestId, result: { ok: true } }
  if (result.ok !== false || (result.code !== 'conflict' && result.code !== 'missing' && result.code !== 'rejected') || typeof result.message !== 'string') return null
  return { requestId: payload.requestId, result: { ok: false, code: result.code, message: result.message } }
}
