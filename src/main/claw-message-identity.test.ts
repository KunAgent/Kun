import { describe, expect, it } from 'vitest'
import { inboundMessageDedupeKey, normalizeInboundMessageIdentity } from './claw-message-identity'

describe('inbound message identity', () => {
  it('normalizes the channel and requires all identity dimensions', () => {
    expect(normalizeInboundMessageIdentity({
      channel: ' Feishu ',
      accountId: 'bot-a',
      conversationId: 'chat-1',
      platformMessageId: ' msg-1 '
    })).toEqual({
      channel: 'feishu',
      accountId: 'bot-a',
      conversationId: 'chat-1',
      platformMessageId: 'msg-1'
    })
    expect(normalizeInboundMessageIdentity({ channel: 'telegram', accountId: 'bot-a' })).toBeNull()
  })

  it('does not collide for equal message ids from different channels or accounts', () => {
    const first = normalizeInboundMessageIdentity({
      channel: 'telegram', accountId: 'bot-a', conversationId: 'chat', platformMessageId: '42'
    })!
    const second = normalizeInboundMessageIdentity({
      channel: 'feishu', accountId: 'bot-a', conversationId: 'chat', platformMessageId: '42'
    })!
    const third = normalizeInboundMessageIdentity({
      channel: 'telegram', accountId: 'bot-b', conversationId: 'chat', platformMessageId: '42'
    })!
    expect(new Set([inboundMessageDedupeKey(first), inboundMessageDedupeKey(second), inboundMessageDedupeKey(third)]).size).toBe(3)
  })

  it('keeps punctuation unambiguous and rejects unsafe values', () => {
    const identity = normalizeInboundMessageIdentity({
      channel: 'webhook', accountId: 'account', conversationId: 'a|b', platformMessageId: 'c|d'
    })!
    expect(inboundMessageDedupeKey(identity)).toBe('im:["webhook","account","a|b","c|d"]')
    expect(normalizeInboundMessageIdentity({
      channel: 'webhook', accountId: 'account\n', conversationId: 'chat', platformMessageId: 'id'
    })).toBeNull()
    expect(normalizeInboundMessageIdentity({
      channel: 'webhook', accountId: 'x'.repeat(257), conversationId: 'chat', platformMessageId: 'id'
    })).toBeNull()
  })
})
