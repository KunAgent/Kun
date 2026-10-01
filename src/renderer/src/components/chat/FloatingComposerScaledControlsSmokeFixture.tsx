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
useHarnessStore.setState({ rowsLoadedAt: Date.now() })
useChatStore.setState({ route: 'chat', workspaceRoot: '/fixture/workspace',
  activeThreadId: null, composerHarnessId: 'kun', composerModelCatalogStatus: 'ready',
  blocks: [{ id: 'fixture-user', kind: 'user', text: 'Previous message' }] })

function Fixture() {
  const [input, setInput] = useState('Explain the proposed change')
  const [mode, setMode] = useState<'plan' | 'agent' | 'auto'>('plan')
  return <main className="ds-chat-stage" style={{ width: '100%', paddingTop: 48 }}>
    <FloatingComposer
      workspaceRootOverride="/fixture/workspace" activeThreadIdOverride={null}
      input={input} setInput={setInput} mode={mode} setMode={setMode}
      busy={false} runtimeReady hasActiveThread taskSurface="code"
      queuedMessages={[]} onRemoveQueuedMessage={() => undefined}
      composerModel="deepseek-chat-with-a-long-model-name" composerPickList={['deepseek-chat-with-a-long-model-name']}
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
createRoot(document.getElementById('root')!).render(<Fixture />)
