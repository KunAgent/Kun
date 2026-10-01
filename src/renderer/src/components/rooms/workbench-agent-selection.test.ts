import { describe, expect, it } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { initialWorkbenchTaskDraft } from './WorkbenchTaskOptions'
import { useChatStore } from '../../store/chat-store'
import { selectWorkbenchAgent, selectWorkbenchModel, workbenchModelComplete, workbenchModelGroup } from './workbench-agent-selection'

const row = (id: string, modes: AdeHarnessRow['definition']['credentialModes']): AdeHarnessRow => ({
  definition: { id, credentialModes: modes, staticModels: [] }, status: { installed: 'yes' }
} as unknown as AdeHarnessRow)

describe('Rooms card-local Agent selection', () => {
  it('never leaks a provider, account, reasoning or fast-mode choice into native sign-in', () => {
    const selected = selectWorkbenchAgent({ row: row('codex', ['native-login']), nativeModels: ['native-model'],
      providerGroups: [], previous: { providerId: 'deepseek', accountId: 'private-account', model: 'deepseek-v4',
        harnessId: 'kun', serviceTier: 'priority', reasoningEffort: 'high' } })
    expect(selected).toEqual({ harnessId: 'codex', credentialMode: 'native-login', model: 'native-model' })
    expect(workbenchModelGroup(selected)).toBe('ade-cred:native-login')
    expect(workbenchModelComplete(selected)).toBe(true)
  })
  it('only selects provider models advertised for the target Agent', () => {
    const selected = selectWorkbenchAgent({ row: row('cursor', ['provider']), nativeModels: [],
      providerGroups: [{ providerId: 'cursor-provider', label: 'Cursor', models: ['cursor-model'] }],
      previous: { providerId: 'deepseek', model: 'deepseek-v4' } })
    expect(selected).toEqual({ harnessId: 'cursor', credentialMode: 'provider', providerId: 'cursor-provider', model: 'cursor-model' })
    expect(workbenchModelGroup(selected)).toBe('ade-cred:provider:cursor-provider')
  })
  it('leaves an incomplete route incomplete instead of silently falling back to Kun', () => {
    const selected = selectWorkbenchAgent({ row: row('codex', ['native-login']), nativeModels: [], providerGroups: [] })
    expect(selected.harnessId).toBe('codex')
    expect(workbenchModelComplete(selected)).toBe(false)
    expect(workbenchModelComplete({ model: 'm', credentialMode: 'provider' })).toBe(false)
    expect(workbenchModelComplete()).toBe(true)
  })
  it('decodes native and gateway groups without losing Agent identity', () => {
    const current = { harnessId: 'claude-code', providerId: 'old', accountId: 'old-account', model: 'old', serviceTier: 'priority' as const }
    expect(selectWorkbenchModel(current, 'sonnet', 'ade-cred:native-login')).toEqual({
      harnessId: 'claude-code', model: 'sonnet', credentialMode: 'native-login' })
    expect(selectWorkbenchModel(current, 'new', 'ade-cred:kun-gateway:custom/provider')).toEqual({
      harnessId: 'claude-code', model: 'new', providerId: 'custom/provider', credentialMode: 'kun-gateway' })
  })
  it('does not borrow an unrelated Code composer route or permissions when confirming a proposal', () => {
    const old = useChatStore.getState()
    useChatStore.setState({ composerHarnessId: 'codex', composerCredentialMode: 'native-login', composerModel: 'elsewhere',
      composerProviderId: '', composerOrchestration: 'graph', graphEnabled: true })
    try {
      const draft = initialWorkbenchTaskDraft({ title: 'task', goal: 'goal', mode: 'agent', isolation: 'inherit', report: 'final' })
      expect(draft.execution.model).toBeUndefined()
      expect(draft.execution.permission).toBe('ask-for-approval')
      expect(draft.execution.orchestration).toBe('direct')
    } finally { useChatStore.setState(old) }
  })
})
