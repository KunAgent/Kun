import { describe, expect, it } from 'vitest'
import { ThreadSchema, type ThreadRecord } from '../contracts/threads.js'
import { createThreadRecord } from './thread.js'
import { nativeFollowUpTargetFingerprint } from './native-followup-target.js'

function target(): ThreadRecord {
  return ThreadSchema.parse({
    ...createThreadRecord({ id: 'target', workspace: '/workspace/one', model: 'model', title: 'Original' }),
    workbenchOrigin: { kind: 'bot', roomId: 'room', linkId: 'wb', agentId: 'agent', agentName: 'Agent',
      capabilityCeiling: { allowedToolNames: ['read'], blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: [] } },
    additionalWorkspaces: ['/workspace/two'], agentId: 'profile', providerId: 'provider'
  })
}

describe('native follow-up target authority', () => {
  it('ignores presentation and activity changes without ignoring owner identity', () => {
    const original = target()
    const equivalent = ThreadSchema.parse({ ...original, title: 'Renamed', updatedAt: '2099-01-01T00:00:00.000Z',
      revision: 20, status: 'running', workbenchOrigin: { ...original.workbenchOrigin!, agentName: 'New name', messageId: 'card' },
      turns: [{ id: 'old-turn', threadId: original.id, prompt: 'history', status: 'completed', createdAt: '2026-01-01T00:00:00.000Z' }] })
    expect(nativeFollowUpTargetFingerprint(equivalent)).toBe(nativeFollowUpTargetFingerprint(original))
  })

  it.each([
    ['workspace', (t: ThreadRecord) => ({ ...t, workspace: '/different' })],
    ['additional workspace', (t: ThreadRecord) => ({ ...t, additionalWorkspaces: ['/ungranted'] })],
    ['history source', (t: ThreadRecord) => ({ ...t, historyRefId: 'different-history' })],
    ['extension owner version', (t: ThreadRecord) => ({ ...t, ownerExtensionVersion: '2.0' })],
    ['extension visibility', (t: ThreadRecord) => ({ ...t, extensionVisibility: 'workspace' })],
    ['goal objective', (t: ThreadRecord) => ({ ...t, goal: { threadId: t.id, objective: 'Different goal', status: 'active',
      tokensUsed: 0, timeUsedSeconds: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } })],
    ['participant', (t: ThreadRecord) => ({ ...t, workbenchOrigin: { ...t.workbenchOrigin!, agentId: 'other' } })],
    ['capability ceiling', (t: ThreadRecord) => ({ ...t, workbenchOrigin: { ...t.workbenchOrigin!,
      capabilityCeiling: { ...t.workbenchOrigin!.capabilityCeiling!, allowedToolNames: ['read', 'write'] } } })],
    ['model', (t: ThreadRecord) => ({ ...t, model: 'other-model' })],
    ['provider', (t: ThreadRecord) => ({ ...t, providerId: 'other-provider' })],
    ['permission', (t: ThreadRecord) => ({ ...t, approvalPolicy: 'auto' as const })],
    ['sandbox', (t: ThreadRecord) => ({ ...t, sandboxMode: 'danger-full-access' as const })],
    ['instructions', (t: ThreadRecord) => ({ ...t, systemPrompt: 'different instructions' })],
    ['agent profile', (t: ThreadRecord) => ({ ...t, agentId: 'different-profile' })]
  ])('changes when %s changes', (_name, mutate) => {
    const original = target()
    expect(nativeFollowUpTargetFingerprint(ThreadSchema.parse(mutate(original))))
      .not.toBe(nativeFollowUpTargetFingerprint(original))
  })
})
