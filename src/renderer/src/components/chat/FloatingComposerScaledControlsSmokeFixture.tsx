import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { FloatingComposer } from './FloatingComposer'
import { useChatStore } from '../../store/chat-store'
import { useHarnessStore } from '../../store/harness-store'
import { defaultKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID, type AppSettingsV1 } from '@shared/app-settings'
import { emitRendererSettingsChanged } from '../../lib/keyboard-shortcut-settings'
import i18n from '../../i18n'
import '../../index.css'
import '../../styles/base-shell.css'

// Host services are offline. The production component, settings hooks, dictation
// state machine, translations and styles all run unchanged in a real renderer.
const runtime = defaultKunRuntimeSettings()
runtime.speechToText = { ...runtime.speechToText, enabled: true,
  providerId: CUSTOM_SPEECH_TO_TEXT_PROVIDER_ID, protocol: 'local-whisper',
  model: 'whisper-small-q5_1', apiKey: '' }
runtime.promptOptimization.enabled = true
const settings = { agents: { kun: runtime } } as AppSettingsV1
const calls = { optimized: [] as string[], sent: [] as string[], transcribed: 0 }
Object.assign(window, { kunGui: {
  platform: 'win32',
  getSettings: async () => settings,
  optimizePrompt: async ({ text }: { text: string }) => {
    calls.optimized.push(text)
    return { ok: true, text: `Optimized: ${text}` }
  },
  transcribeSpeech: async () => {
    calls.transcribed++
    return { ok: true, text: 'Recorded fixture text' }
  },
  runtimeRequest: async () => ({ ok: true, status: 200, body: '{}' })
} })
// `?variant=work`: the Work assistant composer (compact, Agent switcher, @ references).
// `?variant=agent`: Code with a third-party Agent (its pill, permission, model + effort).
const variantName = new URLSearchParams(location.search).get('variant')
const workVariant = variantName === 'work'
const agentVariant = variantName === 'agent'
const agentRows = agentVariant ? [['kun', 'Kun', 'native-loop'], ['deepseek-harness', 'DeepSeek Harness', 'acp']].map(([id, displayName, transport]) => {
  const profile = { harnessId: id, credentialMode: 'native-login' as const }
  return {
    definition: { id, displayName, transport, credentialModes: id === 'kun' ? ['provider'] : ['native-login'], permissionModes: [],
      modelSource: 'static', staticModels: ['deepseek-v41-flash'], builtin: true, availability: 'active' },
    status: { harnessId: id, installed: 'yes', version: '1.0.0', ready: 'yes', login: 'not-required', checkedAt: new Date().toISOString() },
    enabled: true, enabledProfiles: [profile], readyProfiles: [{ ...profile, expiresAt: new Date(Date.now() + 86_400_000).toISOString() }]
  }
}) : []
useHarnessStore.setState({ rowsLoadedAt: Date.now(), ...(agentVariant ? { rows: agentRows as never,
  models: { 'deepseek-harness': { models: ['deepseek-v41-flash'], loading: false, loadedAt: Date.now(),
    modelInfo: [{ id: 'deepseek-v41-flash', displayName: 'DeepSeek-V41-Flash', reasoningEfforts: ['low', 'high', 'max'], defaultReasoningEffort: 'high' }] } } } : {}) })
useChatStore.setState({ route: workVariant ? 'write' : 'chat', workspaceRoot: '/fixture/workspace',
  activeThreadId: null, composerHarnessId: agentVariant ? 'deepseek-harness' : 'kun', composerModelCatalogStatus: 'ready',
  blocks: [{ id: 'fixture-user', kind: 'user', text: 'Previous message' }] })

const workModelGroups = [{ providerId: 'deepseek', label: 'DeepSeek', presetSource: 'deepseek', modelIds: ['deepseek-v4-pro'],
  modelProfiles: { 'deepseek-v4-pro': { inputModalities: ['text' as const], outputModalities: ['text' as const],
    supportsToolCalling: true, messageParts: ['text' as const],
    reasoning: { supportedEfforts: ['auto' as const, 'high' as const], defaultEffort: 'auto' as const, requestProtocol: 'none' as const } } } }]

