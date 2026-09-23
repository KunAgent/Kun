export type MobileRoomKind = 'group' | 'user_agent' | 'agent_agent'

export function mobileRoomCanSend(kind: MobileRoomKind): boolean {
  return kind !== 'agent_agent'
}

export function shouldSubmitMobileRoomInput(input: {
  key: string
  composing: boolean
  mentionPickerOpen: boolean
  modifier: boolean
}): 'none' | 'choose-mention' | 'send' {
  if (input.composing || input.key !== 'Enter') return 'none'
  if (input.mentionPickerOpen) return 'choose-mention'
  return input.modifier ? 'send' : 'none'
}

export function mobileRoomDraftKey(roomId: string, replyMessageId?: string): string {
  return replyMessageId ? `${roomId}:reply:${replyMessageId}` : roomId
}
