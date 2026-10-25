import { useEffect, useState, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { ChatBlock } from '../../src/renderer/src/agent/types'
import '../../src/renderer/src/index.css'
import '../../src/renderer/src/styles/base-shell.css'
import '../../src/renderer/src/styles/markdown-code.css'
import '../../src/renderer/src/styles/neutral-polish.css'

// Production timeline, selection toolbar, composer and side-conversation
// panel over synthetic host data. Nothing here starts an agent or reads a
// user profile; sends are not exercised.
Object.assign(window, {
  kunGui: {
    platform: 'darwin',
    // Empty answers for the usage and background-shell reads the composer makes.
    runtimeRequest: async () => ({
      ok: true, status: 200, body: JSON.stringify({ buckets: [], sessions: [], running: 0 })
    }),
    openPath: async () => undefined,
    openExternal: async () => undefined,
    writeClipboardText: async () => undefined
  }
})
const [
  { MessageTimeline },
  { FloatingComposer },
  { SideConversationPanel },
  { useChatStore },
  { useMessageQuoteStore },
  { composerContextChip },
  { createMessageQuoteAttachment },
  theme,
  language
] = await Promise.all([
  import('../../src/renderer/src/components/chat/MessageTimeline'),
  import('../../src/renderer/src/components/chat/FloatingComposer'),
  import('../../src/renderer/src/components/chat/SideConversationPanel'),
  import('../../src/renderer/src/store/chat-store'),
  import('../../src/renderer/src/store/message-quote-store'),
  import('../../src/renderer/src/components/workbench/useWorkbenchExtensionContext'),
  import('../../src/renderer/src/lib/message-quote'),
  import('../../src/renderer/src/lib/apply-theme'),
  import('../../src/renderer/src/i18n')
])
await language.default.changeLanguage('zh')
theme.applyTheme('light')

const THREAD = 'thr-quote'
const sentQuote = await createMessageQuoteAttachment({
  workspaceRoot: '/fixture',
  quote: {
    id: 'sent',
    text: '远程 Agent 的派发依赖多宿主调度',
    role: 'assistant',
    charCount: 17,
    truncated: false,
    sourceBlockId: 'assistant-plan'
  }
})
const blocks: ChatBlock[] = [
  { kind: 'user', id: 'user-ask', turnId: 'turn-1', text: '帮我梳理一下定时任务从旧页面迁到新外壳要改哪些地方' },
  {
    kind: 'assistant',
    id: 'assistant-plan',
    turnId: 'turn-1',
    text: [
      '后端代码在两条分支上一致，真正要做的是把定时任务页面接入新外壳。建议按三步走：',
      '',
      '1. **挂载页面**：把定时任务页挂到新外壳的路由下，继续复用现有的 store 和 IPC 通道。',
      '2. **核对执行目标**：逐个确认「用户助手」「远程 Agent」在新外壳里的派发路径，缺的适配器补上。',
      '3. **清理旧入口**：旧页面保留一个版本的兼容跳转，下个版本再删。',
      '',
      '其中第 2 步风险最高：远程 Agent 的派发依赖多宿主调度，建议先写一个最小的冒烟用例再动手。'
    ].join('\n')
  },
  {
    kind: 'user',
    id: 'user-reply',
    turnId: 'turn-2',
    text: '多宿主调度具体指哪几个进程？',
    meta: { composerContexts: [sentQuote] }
  },
  {
    kind: 'assistant',
    id: 'assistant-answer',
    turnId: 'turn-2',
    text: '这里的多宿主调度指三层进程：主进程、Runtime Manager 和 `kun serve`。迁移时只要保证第二层的派发表在新外壳里同样注册即可。'
  }
]

useChatStore.setState({
  route: 'chat', workspaceRoot: '/fixture', activeThreadId: THREAD,
  runtimeConnection: 'ready', threadLoadingId: null, threadRefreshingId: null,
  busy: false, busyUnconfirmed: false, currentTurnId: null, currentTurnUserId: null,
  threads: [{ id: THREAD, title: '定时任务迁移计划', updatedAt: new Date().toISOString(),
    status: 'idle', model: 'fixture', mode: 'agent', workspace: '/fixture' }],
  blocks, liveAssistant: '', liveReasoning: '', threadHasMoreHistory: false,
  extensionComposerContexts: [], sideConversations: {},
  sidePanel: { open: false, activeSideId: null },
  composerModel: 'deepseek-v4-pro', composerProviderId: '', composerPickList: ['deepseek-v4-pro']
})

const noop = (): void => undefined
const fixture = {
  ready: false,
  theme: theme.applyTheme,
  sidePanelOpen: false
}
Object.assign(window, { messageQuoteFixture: fixture })

function MainComposer(): ReactElement {
  const [input, setInput] = useState('')
  const contexts = useChatStore((state) => state.extensionComposerContexts)
  const removeComposerContext = useChatStore((state) => state.removeComposerContext)
  return (
    <div data-primary-floating-composer className="ds-composer-dock flex justify-center px-6 pb-3">
      <FloatingComposer
        input={input}
        setInput={setInput}
        mode="agent"
        setMode={noop}
        busy={false}
        runtimeReady
        hasActiveThread
        composerModel="deepseek-v4-pro"
        composerProviderId=""
        composerPickList={['deepseek-v4-pro']}
        composerModelGroups={[]}
        composerReasoningEffort="high"
        composerFastMode={false}
        contextChips={contexts.map(composerContextChip)}
        onRemoveContextChip={removeComposerContext}
        queuedMessages={[]}
        onRemoveQueuedMessage={noop}
        onSend={noop}
        onInterrupt={noop}
        hideBtwCommand
      />
    </div>
  )
}

function Fixture(): ReactElement {
  const [sideOpen, setSideOpen] = useState(false)
  const reveal = useMessageQuoteStore((state) => state.sideDraftRevealRequest)
  const openSideConversationDraft = useChatStore((state) => state.openSideConversationDraft)
  useEffect(() => {
    if (!reveal) return
    openSideConversationDraft()
    setSideOpen(true)
    fixture.sidePanelOpen = true
  }, [openSideConversationDraft, reveal])
  return (
    <main className="fixture-shell">
      <section className="fixture-stage ds-chat-stage">
        <MessageTimeline
          blocks={blocks}
          liveReasoning=""
          live=""
          activeThreadId={THREAD}
          runtimeConnection="ready"
          onRetryConnection={noop}
          onOpenSettings={noop}
          messageSelectionToolbar
        />
        <MainComposer />
      </section>
      {sideOpen ? (
        <aside className="fixture-side">
          <SideConversationPanel variant="docked" onRequestClose={() => setSideOpen(false)} />
        </aside>
      ) : null}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
fixture.ready = true