function WorkFixture() {
  const [input, setInput] = useState('Summarize @notes/meeting.md for the quarterly plan')
  const [effort, setEffort] = useState<'auto' | 'high'>('auto')
  Object.assign(window, { composerFixtureEffort: setEffort })
  return <main className="ds-chat-stage" style={{ width: '100%', paddingTop: 48 }}>
    <FloatingComposer
      variant="compact" agentSwitcher fileReferenceEnabled
      fileReferences={[{ path: '/fixture/workspace/notes/meeting.md', relativePath: 'notes/meeting.md', name: 'meeting.md',
        type: 'file', workspaceRoot: '/fixture/workspace' }]}
      onAddFileReference={() => undefined} onRemoveFileReference={() => undefined} onPickFileReferences={() => undefined}
      workspaceRootOverride="/fixture/workspace" activeThreadIdOverride={null}
      input={input} setInput={setInput} mode="agent" setMode={() => undefined}
      busy={false} runtimeReady hasActiveThread
      queuedMessages={[]} onRemoveQueuedMessage={() => undefined}
      composerModel="deepseek-v4-pro" composerProviderId="deepseek" composerPickList={['deepseek-v4-pro']}
      composerModelGroups={workModelGroups} composerReasoningEffort={effort}
      onComposerReasoningEffortChange={(next) => setEffort(next === 'high' ? 'high' : 'auto')}
      modelPickerMode="combobox" modelControlVariant="split" showProviderInModelLabel
      onComposerModelChange={() => undefined}
      executionSettings={{ approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalReviewer: 'user' }}
      onExecutionSettingsChange={() => undefined}
      onSend={() => { calls.sent.push(input) }} onInterrupt={() => undefined}
    />
  </main>
}

function Fixture() {
  const [input, setInput] = useState('Explain the proposed change')
  const [mode, setMode] = useState<'plan' | 'agent' | 'auto'>(agentVariant ? 'agent' : 'plan')
  const [effort, setEffort] = useState<'auto' | 'high'>('high')
  Object.assign(window, { composerFixtureEffort: setEffort })
  const model = agentVariant ? 'deepseek-v41-flash' : 'deepseek-chat-with-a-long-model-name'
  return <main className="ds-chat-stage" style={{ width: '100%', paddingTop: 48 }}>
    <FloatingComposer
      workspaceRootOverride="/fixture/workspace" activeThreadIdOverride={null}
      input={input} setInput={setInput} mode={mode} setMode={setMode}
      busy={false} runtimeReady hasActiveThread taskSurface="code"
      queuedMessages={[]} onRemoveQueuedMessage={() => undefined}
      composerModel={model} composerPickList={[model]}
      {...(agentVariant ? { onTaskSurfaceChange: () => undefined,
        composerReasoningEffort: effort, onComposerReasoningEffortChange: (next: string) => setEffort(next === 'high' ? 'high' : 'auto'),
        modelPickerMode: 'combobox' as const, modelControlVariant: 'split' as const } : {})}
      onComposerModelChange={() => undefined}
      executionSettings={{ approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalReviewer: 'user' }}
      onExecutionSettingsChange={() => undefined} onPlanCommand={() => undefined}
      onSend={() => { calls.sent.push(input) }} onInterrupt={() => undefined}
    />
  </main>
}

Object.assign(window, { composerFixture: {
  calls,
  language: (language: string) => i18n.changeLanguage(language),
  setEnabled: (enabled: boolean) => {
    runtime.speechToText.enabled = enabled
    runtime.promptOptimization.enabled = enabled
    emitRendererSettingsChanged(settings)
  }
} })
await i18n.changeLanguage(new URLSearchParams(location.search).get('language') || 'en')
createRoot(document.getElementById('root')!).render(workVariant ? <WorkFixture /> : <Fixture />)
