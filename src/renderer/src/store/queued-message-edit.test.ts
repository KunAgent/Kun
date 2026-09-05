import { describe, expect, it } from 'vitest'
import type { QueuedUserMessage } from './chat-store-types'
import {
  canRestoreQueuedMessageToComposer,
  queuedMessageComposerRestoreText,
  restoreQueuedMessageFromQueue
} from './queued-message-edit'

describe('queued-message-edit', () => {
  it('restores a plain pending message to the composer and removes it from the queue by id', () => {
    const plain: QueuedUserMessage = {
      id: 'q-plain',
      text: 'revise the visible prompt',
      displayText: 'revise the visible prompt',
      deliveryState: 'pending'
    }
    const messages: QueuedUserMessage[] = [
      { id: 'q-before', text: 'before', deliveryState: 'pending' },
      plain,
      { id: 'q-after', text: 'after', deliveryState: 'pending' }
    ]

    expect(canRestoreQueuedMessageToComposer(plain)).toBe(true)
    expect(restoreQueuedMessageFromQueue(messages, 'q-plain')).toEqual({
      messages: [
        { id: 'q-before', text: 'before', deliveryState: 'pending' },
        { id: 'q-after', text: 'after', deliveryState: 'pending' }
      ],
      restored: plain
    })
    expect(restoreQueuedMessageFromQueue(messages, 'q-missing').restored).toBeNull()
  })

  it('restores a pending image message to the composer and removes it from the queue', () => {
    const imageMessage: QueuedUserMessage = {
      id: 'q-image',
      text: 'analyze this screenshot',
      deliveryState: 'pending',
      attachmentIds: ['attachment-1'],
      attachments: [{ id: 'attachment-1', kind: 'image', name: 'shot.png' }]
    }
    const messages: QueuedUserMessage[] = [
      { id: 'q-other', text: 'keep', deliveryState: 'pending' },
      imageMessage
    ]

    expect(canRestoreQueuedMessageToComposer(imageMessage)).toBe(true)
    expect(restoreQueuedMessageFromQueue(messages, 'q-image')).toEqual({
      messages: [{ id: 'q-other', text: 'keep', deliveryState: 'pending' }],
      restored: imageMessage
    })
    expect(restoreQueuedMessageFromQueue(messages, 'q-missing').restored).toBeNull()
  })

  it('maps image-only synthesized prompts to an empty composer restore text', () => {
    expect(queuedMessageComposerRestoreText({
      text: '<composer-image-only-prompt>',
      displayText: '已附加图片'
    })).toBe('')
    expect(queuedMessageComposerRestoreText({ text: 'visible prompt' })).toBe('visible prompt')
  })

  it('restores the user-facing displayText for plan/auto messages', () => {
    expect(queuedMessageComposerRestoreText({
      text: 'internal plan prompt',
      displayText: 'give me a plan',
      mode: 'plan'
    })).toBe('give me a plan')
    expect(queuedMessageComposerRestoreText({
      text: 'internal auto prompt',
      displayText: 'build it for me',
      mode: 'auto'
    })).toBe('build it for me')
  })

  it.each([
    ['plan mode', { mode: 'plan' }],
    ['auto mode', { mode: 'auto' }],
    ['in-flight delivery', {
      deliveryState: 'in_flight',
      deliveryTurnId: 'turn-1',
      deliveryUserMessageItemId: 'item-1'
    }],
    ['paused delivery', {
      deliveryState: 'paused',
      deliveryTurnId: 'turn-1',
      clientRequestId: 'req-1'
    }],
    ['failed delivery', {
      deliveryState: 'failed',
      deliveryTurnId: 'turn-1'
    }]
  ] as const)('allows composer restore for %s', (_name, fields) => {
    const message = {
      id: 'q-editable',
      text: 'structured prompt',
      deliveryState: 'pending',
      ...fields
    } as QueuedUserMessage

    expect(canRestoreQueuedMessageToComposer(message)).toBe(true)
  })

  it.each([
    ['file references', { fileReferences: [{ path: '/workspace/file.ts' }] }],
    ['document attachments', {
      attachments: [{ id: 'doc-1', kind: 'document', name: 'spec.pdf' }]
    }],
    ['write surface', { agentSurface: 'write' }],
    ['design surface', { agentSurface: 'design' }],
    ['runtime admission wait', { waitForRuntimeAdmission: true }],
    ['no text and no attachments', { text: '   ' }]
  ] as const)('rejects composer restore for %s', (_name, fields) => {
    const message = {
      id: 'q-locked',
      text: 'structured prompt',
      deliveryState: 'pending',
      ...fields
    } as QueuedUserMessage
    const messages = [message]

    expect(canRestoreQueuedMessageToComposer(message)).toBe(false)
    expect(restoreQueuedMessageFromQueue(messages, message.id)).toEqual({
      messages,
      restored: null
    })
  })
})
