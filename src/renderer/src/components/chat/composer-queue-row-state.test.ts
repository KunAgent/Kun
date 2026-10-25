import { describe, expect, it } from 'vitest'
import type { QueuedComposerMessage } from './FloatingComposerQueuedMessages'
import {
  isQueuedSlashCommand,
  queuedAttachmentSummary,
  queuedMessageRowState,
  queuedMessageStatus,
  visibleQueuedMessages
} from './composer-queue-row-state'

const t = (key: string, values?: Record<string, unknown>): string => {
  const parts = Object.entries(values ?? {}).map(([name, value]) => `${name}=${String(value)}`)
  return parts.length > 0 ? `${key} ${parts.join(' ')}` : key
}

function message(overrides: Partial<QueuedComposerMessage> = {}): QueuedComposerMessage {
  return { id: 'q', text: 'follow up', ...overrides }
}

const running = {
  running: true,
  guidanceTarget: 'turn' as const,
  pausedCaptionShown: false,
  hasGuide: true,
  hasRestore: true
}

describe('queue row rules', () => {
  it('keeps every row the user can still manage, including runtime-admitted ones', () => {
    const states = [undefined, 'pending', 'paused', 'failed', 'starting', 'in_flight'] as const
    const rows = states.map((deliveryState, index) => message({ id: `q-${index}`, deliveryState }))
    expect(visibleQueuedMessages(rows)).toHaveLength(states.length)
  })

  it('detects slash commands for the mono face', () => {
    expect(isQueuedSlashCommand('/review the diff')).toBe(true)
    expect(isQueuedSlashCommand('  /goal ship it')).toBe(true)
    expect(isQueuedSlashCommand('/ not a command')).toBe(false)
    expect(isQueuedSlashCommand('use /tmp for scratch')).toBe(false)
  })

  it('summarizes one named attachment by name and several by kind counts', () => {
    expect(queuedAttachmentSummary(message({ attachments: [{ name: ' shot.png ', kind: 'image' }] })))
      .toEqual({ imageCount: 1, documentCount: 0, singleName: 'shot.png', names: 'shot.png' })
    expect(queuedAttachmentSummary(message({
      attachments: [{ name: 'a.png' }, { name: 'spec.pdf', kind: 'document' }]
    }))).toEqual({ imageCount: 1, documentCount: 1, singleName: null, names: 'a.png, spec.pdf' })
    expect(queuedAttachmentSummary(message({ attachmentIds: ['a', 'b'] })))
      .toEqual({ imageCount: 2, documentCount: 0, singleName: null, names: '' })
    expect(queuedAttachmentSummary(message()).imageCount).toBe(0)
  })

  it('offers Now only while a turn runs and explains the guidance target', () => {
    expect(queuedMessageRowState(message(), running, t)).toMatchObject({
      canGuide: true,
      guideHidden: false,
      guideLabel: 'composerQueue.nowLabel',
      guideTitle: 'guideQueuedMessageHint'
    })
    expect(queuedMessageRowState(message(), { ...running, guidanceTarget: 'graph' }, t).guideTitle)
      .toBe('guideQueuedMessageGraphHint')
    expect(queuedMessageRowState(message(), { ...running, guidanceTarget: 'unsupported' }, t))
      .toMatchObject({ canGuide: false, guideTitle: 'guideQueuedMessageUnsupported' })
    expect(queuedMessageRowState(message({ guidanceEligible: false }), running, t))
      .toMatchObject({ canGuide: false, guideTitle: 'guideQueuedMessageTextOnly' })
    expect(queuedMessageRowState(message(), { ...running, running: false }, t))
      .toMatchObject({ canGuide: false, guideHidden: true })
  })

  it('turns paused and failed rows into Retry, deferring to the paused caption', () => {
    const idle = { ...running, running: false }
    expect(queuedMessageRowState(message({ deliveryState: 'failed', errorCode: 'runtime_unhealthy' }), idle, t))
      .toMatchObject({ recoverable: true, canGuide: true, guideLabel: 'queuedMessageRetry', guideTitle: 'runtime_unhealthy' })
    expect(queuedMessageRowState(message({ deliveryState: 'paused' }), { ...idle, pausedCaptionShown: true }, t))
      .toMatchObject({ recoverable: true, guideHidden: true })
    expect(queuedMessageRowState(message({ deliveryState: 'failed', waitForRuntimeAdmission: true }), idle, t))
      .toMatchObject({ canGuide: false, guideTitle: 'queuedMessageRetryUnavailable' })
  })

  it('gates restore and remove on the delivery phase', () => {
    expect(queuedMessageRowState(message({ composerRestoreEligible: true }), running, t))
      .toMatchObject({ canRestore: true, restoreLabel: 'queuedMessageEditInComposer', removeBlocked: false })
    expect(queuedMessageRowState(message({
      composerRestoreEligible: true,
      steeringRequest: { operationId: 'op', turnId: 'turn' },
      composerRestoreBlockReason: 'queuedMessageEditSteering'
    }), running, t)).toMatchObject({ canRestore: false, restoreLabel: 'queuedMessageEditSteering', removeBlocked: true })
    expect(queuedMessageRowState(message({ deliveryState: 'starting', composerRestoreEligible: true }), running, t))
      .toMatchObject({ canRestore: false, canGuide: false, removeBlocked: true })
    expect(queuedMessageRowState(message({ composerRestoreEligible: true }), { ...running, hasRestore: false }, t)
      .canRestore).toBe(false)
  })

  it('maps delivery states to toned status chips', () => {
    expect(queuedMessageStatus(message(), false, t)).toBeNull()
    expect(queuedMessageStatus(message({ deliveryState: 'starting' }), false, t))
      .toEqual({ tone: 'muted', label: 'queuedMessageConfirming' })
    expect(queuedMessageStatus(message({ deliveryState: 'in_flight' }), false, t))
      .toEqual({ tone: 'muted', label: 'queuedMessageInFlight' })
    expect(queuedMessageStatus(message({ deliveryState: 'paused' }), false, t))
      .toEqual({ tone: 'warning', label: 'queuedMessagePaused' })
    expect(queuedMessageStatus(message({ deliveryState: 'paused' }), true, t)).toBeNull()
    expect(queuedMessageStatus(message({ deliveryState: 'paused', editIntent: 'restoring' }), true, t))
      .toEqual({ tone: 'warning', label: 'queuedMessageRestorePending' })
    expect(queuedMessageStatus(message({ deliveryState: 'failed', errorMessage: 'offline' }), false, t))
      .toEqual({ tone: 'danger', label: 'queuedMessageFailed', detail: 'offline' })
    expect(queuedMessageStatus(message({ deliveryState: 'failed' }), false, t))
      .toEqual({ tone: 'danger', label: 'queuedMessageFailed' })
  })
})
