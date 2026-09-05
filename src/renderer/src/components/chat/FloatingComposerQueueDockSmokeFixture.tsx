import { useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useChatStore } from '../../store/chat-store'
import { FloatingComposer } from './FloatingComposer'
import type { QueuedComposerMessage } from './FloatingComposerQueuedMessages'

export type ComposerQueueSmokeScenario = 'single' | 'multi' | 'long' | 'failed'

let mountedRoot: Root | null = null
let settleRetry: (() => void) | null = null

export function mountComposerQueueSmokeFixture(
  scenario: ComposerQueueSmokeScenario = 'single'
): void {
  mountedRoot?.unmount()
  settleRetry = null
  document.body.replaceChildren()
  document.body.style.margin = '0'
  document.body.style.overflow = 'hidden'
  useChatStore.setState({
    route: 'chat',
    blocks: [{ kind: 'user', id: 'fixture-user', text: 'Start the fixed queue fixture' }]
  })

  const host = document.createElement('div')
  host.dataset.composerQueueSmokeHost = scenario
  host.className = 'ds-chat-stage'
  Object.assign(host.style, {
    position: 'fixed', inset: '0', display: 'flex', alignItems: 'flex-end',
    justifyContent: 'center', boxSizing: 'border-box', padding: '40px 20px',
    background: 'var(--bg-canvas)'
  })
  document.body.append(host)

  mountedRoot = createRoot(host)
  mountedRoot.render(<ComposerQueueFixture scenario={scenario} />)
}

export function settleComposerQueueSmokeRetry(): void {
  settleRetry?.()
  settleRetry = null
}

function ComposerQueueFixture({
  scenario
}: {
  scenario: ComposerQueueSmokeScenario
}): ReactElement {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'plan' | 'agent' | 'auto'>('agent')
  const [messages, setMessages] = useState<QueuedComposerMessage[]>(() => fixtureMessages(scenario))
  const running = scenario !== 'failed'

  return (
    <main
      data-testid="composer-queue-smoke-stage"
      data-queued-message-order={messages.map((message) => message.id).join(',')}
      className="ds-composer-dock"
      style={{ position: 'relative', width: 'min(980px, 100%)' }}
    >
      <FloatingComposer
        workspaceRootOverride="/fixture/workspace"
        activeThreadIdOverride={null}
        input={input}
        setInput={setInput}
        mode={mode}
        setMode={setMode}
        busy={running}
        runtimeReady
        hasActiveThread
        composerModel="deepseek-chat"
        composerPickList={['deepseek-chat']}
        onComposerModelChange={() => undefined}
        queuedMessages={messages}
        onRemoveQueuedMessage={(id) => {
          setMessages((current) => current.filter((message) => message.id !== id))
        }}
        onRestoreQueuedMessageToComposer={(id) => {
          const restored = messages.find((message) => message.id === id)
          if (!restored) return false
          setMessages((current) => current.filter((message) => message.id !== id))
          setInput(restored.displayText ?? restored.text)
          return true
        }}
        onReorderQueuedMessage={(id, targetId, position) => {
          setMessages((current) => reorderMessages(current, id, targetId, position))
        }}
        onGuideQueuedMessage={(id) => {
          if (scenario !== 'failed' && scenario !== 'multi') return Promise.resolve()
          return new Promise<void>((resolve) => {
            settleRetry = () => {
              setMessages((current) => current.filter((message) => message.id !== id))
              resolve()
            }
          })
        }}
        onSend={() => undefined}
        onInterrupt={() => undefined}
      />
    </main>
  )
}

function reorderMessages(
  messages: QueuedComposerMessage[],
  id: string,
  targetId: string,
  position: 'before' | 'after'
): QueuedComposerMessage[] {
  if (id === targetId) return messages
  const source = messages.find((message) => message.id === id)
  if (!source || !messages.some((message) => message.id === targetId)) return messages
  const next = messages.filter((message) => message.id !== id)
  const targetIndex = next.findIndex((message) => message.id === targetId)
  next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, source)
  return next
}

function fixtureMessages(scenario: ComposerQueueSmokeScenario): QueuedComposerMessage[] {
  if (scenario === 'failed') {
    return [message('queue-failed', 'Retry the failed deployment check', {
      deliveryState: 'failed', errorCode: 'runtime_unhealthy',
      errorMessage: 'Runtime temporarily unavailable'
    })]
  }
  if (scenario === 'multi') {
    return [
      message('queue-first', 'Review the current implementation'),
      message('queue-second', 'Then run the focused renderer tests')
    ]
  }
  if (scenario === 'long') {
    return Array.from({ length: 8 }, (_, index) => message(
      `queue-long-${index + 1}`,
      `Queued follow-up ${index + 1}: inspect the Harness-aligned composer interaction`
    ))
  }
  return [message('queue-single', 'Continue with the queued implementation review')]
}

function message(
  id: string,
  text: string,
  overrides: Partial<QueuedComposerMessage> = {}
): QueuedComposerMessage {
  return {
    id,
    text,
    displayText: text,
    deliveryState: 'pending',
    guidanceEligible: true,
    composerRestoreEligible: true,
    ...overrides
  }
}
