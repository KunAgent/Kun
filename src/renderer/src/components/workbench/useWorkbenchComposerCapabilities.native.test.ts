import { createElement } from 'react'
import { act, create } from 'react-test-renderer'
import { expect, it } from 'vitest'
import { useChatStore } from '../../store/chat-store'
import { useHarnessStore } from '../../store/harness-store'
import { useWorkbenchComposerCapabilities, type WorkbenchComposerCapabilities } from './useWorkbenchComposerCapabilities'

it('uses native model image capabilities independently of Kun model sources', async () => {
  const previousChat = useChatStore.getState()
  const previousHarnesses = useHarnessStore.getState()
  let result: WorkbenchComposerCapabilities | undefined
  const props = { route: 'chat', rightPanelMode: null, designAssistantModel: '', resolvedDesignAssistantProviderId: '',
    writeAssistantModel: '', resolvedWriteAssistantProviderId: '', composerModel: 'native-model',
    composerProviderId: '', composerModelGroups: [], runtimeInfo: null }
  function Probe() { result = useWorkbenchComposerCapabilities(props); return null }
  let root: ReturnType<typeof create> | undefined
  try {
    useChatStore.setState({ composerHarnessId: 'codex', composerCredentialMode: 'native-login' })
    useHarnessStore.setState({ models: { codex: { models: ['native-model'], loading: false,
      modelInfo: [{ id: 'native-model', inputModalities: ['text', 'image'], isDefault: true }] } } })
    await act(async () => { root = create(createElement(Probe)) })
    expect(result?.selectedModelSupportsImageInput).toBe(true)
    await act(async () => useChatStore.setState({ composerCredentialMode: 'kun-gateway' }))
    expect(result?.selectedModelSupportsImageInput).toBe(false)
  } finally {
    await act(async () => root?.unmount())
    useChatStore.setState(previousChat)
    useHarnessStore.setState(previousHarnesses)
  }
})
