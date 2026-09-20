import { describe, expect, it } from 'vitest'
import { mobileRoomCanSend, mobileRoomDraftKey, shouldSubmitMobileRoomInput } from './mobile-room-policy'

describe('mobile Room policy', () => {
  it('retains the agent-to-agent read-only boundary', () => {
    expect(mobileRoomCanSend('group')).toBe(true)
    expect(mobileRoomCanSend('user_agent')).toBe(true)
    expect(mobileRoomCanSend('agent_agent')).toBe(false)
  })

  it('uses Enter for newlines except mention confirmation or explicit hardware shortcut', () => {
    expect(shouldSubmitMobileRoomInput({ key: 'Enter', composing: false, mentionPickerOpen: false, modifier: false })).toBe('none')
    expect(shouldSubmitMobileRoomInput({ key: 'Enter', composing: false, mentionPickerOpen: true, modifier: false })).toBe('choose-mention')
    expect(shouldSubmitMobileRoomInput({ key: 'Enter', composing: false, mentionPickerOpen: false, modifier: true })).toBe('send')
    expect(shouldSubmitMobileRoomInput({ key: 'Enter', composing: true, mentionPickerOpen: true, modifier: true })).toBe('none')
  })

  it('isolates main and reply drafts', () => {
    expect(mobileRoomDraftKey('room')).toBe('room')
    expect(mobileRoomDraftKey('room', 'message')).toBe('room:reply:message')
  })
})
