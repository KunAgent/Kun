import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Room, RoomMessage, RoomRunStep, RoomRunSteps } from '@shared/rooms-api'
import { RoomTimeline } from './RoomTimeline'
import { RoomComposer } from './RoomComposer'
import { RoomAgentActivity } from './RoomAgentActivity'
import { RoomDirectHeader } from './RoomDirectChat'
import { applyTheme } from '../../lib/apply-theme'
import { useFocusModeStore } from '../../store/focus-mode-store'
import i18n from '../../i18n'
import '../../index.css'
import '../../styles/base-shell.css'
import './rooms-polish.css'
import './rooms-direct.css'
import './rooms-init-im.css'
import './rooms.css'
import './rooms-chat-surface.css'
import './rooms-code-surface.css'

// The production private-chat timeline, message rows, turn parts and composer.
// Only runtime responses are offline fixtures: one finished turn that ran
// commands, waited for an approval and wrote a file, then a live turn with a
// failed and a running step.
const ROOM_ID = 'turn-fixture-room'
const now = Date.now()
const at = (base: number, seconds: number) => new Date(base + seconds * 1000).toISOString()
const done = now - 2 * 3600_000
const live = now - 60_000

const room = { id: ROOM_ID, name: '小 Kun', revision: 1, conversationKind: 'user_agent', collaborationMode: 'directed',
  defaultMemberId: 'kun', repositories: [],
  members: [{ id: 'kun', displayName: '小 Kun', role: 'coordinator', enabled: true, participantAgentId: 'agent-kun' }] } as unknown as Room

let seq = 0
const message = (id: string, createdAt: string, body: string, extra: Partial<RoomMessage> = {}): RoomMessage => ({
  id, roomId: ROOM_ID, messageSeq: ++seq, authorKind: 'member', authorMemberId: 'kun', authorLabelSnapshot: '小 Kun',
  body, bodyRevision: 0, mentionMemberIds: [], attachmentIds: [], status: 'final', createdAt, ...extra
}) as RoomMessage
const user = (id: string, createdAt: string, body: string) =>
  message(id, createdAt, body, { authorKind: 'user', authorMemberId: undefined, authorLabelSnapshot: '我' })

const messages: RoomMessage[] = [
  user('ask-clean', at(done, -60), '电脑存储快满了，帮我把能清的清一下，先看浏览器缓存和下载目录'),
  message('clean-start', at(done, 0), '好，先只读测量：分清哪些是可再生的缓存、哪些是你自己的文件——只删前者，后者先给你看清单再决定。',
    { originRunId: 'run-clean', deliveryPhase: 'start' }),
  message('clean-progress', at(done, 20), '**磁盘只剩 4.3G（99%）**，确实该清了。初测：\n\n- 浏览器缓存 3.2G，可以删\n- 下载目录 9.8G，其中安装包 2.5G，其余是你的文件，不动',
    { originRunId: 'run-clean', deliveryPhase: 'progress' }),
  message('clean-final', at(done, 252), '能清的都清了，你的文件一个没动。清理清单写在 `清理清单.md` 里。',
    { originRunId: 'run-clean', deliveryPhase: 'final' }),
  user('ask-dev', at(live, 0), '顺便看看开发工具的缓存能清多少'),
  message('dev-start', at(live, 4), '好，先只读测量，不删东西。', { originRunId: 'run-live', deliveryPhase: 'start' })
]

const tool = (id: string, toolKind: 'tool_call' | 'command_execution' | 'file_change', toolName: string, target: string,
  startedAt: string, endedAt?: string, status: RoomRunStep['status'] = 'done'): RoomRunStep =>
  ({ id, kind: 'tool', toolName, toolKind, target, status, startedAt, ...(endedAt ? { endedAt } : {}) }) as RoomRunStep
