// Personal assistants as rows of the Code conversation list: what each row says, which filters
// keep it, and where it sits among Rooms (pinned Rooms first, then everything by latest activity).
import type { AssistantMailboxStatus, AssistantTaskStatus } from '@shared/assistant-mailbox'
import type { RoomSidebarEntry } from '@shared/rooms-api'
import type { ConversationFilter } from '../chat/sidebar-agent-chats'
import type { AssistantSelection } from './assistant-navigation'

export type AssistantPreview =
  | { type: 'task'; status: AssistantTaskStatus; text: string }
  | { type: 'note'; text: string }
  | { type: 'you'; text: string }
  | { type: 'connected' }
  | { type: 'enrolling' }
  | { type: 'request' }

export type AssistantSidebarItem = {
  key: string
  selection: AssistantSelection
  name: string
  kind: string
  product?: string
  icon?: string
  time: string
  preview: AssistantPreview
  attention: boolean
  working: boolean
  unread: boolean
}

export type ConversationItem =
  | { type: 'room'; key: string; time: string; entry: RoomSidebarEntry }
  | { type: 'assistant'; key: string; time: string; item: AssistantSidebarItem }

const headline = (title: string, body: string) => title.trim() || body.trim().split('\n')[0] || ''

export function assistantSidebarItems(status: AssistantMailboxStatus | null, readAt: Readonly<Record<string, string>>): AssistantSidebarItem[] {
  if (!status || status.availability !== 'available') return []
  const assistants = status.assistants.map((assistant): AssistantSidebarItem => {
    const tasks = status.tasks.filter((task) => task.assistantId === assistant.id)
    const notes = status.notes.filter((note) => note.assistantId === assistant.id)
    type Event = { at: string; incoming: boolean; preview: AssistantPreview }
    const events: Event[] = []
    for (const task of tasks) {
      const title = headline(task.title, task.body)
      events.push({ at: task.createdAt, incoming: false, preview: { type: 'task', status: task.status, text: title } })
      for (const update of task.updates) {
        events.push({ at: update.at, incoming: true, preview: { type: 'task', status: update.status, text: update.body.trim() || title } })
      }
      if (task.status === 'cancelled') events.push({ at: task.updatedAt, incoming: false, preview: { type: 'task', status: 'cancelled', text: title } })
    }
    for (const note of notes) {
      events.push({ at: note.at, incoming: note.from === 'assistant', preview: note.from === 'you' ? { type: 'you', text: note.body } : { type: 'note', text: note.title || note.body } })
    }
    events.sort((a, b) => a.at.localeCompare(b.at))
    const latest = events[events.length - 1]
    const latestIncoming = [...events].reverse().find((event) => event.incoming)
    return {
      key: `assistant:${assistant.id}`,
      selection: { kind: 'assistant', id: assistant.id },
      name: assistant.name, kind: assistant.kind, product: assistant.product, icon: assistant.icon,
      time: latest?.at ?? assistant.createdAt,
      preview: latest?.preview ?? { type: 'connected' },
      attention: tasks.some((task) => task.status === 'blocked'),
      working: tasks.some((task) => task.status === 'received' || task.status === 'working'),
      unread: Boolean(latestIncoming && latestIncoming.at > (readAt[assistant.id] ?? ''))
    }
  })
  const enrollments = status.enrollments.map((enrollment): AssistantSidebarItem => ({
    key: `enrollment:${enrollment.enrollmentId}`,
    selection: { kind: 'enrollment', id: enrollment.enrollmentId },
    name: enrollment.name, kind: enrollment.kind, product: enrollment.product, icon: enrollment.icon,
    // Codes live for 30 minutes, so this is when the enrollment started.
    time: new Date(Date.parse(enrollment.expiresAt) - 30 * 60_000).toISOString(),
    preview: enrollment.requests.length ? { type: 'request' } : { type: 'enrolling' },
    attention: enrollment.requests.length > 0,
    working: false,
    unread: enrollment.requests.length > 0
  }))
  return [...enrollments, ...assistants]
}

export function filterAssistantItems(items: AssistantSidebarItem[], filter: ConversationFilter, search: string): AssistantSidebarItem[] {
  const query = search.trim().toLowerCase()
  return items.filter((item) => {
    if (query && !`${item.name} ${item.product ?? ''} ${item.kind}`.toLowerCase().includes(query)) return false
    if (filter === 'group') return false
    if (filter === 'unread') return item.unread
    if (filter === 'attention') return item.attention
    return true
  })
}

/** Pinned Rooms stay on top; the rest interleave by latest activity. Collapsed lists keep the selection visible. */
export function mergeConversationItems(rooms: RoomSidebarEntry[], assistants: AssistantSidebarItem[],
  options: { collapsed: boolean; limit: number; selectedKey: string | null }): ConversationItem[] {
  const roomItems = rooms.map((entry): ConversationItem => ({
    type: 'room', key: entry.roomId ? `room:${entry.roomId}` : `entry:${entry.id}`, time: entry.latestMessage?.createdAt ?? '', entry
  }))
  const pinned = roomItems.filter((item) => item.type === 'room' && item.entry.pinned)
  const rest = [...roomItems.filter((item) => item.type === 'room' && !item.entry.pinned),
    ...assistants.map((item): ConversationItem => ({ type: 'assistant', key: item.key, time: item.time, item }))]
    .sort((a, b) => b.time.localeCompare(a.time))
  const merged = [...pinned, ...rest]
  if (!options.collapsed) return merged
  const visible = merged.slice(0, options.limit)
  const selected = merged.find((item) => item.key === options.selectedKey)
  if (selected && !visible.includes(selected)) visible.splice(options.limit - 1, 1, selected)
  return visible
}
