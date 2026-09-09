import { type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { ChatBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { useSpeakStore } from '../../stores/speak-store'
import { SpeakDownloadToast } from '../SpeakDownloadToast'
import { speakStoredPlaybackCount, speakingDroppedSeconds } from './speak-controller'
import { MessageBubble } from './message-timeline-bubbles'

/**
 * Renders a finished assistant answer with its action row so the Speak control
 * can be driven end to end in the real application shell.
 */
let mountedRoot: Root | null = null

const ANSWER = [
  '## Remaining limitations',
  '',
  'The run finished and every suite passed. Speak reads this answer aloud with',
  'the selected Kokoro voice.',
  '',
  '```sh',
  'npm test',
  '```',
  '',
  '- Backend: 14 of 14 passing',
  '- End to end: 9 of 9 passing'
].join('\n')

export function mountAssistantSpeakSmokeFixture(): void {
  mountedRoot?.unmount()
  document.body.replaceChildren()
  document.body.style.margin = '0'
  useChatStore.setState({ route: 'chat' })
  useSpeakStore.getState().reset()

  const host = document.createElement('div')
  host.dataset.assistantSpeakSmokeHost = 'ready'
  Object.assign(host.style, {
    position: 'fixed', inset: '0', boxSizing: 'border-box',
    padding: '40px', overflow: 'auto', background: 'var(--bg-canvas)'
  })
  document.body.append(host)
  mountedRoot = createRoot(host)
  mountedRoot.render(<AssistantSpeakFixture />)
}

/** Speak state, exposed so the smoke can assert phases without polling the DOM. */
export function readAssistantSpeakSmokeState(): {
  activeBlockId: string | null
  phase: string
  error: string | null
  downloadAsset: string | null
  spokenChunks: number
  droppedSeconds: number
  storedPlaybacks: number
} {
  const state = useSpeakStore.getState()
  return {
    activeBlockId: state.activeBlockId,
    phase: state.phase,
    error: state.error,
    downloadAsset: state.download?.asset ?? null,
    spokenChunks: state.progress?.spoken ?? 0,
    droppedSeconds: speakingDroppedSeconds(),
    storedPlaybacks: speakStoredPlaybackCount()
  }
}

function assistantBlock(): ChatBlock {
  return {
    kind: 'assistant',
    id: 'speak-smoke-answer',
    text: ANSWER,
    createdAt: '2026-06-07T00:00:00.000Z'
  } as ChatBlock
}

function AssistantSpeakFixture(): ReactElement {
  return (
    <main
      data-testid="assistant-speak-smoke-stage"
      className="ds-chat-stage mx-auto flex w-full max-w-3xl flex-col gap-4"
    >
      <MessageBubble block={assistantBlock()} />
      <SpeakDownloadToast />
    </main>
  )
}
