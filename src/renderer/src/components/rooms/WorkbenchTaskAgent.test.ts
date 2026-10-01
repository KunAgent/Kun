import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { WorkbenchExecution } from '@shared/rooms-api'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { useHarnessStore, resetHarnessPolling } from '../../store/harness-store'
import { FloatingComposerHarnessPicker } from '../chat/FloatingComposerHarnessPicker'
import { FloatingComposerModelPicker } from '../chat/FloatingComposerModelPicker'
import { WorkbenchTaskAgentPicker } from './WorkbenchTaskAgent'

const native: AdeHarnessRow = {
  definition: { id: 'codex', displayName: 'Codex', transport: 'codex-app-server', credentialModes: ['native-login'],
    permissionModes: [], modelSource: 'probe', staticModels: ['native-model'], builtin: true },
  status: { harnessId: 'codex', installed: 'yes', login: 'signed-in', checkedAt: '2026-10-01T00:00:00Z' }
}

describe('Card-local Agent picker', () => {
  let renderer: ReactTestRenderer | undefined
  const changed = vi.fn()
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    changed.mockReset()
    useHarnessStore.setState({ rows: [native], rowsLoading: false, rowsLoadedAt: Date.now(), rowsError: undefined,
      models: { codex: { models: ['native-model'], loading: false, loadedAt: Date.now() } }, providerGroups: {} })
  })
  afterEach(() => { act(() => renderer?.unmount()); renderer = undefined; resetHarnessPolling() })
  const mount = async (execution: WorkbenchExecution) => {
    await act(async () => { renderer = create(createElement(WorkbenchTaskAgentPicker, { execution, code: true, onChange: changed })) })
  }

  it('switches only the card route, retains the permission, and clears incompatible workflow state', async () => {
    const composer = useChatStore.getState()
    await mount({ mode: 'goal', orchestration: 'graph', goalTokenBudget: 5000, permission: 'ask-for-approval',
      model: { harnessId: 'kun', providerId: 'api', model: 'api-model' } })
    await act(async () => { renderer!.root.findByType(FloatingComposerHarnessPicker).props.onSelect('codex') })
    expect(changed).toHaveBeenCalledWith({ mode: 'direct', orchestration: 'direct', goalTokenBudget: undefined,
      permission: 'ask-for-approval', model: { harnessId: 'codex', credentialMode: 'native-login', model: 'native-model' } })
    expect(useChatStore.getState().composerHarnessId).toBe(composer.composerHarnessId)
    expect(useChatStore.getState().composerModel).toBe(composer.composerModel)
  })

  it('retains external Agent identity when choosing a native model', async () => {
    await mount({ mode: 'direct', model: { harnessId: 'codex', credentialMode: 'native-login', model: 'native-model' } })
    await act(async () => { renderer!.root.findByType(FloatingComposerModelPicker).props.onComposerModelChange('native-model', 'ade-cred:native-login') })
    expect(changed.mock.calls[0][0].model).toEqual({ harnessId: 'codex', credentialMode: 'native-login', model: 'native-model' })
  })

  it('refuses a stale unavailable selection instead of switching engines', async () => {
    useHarnessStore.setState({ rows: [{ ...native, status: { ...native.status, login: 'signed-out' } }] })
    await mount({ mode: 'direct' })
    await act(async () => { renderer!.root.findByType(FloatingComposerHarnessPicker).props.onSelect('codex') })
    expect(changed).not.toHaveBeenCalled()
  })
})
