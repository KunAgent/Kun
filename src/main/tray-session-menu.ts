import type { MenuItemConstructorOptions } from 'electron'
import type { AppSettingsV1 } from '../shared/app-settings'

export type TrayThreadSummary = {
  id: string
  title: string
  workspace?: string
  status: string
  updatedAt: string
}

type TrayMenuActions = {
  openThread: (threadId: string) => void
  newChat: () => void
  openDailyNotes: () => void
  openApp: () => void
  quit: () => void
}

const PRIMARY_GROUP_LIMIT = 5
const MORE_GROUP_LIMIT = 10

export function parseTrayThreads(body: string): TrayThreadSummary[] {
  try {
    const value = JSON.parse(body) as { threads?: unknown }
    if (!Array.isArray(value.threads)) return []
    return value.threads.flatMap((candidate) => {
      if (!candidate || typeof candidate !== 'object') return []
      const thread = candidate as Record<string, unknown>
      if (typeof thread.id !== 'string' || typeof thread.updatedAt !== 'string') return []
      const status = typeof thread.status === 'string' ? thread.status : 'idle'
      if (status === 'archived' || status === 'deleted') return []
      return [{
        id: thread.id,
        title: typeof thread.title === 'string' ? thread.title : '',
        workspace: typeof thread.workspace === 'string' ? thread.workspace : undefined,
        status,
        updatedAt: thread.updatedAt
      }]
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  } catch {
    return []
  }
}

export function buildTrayMenuTemplate(input: {
  locale: AppSettingsV1['locale']
  threads: TrayThreadSummary[]
  actions: TrayMenuActions
}): MenuItemConstructorOptions[] {
  const labels = traySessionLabels(input.locale)
  const running = input.threads.filter((thread) => thread.status === 'running')
  const recent = input.threads.filter((thread) => thread.status !== 'running')
  const template: MenuItemConstructorOptions[] = []

  appendThreadGroup(template, labels.running, running.slice(0, PRIMARY_GROUP_LIMIT), input.actions)
  appendThreadGroup(template, labels.recent, recent.slice(0, PRIMARY_GROUP_LIMIT), input.actions)

  const overflow = [...running.slice(PRIMARY_GROUP_LIMIT), ...recent.slice(PRIMARY_GROUP_LIMIT)]
    .slice(0, MORE_GROUP_LIMIT)
  if (overflow.length > 0) {
    template.push({
      label: labels.more,
      submenu: overflow.map((thread) => threadMenuItem(thread, input.actions))
    })
  }
  if (template.length > 0) template.push({ type: 'separator' })
  template.push(
    { label: labels.newChat, click: input.actions.newChat },
    { label: labels.dailyNotes, click: input.actions.openDailyNotes },
    { type: 'separator' },
    { label: labels.openApp, click: input.actions.openApp },
    { type: 'separator' },
    { label: labels.quit, click: input.actions.quit }
  )
  return template
}

function appendThreadGroup(
  template: MenuItemConstructorOptions[],
  label: string,
  threads: TrayThreadSummary[],
  actions: TrayMenuActions
): void {
  if (threads.length === 0) return
  if (template.length > 0) template.push({ type: 'separator' })
  template.push({ label, enabled: false })
  template.push(...threads.map((thread) => threadMenuItem(thread, actions)))
}

function threadMenuItem(
  thread: TrayThreadSummary,
  actions: TrayMenuActions
): MenuItemConstructorOptions {
  return {
    label: truncateMenuLabel(thread.title.trim() || 'Untitled'),
    sublabel: projectLabel(thread.workspace),
    click: () => actions.openThread(thread.id)
  }
}

function projectLabel(workspace: string | undefined): string | undefined {
  const value = workspace?.trim().replace(/[\\/]+$/, '')
  if (!value) return undefined
  // Split on both POSIX '/' and Windows '\\' so the label is correct on every
  // platform — node:path.basename only honors the host OS separator.
  const segments = value.split(/[\\/]+/)
  return segments[segments.length - 1] || value
}

function truncateMenuLabel(value: string): string {
  return value.length > 48 ? `${value.slice(0, 47)}…` : value
}

function traySessionLabels(locale: AppSettingsV1['locale']): {
  running: string
  recent: string
  more: string
  newChat: string
  dailyNotes: string
  openApp: string
  quit: string
} {
  return locale === 'zh'
    ? {
        running: '运行中',
        recent: '最近会话',
        more: '更多',
        newChat: '新建会话',
        dailyNotes: '每日待办与笔记',
        openApp: '打开 Kun',
        quit: '退出'
      }
    : {
        running: 'Running',
        recent: 'Recent',
        more: 'More',
        newChat: 'New Chat',
        dailyNotes: 'Daily notes & to-dos',
        openApp: 'Open Kun',
        quit: 'Exit'
      }
}
