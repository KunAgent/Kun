import { useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ChatBlock } from '../../src/renderer/src/agent/types'
import { ChatTimelineZoomFixture } from './chat-timeline-zoom'
import '../../src/renderer/src/index.css'
import '../../src/renderer/src/styles/base-shell.css'
import '../../src/renderer/src/styles/markdown-code.css'
import '../../src/renderer/src/styles/neutral-polish.css'

// Use the production timeline, store, Markdown and styles. Only host data and
// services are synthetic; this fixture never starts an agent or opens user data.
Object.assign(window, {
  kunGui: {
    platform: 'linux',
    runtimeRequest: async () => ({ ok: true, status: 200, body: JSON.stringify({ buckets: [] }) }),
    openPath: async () => undefined,
    openExternal: async () => undefined,
    writeClipboardText: async () => undefined
  }
})
const [{ MessageTimeline }, { StreamdownAssistant }, { useChatStore }, theme, language] = await Promise.all([
  import('../../src/renderer/src/components/chat/MessageTimeline'),
  import('../../src/renderer/src/components/chat/StreamdownAssistant'),
  import('../../src/renderer/src/store/chat-store'),
  import('../../src/renderer/src/lib/apply-theme'),
  import('../../src/renderer/src/i18n')
])
await language.default.changeLanguage('en')
theme.applyTheme('light')

type FixtureState = { mode: 'timeline' | 'text' | 'zoom'; count: number; id: string; text: string; streaming: boolean }
let current: FixtureState = { mode: 'timeline', count: 500, id: 'chat-a', text: '', streaming: true }
let update: (state: FixtureState) => void = () => undefined
function blocksFor(state: FixtureState): ChatBlock[] {
  const blocks: ChatBlock[] = [{ kind: 'user', id: `${state.id}-user`, turnId: `${state.id}-turn`,
    text: `Inspect a long background task (${state.id}).` }]
  for (let index = 0; index < state.count; index += 1) {
    const common = { id: `${state.id}-step-${index}`, turnId: `${state.id}-turn` }
    blocks.push(index % 2 === 0
      ? { ...common, kind: 'tool', summary: `Read source file ${index}`, status: 'success', toolKind: 'command_execution',
        detail: `Source ${index} inspected.`, meta: { toolName: 'read', path: `/fixture/file-${index}.ts` } }
      : { ...common, kind: 'assistant', text: `**Step ${index}**: verified background result ${index}.\n\nNext, inspect the dependent module.` })
  }
  return blocks
}
function present(next: FixtureState): void {
  current = next
  useChatStore.setState({
    route: 'chat', workspaceRoot: '/fixture', activeThreadId: next.id,
    runtimeConnection: 'ready', threadLoadingId: null, threadRefreshingId: null,
    busy: true, busyUnconfirmed: false, currentTurnId: `${next.id}-turn`,
    currentTurnUserId: `${next.id}-user`, currentTurnStartedAtMs: Date.now(),
    threads: [{ id: next.id, title: next.id, updatedAt: new Date().toISOString(),
      status: 'running', model: 'fixture', mode: 'agent', workspace: '/fixture' }],
    blocks: blocksFor(next), liveAssistant: '', liveReasoning: '',
    threadHasMoreHistory: false, turnStartedAtByUserId: {}, turnDurationByUserId: {},
    turnReasoningFirstAtByUserId: {}, turnReasoningLastAtByUserId: {}
  })
  update(next)
}
const fixture = {
  ready: false,
  load: (count: number, id = 'chat-a') => present({ ...current, mode: 'timeline', count, id }),
  append: (count: number) => present({ ...current, count: current.count + count }),
  text: (text: string, streaming = true) => present({ ...current, mode: 'text', text, streaming }),
  zoom: (scale: number) => {
    theme.applyUiFontScale(scale)
    present({ ...current, mode: 'zoom' })
  },
  theme: theme.applyTheme
}
Object.assign(window, { chatRenderingFixture: fixture })
function Fixture(): ReactElement {
  const [state, setState] = useState(current)
  update = setState
  const blocks = useChatStore((value) => value.blocks)
  return <main className="fixture-shell">
    <header>Background conversation rendering | {state.id} | {state.count} records</header>
    <section className="fixture-stage ds-chat-stage">
      {state.mode === 'timeline' ? <MessageTimeline key={state.id} blocks={blocks}
        liveReasoning="" live="" activeThreadId={state.id} runtimeConnection="ready"
        onRetryConnection={() => undefined} onOpenSettings={() => undefined} />
        : state.mode === 'zoom' ? <ChatTimelineZoomFixture />
        : <div data-testid="reveal-output"><StreamdownAssistant text={state.text} streaming={state.streaming} /></div>}
    </section>
  </main>
}
present(current)
createRoot(document.getElementById('root')!).render(<Fixture />)
fixture.ready = true
