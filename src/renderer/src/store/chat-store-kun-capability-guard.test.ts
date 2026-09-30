import { describe, expect, it } from 'vitest'
import type { ChatState, SendMessageOverrides } from './chat-store-types'
import { kunWorkflowSendBlocked } from './chat-store-kun-capability-guard'

function state(): ChatState {
  return { activeThreadId: 'thread', threads: [{ id: 'thread', agentSurface: 'code' }],
    composerModelGroups: [{ providerId: 'subscription', kind: 'agent-sdk' }] } as ChatState
}
const selection = { composerHarnessId: 'codex', composerProviderId: '', composerCredentialMode: 'native-login',
  composerModel: 'native', composerAccountId: '' }
const blocked = (overrides?: SendMessageOverrides, changes = {}) => kunWorkflowSendBlocked({
  state: state(), selection, mode: 'agent', orchestration: 'direct', overrides, ...changes
})

describe('Kun product send boundary', () => {
  it('keeps external ordinary code messages available', () => {
    expect(blocked({ agentSurface: 'code' })).toBe(false)
  })

  it.each<SendMessageOverrides>([
    { agentSurface: 'design' }, { guiDesignMode: true }, { guiDesignCanvas: true },
    { guiExcalidrawCanvas: true }, { planBuild: true },
    { guiPlan: { operation: 'refine', workspaceRoot: '/repo', relativePath: '.kunsdd/plan/a.md', planId: 'a' } }
  ])('blocks external Kun intent even when the composer UI is bypassed: %j', (intent) => {
    expect(blocked(intent)).toBe(true)
  })

  it('blocks Kun plan and graph modes on an external Agent', () => {
    expect(blocked(undefined, { mode: 'plan' })).toBe(true)
    expect(blocked(undefined, { mode: 'auto' })).toBe(true)
    expect(blocked(undefined, { orchestration: 'graph' })).toBe(true)
  })

  it('applies the old provider-kind inference when no harness is pinned', () => {
    expect(blocked({ guiDesignMode: true }, { selection: {
      ...selection, composerHarnessId: '', composerProviderId: 'subscription'
    } })).toBe(true)
  })

  it('permits a frozen Kun queue and an explicit handoff from external to Kun', () => {
    const later = state()
    later.threads[0].harnessId = 'codex'
    expect(blocked({ queued: { id: 'q', text: 'Design', harnessId: 'kun', agentSurface: 'design' } }, {
      state: later, selection: { ...selection, composerHarnessId: 'kun' }
    })).toBe(false)
    expect(blocked({ agentSurface: 'design' }, {
      state: later, selection: { ...selection, composerHarnessId: 'kun' }
    })).toBe(false)
  })

  it('does not retrofit new composer intent onto an old queued ordinary message', () => {
    expect(blocked({ guiDesignMode: true, queued: { id: 'q', text: 'Agent task' } })).toBe(false)
  })
})