const runs: Record<string, RoomRunSteps> = {
  'run-clean': {
    run: { id: 'run-clean', status: 'completed', startedAt: at(done, -1), endedAt: at(done, 252), elapsedMs: 253_000 },
    truncated: false, availability: { status: 'available' },
    steps: [
      tool('df', 'command_execution', 'bash', 'df -h /', at(done, 1), at(done, 2)),
      tool('caches', 'command_execution', 'bash', 'du -sh ~/Library/Caches/*', at(done, 3), at(done, 9)),
      tool('downloads', 'command_execution', 'bash', 'du -sh ~/Downloads', at(done, 10), at(done, 15)),
      tool('list', 'tool_call', 'ls', '~/Downloads', at(done, 16), at(done, 17)),
      { id: 'approve', kind: 'approval', toolName: 'bash', label: '删除浏览器缓存和 3 个安装包（5.7G）', status: 'allowed',
        startedAt: at(done, 25), endedAt: at(done, 195) },
      tool('rm-cache', 'command_execution', 'bash', 'rm -rf ~/Library/Caches/browser-cache', at(done, 196), at(done, 218)),
      tool('rm-dmg', 'command_execution', 'bash', 'rm ~/Downloads/*.dmg', at(done, 219), at(done, 222)),
      tool('report', 'file_change', 'write', '/Users/me/清理清单.md', at(done, 230), at(done, 231)),
      tool('df-after', 'command_execution', 'bash', 'df -h /', at(done, 240), at(done, 241))
    ]
  },
  'run-live': {
    run: { id: 'run-live', status: 'running', startedAt: at(live, 2) },
    truncated: false, availability: { status: 'available' },
    steps: [
      tool('dev-list', 'tool_call', 'ls', '~/Library/Developer', at(live, 8), at(live, 9)),
      tool('sim-list', 'tool_call', 'ls', '~/Library/Developer/CoreSimulator', at(live, 12), at(live, 13), 'failed'),
      tool('derived', 'command_execution', 'bash', 'du -sh ~/Library/Developer/Xcode/DerivedData', new Date(Date.now() - 18_000).toISOString(),
        undefined, 'running')
    ]
  }
}

const respond = (status: number, body: unknown) => ({ ok: status < 400, status, body: JSON.stringify(body) })
Object.assign(window, { kunGui: {
  platform: 'darwin', getSettings: async () => ({}),
  runtimeRequest: async (path: string) => {
    const steps = /\/runs\/([^/]+)\/steps$/.exec(path)
    if (steps) return respond(200, runs[decodeURIComponent(steps[1])])
    if (path.endsWith('/read')) return respond(200, { seq: 999 })
    if (path.endsWith('/direct/permissions')) return respond(200, { revision: 1,
      policy: { approvalPolicy: 'never', sandboxMode: 'danger-full-access', approvalReviewer: 'user' } })
    if (path.endsWith('/interactions')) return respond(404, { error: 'none' })
    return respond(200, {})
  }
} })

const opened: string[] = []
const members: string[] = []
function Fixture() {
  const [responding, setResponding] = useState(true)
  Object.assign(window, { roomTurnFixture: { opened, members, language: (language: string) => i18n.changeLanguage(language),
    theme: (mode: 'light' | 'dark') => applyTheme(mode), responding: setResponding,
    focus: (enabled: boolean) => {
      useFocusModeStore.getState().setEnabled(enabled)
      document.documentElement.setAttribute('data-focus-mode', enabled ? 'on' : 'off')
    } } })
  return <div data-rooms-workspace data-room-surface="agent-chat" data-private-chat
    className="rooms-workspace relative flex h-screen min-h-0 min-w-0 flex-1 overflow-hidden bg-ds-main">
    <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      <RoomDirectHeader room={room} onSidebar={() => undefined} onSearch={() => undefined} onProfile={() => undefined}
        onModels={() => undefined} onFiles={() => undefined} onReminders={() => undefined} onReset={() => undefined}
        onConnect={() => undefined} onTasks={() => undefined} onSession={() => undefined} sessionOpen={false}
        sessionDisabled onInfo={() => undefined} embedded onToggleLeftSidebar={() => undefined} />
      <RoomTimeline room={room} messages={messages} tasks={[]} cursor={null} moreBusy={false}
        loadEarlier={async () => undefined} onPin={() => undefined} onTask={() => undefined}
        jumpMessageId={null} onJumped={() => undefined} onRun={(id) => { opened.push(id) }}
        onMember={(id) => { members.push(id) }}
        afterMessages={responding ? <RoomAgentActivity room={room} memberId="kun" label={i18n.t('directRunningCommand')}
          startedAt={at(live, 40)} onSession={() => undefined} /> : null} />
      <RoomComposer room={room} tasks={[]} responding={responding} onStop={() => setResponding(false)}
        onSend={async () => undefined} />
    </section>
  </div>
}

document.documentElement.setAttribute('data-focus-mode', 'off')
await i18n.changeLanguage('zh')
createRoot(document.getElementById('root')!).render(<Fixture />)
