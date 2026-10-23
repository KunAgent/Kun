// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../../i18n'
import en from '../../locales/en/common/assistant-mailbox.json'
import type { AssistantMailboxStatus, AssistantNoteView, AssistantTaskView, AssistantView } from '@shared/assistant-mailbox'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import { AddAssistantDialog, AddAssistantForm } from './AddAssistantDialog'
import { AssistantConversationStage } from './AssistantConversationStage'
import { AssistantLogo } from './AssistantLogo'
import { AssistantThread, assistantTimeline } from './AssistantThread'
import { JoinRequestCard } from './JoinRequestCard'
import { isOpenAssistantTask, recentlySeen, relativeTime, taskHeadline } from './assistant-format'
import { resetAssistantMailboxForTests, useAssistantMailboxStore } from './assistant-mailbox-store'
import { assistantSidebarItems, filterAssistantItems, mergeConversationItems } from './assistant-sidebar'

const assistant: AssistantView = {
  id: 'as-1', enrollmentId: 'en-1', name: 'My Cue', kind: 'cue', platform: 'linux-x64', agentVersion: '0.3.0',
  createdAt: '2026-10-22T00:00:00Z', lastSeenAt: '2026-10-22T00:30:00Z', pendingToAssistant: 0, pendingToHost: 0, keyAvailable: true
}
const task = (id: string, status: AssistantTaskView['status'], updates: AssistantTaskView['updates'], createdAt = '2026-10-22T01:00:00Z'): AssistantTaskView => ({
  id, assistantId: 'as-1', assistantName: 'My Cue', title: '', body: `Task ${id}\nwith details`, createdAt, updatedAt: updates.at(-1)?.at ?? createdAt, status, updates
})
const note = (id: string, from: AssistantNoteView['from'], at: string, inReplyTo?: string): AssistantNoteView => ({
  id, from, assistantId: 'as-1', assistantName: 'My Cue', body: `${from} says ${id}`, at, ...(inReplyTo ? { inReplyTo } : {})
})
const request = { requestId: 'r1', platform: 'linux-x64', agentVersion: '0.3.0', createdAt: '2026-10-22T00:00:00Z', verificationCode: '7KQ2M-X9CHD' }
const blocked = task('t-1', 'blocked', [
  { status: 'received', body: '', at: '2026-10-22T01:02:00Z' },
  { status: 'working', body: 'Looking now', at: '2026-10-22T01:05:00Z' },
  { status: 'blocked', body: 'Which city?', at: '2026-10-22T01:10:00Z' }
])
const done = task('t-2', 'done', [{ status: 'done', body: 'Booked', at: '2026-10-22T02:10:00Z' }], '2026-10-22T02:00:00Z')
const status = (patch: Partial<AssistantMailboxStatus> = {}): AssistantMailboxStatus => ({
  availability: 'available', assistants: [assistant], enrollments: [], tasks: [done, blocked],
  notes: [note('n-2', 'you', '2026-10-22T01:20:00Z', 't-1'), note('n-1', 'assistant', '2026-10-22T00:40:00Z')], ...patch
})
/** English copy for a key, with its placeholders filled in. */
const text = (key: keyof typeof en, values: Record<string, string> = {}) =>
  Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{{${name}}}`, value), en[key] as string)

let current = status()
beforeEach(() => {
  current = status()
  Object.assign(window, { kunGui: { assistantMailbox: {
    status: async () => current, onStatus: () => () => {}, promptFor: async () => ({ code: 'KUN2-x', prompt: 'Install kun-agent and log in.' })
  } } })
})
afterEach(() => resetAssistantMailboxForTests())

/** Mounts the stage against the given mailbox state and returns its text once effects settle. */
async function stage(selection: { kind: 'assistant' | 'enrollment'; id: string }, state: AssistantMailboxStatus): Promise<{ html: string; text: string }> {
  current = state
  useAssistantMailboxStore.setState({ status: state })
  const host = document.createElement('div')
  const root = createRoot(host)
  await act(async () => { root.render(createElement(AssistantConversationStage, { selection, onToggleLeftSidebar: () => {} })) })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  const result = { html: host.innerHTML, text: host.textContent ?? '' }
  act(() => root.unmount())
  return result
}

describe('assistant conversation', () => {
  it('orders tasks, reports and notes, and asks for a reply only on the latest blocked report', () => {
    const entries = assistantTimeline('as-1', status().tasks, status().notes)
    expect(entries.map((entry) => entry.type === 'task' ? `task:${entry.task.id}` : entry.type === 'note' ? `note:${entry.note.id}`
      : `${entry.update.status}${entry.askReply ? '!' : ''}`)).toEqual(['note:n-1', 'task:t-1', 'working', 'blocked!', 'note:n-2', 'task:t-2', 'done'])
    expect(entries.find((entry) => entry.type === 'note' && entry.note.id === 'n-2')).toMatchObject({ about: 'Task t-1' })
    expect(assistantTimeline('someone-else', status().tasks, status().notes)).toEqual([])
  })

  it('renders task cards with progress, a reply action for the blocked task and cancel only while open', () => {
    const html = renderToStaticMarkup(createElement(AssistantThread, {
      assistant, tasks: status().tasks, notes: status().notes, busy: false, onReply: () => {}, onCancel: () => {}
    }))
    expect(html).toContain('Which city?')
    expect(html).toContain(`>${text('assistantReplyAction')}</button>`)
    expect(html.split(`>${text('assistantMailboxCancelTask')}</button>`)).toHaveLength(2)
    expect(html.match(new RegExp(`aria-label="${text('assistantProgress')}"`, 'g'))).toHaveLength(2)
    expect(html).toContain('you says n-2')
  })

  it('shows a durable pending task as queued until the server accepts it', () => {
    const html = renderToStaticMarkup(createElement(AssistantThread, {
      assistant, tasks: [task('pending', 'queued', [])], notes: [], busy: false, onReply: () => {}, onCancel: () => {}
    }))
    expect(html).toContain(text('assistantMailboxStatusQueued'))
    expect(html).not.toContain(text('assistantMailboxStatusSent'))
    expect(isOpenAssistantTask('queued')).toBe(true)
  })

  it('shows the thread, the welcome or a read-only composer depending on the assistant', async () => {
    const thread = await stage({ kind: 'assistant', id: 'as-1' }, status())
    expect(thread.text).toContain(text('assistantThreadIntro', { name: 'My Cue' }))
    expect(thread.html).toContain(`placeholder="${text('assistantComposerPlaceholder', { name: 'My Cue' })}"`)
    const fresh = await stage({ kind: 'assistant', id: 'as-1' }, status({ tasks: [], notes: [], assistants: [{ ...assistant, keyAvailable: false }] }))
    expect(fresh.text).toContain(text('assistantConnectedTitle', { name: 'My Cue' }))
    expect(fresh.text).toContain(text('assistantMailboxKeyMissing'))
    expect(fresh.html).not.toContain('<textarea')
    expect((await stage({ kind: 'assistant', id: 'gone' }, status())).text).toContain(text('assistantRemoved'))
  })

  it('walks through connecting inside the conversation: prompt, then the code to compare', async () => {
    const enrollment = { enrollmentId: 'en-2', name: 'My Zo', kind: 'zo', product: 'Zo', expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(), requests: [] }
    const waiting = await stage({ kind: 'enrollment', id: 'en-2' }, status({ enrollments: [enrollment] }))
    expect(waiting.text).toContain(text('assistantPromptTitle', { product: 'Zo' }))
    expect(waiting.text).toContain('Install kun-agent and log in.')
    expect(waiting.text).toContain(text('assistantWaitTitle', { product: 'Zo' }))
    expect(waiting.text).toContain(text('assistantComposerAfterConnect'))
    const asking = await stage({ kind: 'enrollment', id: 'en-2' }, status({ enrollments: [{ ...enrollment, requests: [request] }] }))
    expect(asking.text).toContain('7KQ2M-X9CHD')
    expect(asking.text).toContain(text('assistantPromptShow'))
    expect(asking.text).not.toContain(text('assistantWaitTitle', { product: 'Zo' }))
    const expired = await stage({ kind: 'enrollment', id: 'en-2' }, status({ enrollments: [{ ...enrollment, expiresAt: '2026-10-21T00:00:00Z' }] }))
    expect(expired.text).toContain(text('assistantCodeExpiredShort'))
  })

  it('lists assistants among conversations by latest activity, with unread and attention marks', () => {
    const items = assistantSidebarItems(status({ enrollments: [{ enrollmentId: 'en-3', name: 'Muse', kind: 'muse', expiresAt: '2026-10-22T03:20:00Z', requests: [request] }] }), { 'as-1': '2026-10-22T01:00:00Z' })
    expect(items.map((item) => [item.key, item.preview.type, item.attention, item.unread])).toEqual([
      ['enrollment:en-3', 'request', true, true], ['assistant:as-1', 'task', true, true]
    ])
    expect(assistantSidebarItems(status(), { 'as-1': '2026-10-22T03:00:00Z' })[0].unread).toBe(false)
    expect(filterAssistantItems(items, 'group', '')).toEqual([])
    expect(filterAssistantItems(items, 'assistants', 'muse').map((item) => item.key)).toEqual(['enrollment:en-3'])
    const room = (id: string, at: string, pinned = false) => ({ id, roomId: id, pinned, latestMessage: { createdAt: at } }) as unknown as RoomSidebarEntry
    const merged = mergeConversationItems([room('r-old', '2026-10-21T00:00:00Z', true), room('r-new', '2026-10-22T05:00:00Z'), room('r-mid', '2026-10-22T02:30:00Z')], items,
      { collapsed: false, limit: 4, selectedKey: null })
    expect(merged.map((item) => item.key)).toEqual(['room:r-old', 'room:r-new', 'enrollment:en-3', 'room:r-mid', 'assistant:as-1'])
    const collapsed = mergeConversationItems([room('r-new', '2026-10-22T05:00:00Z')], items, { collapsed: true, limit: 2, selectedKey: 'assistant:as-1' })
    expect(collapsed.map((item) => item.key)).toEqual(['room:r-new', 'assistant:as-1'])
  })

  it('offers the six presets and any other product, with logos or a monogram', () => {
    const dialog = renderToStaticMarkup(createElement(AddAssistantForm, { onClose: () => {}, onCreated: () => {} }))
    expect(dialog.match(/aria-pressed=/g)).toHaveLength(9)
    for (const name of ['Cue', 'Grok Bot', 'Muse', 'dots', 'Hark', 'Today']) expect(dialog).toContain(`<strong class="truncate text-[13px] font-semibold">${name}</strong>`)
    expect(dialog).toContain(text('assistantOtherNote'))
    // Only the chosen product's setup note is spelled out.
    expect(dialog).toContain(text('assistantPresetNoteCue'))
    expect(dialog).not.toContain(text('assistantPresetNoteMuse'))
    expect(renderToStaticMarkup(createElement(AssistantLogo, { kind: 'today', name: 'Today' }))).toMatch(/<img src="[^"]*today/)
    expect(renderToStaticMarkup(createElement(AssistantLogo, { kind: 'zo', name: 'Zo', icon: 'data:image/png;base64,AAAA' }))).toContain('src="data:image/png;base64,AAAA"')
    expect(renderToStaticMarkup(createElement(AssistantLogo, { kind: 'zo', name: '我的 Zo' }))).toContain('>Z</span>')
  })

  it('opens the connect dialog at window level, outside the sidebar that asked for it', async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
    const sidebar = document.body.appendChild(document.createElement('aside'))
    const root = createRoot(sidebar)
    let closed = 0
    await act(async () => { root.render(createElement(AddAssistantDialog, { onClose: () => { closed += 1 }, onCreated: () => {} })) })
    const dialog = document.querySelector('dialog')
    expect(dialog?.hasAttribute('open')).toBe(true)
    expect(dialog?.parentElement).toBe(document.body)
    expect(sidebar.querySelector('dialog')).toBeNull()
    expect(dialog?.querySelector('h2')?.textContent).toBe(text('assistantMailboxDialogTitle'))
    await act(async () => { dialog?.dispatchEvent(new Event('cancel', { cancelable: true })) })
    expect(closed).toBe(1)
    await act(async () => { root.unmount() })
    sidebar.remove()
  })

  it('shows the verification code to compare and blocks approval without this computer\'s key', () => {
    const html = renderToStaticMarkup(createElement(JoinRequestCard, { name: 'Cue', request, busy: false, onApprove: () => {}, onReject: () => {} }))
    expect(html).toContain('7KQ2M-X9CHD')
    expect(html.match(/disabled=""/g)).toBeNull()
    const foreign = renderToStaticMarkup(createElement(JoinRequestCard, { name: 'Cue', request: { ...request, verificationCode: null }, busy: false, onApprove: () => {}, onReject: () => {} }))
    expect(foreign).toContain(text('assistantMailboxNoKeyForRequest'))
    expect(foreign.match(/disabled=""/g)).toHaveLength(1)
  })

  it('formats times, headlines and open states', () => {
    const now = Date.parse('2026-10-22T01:00:00Z')
    expect(relativeTime('2026-10-22T00:55:00Z', 'en', now)).toBe('5 minutes ago')
    expect(relativeTime('2026-10-22T01:30:00Z', 'en', now)).toBe('in 30 minutes')
    expect([recentlySeen('2026-10-22T00:30:00Z', now), recentlySeen('2026-10-21T23:00:00Z', now), recentlySeen(null, now)]).toEqual([true, false, false])
    expect([taskHeadline('', 'First line\nsecond'), taskHeadline('Title', 'body')]).toEqual(['First line', 'Title'])
    expect(['sent', 'blocked', 'done', 'cancelled'].map((value) => isOpenAssistantTask(value as AssistantTaskView['status']))).toEqual([true, true, false, false])
  })
})
