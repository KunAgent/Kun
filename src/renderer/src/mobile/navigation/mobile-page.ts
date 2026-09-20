export type MobileMode = 'code' | 'rooms' | 'work'
export type WorkResourceView = 'read' | 'edit' | 'assistant' | 'review' | 'whiteboard'
export type MobilePage =
  | { mode: MobileMode; kind: 'home' }
  | { mode: 'code'; kind: 'new' }
  | { mode: 'code'; kind: 'conversation'; threadId: string }
  | { mode: 'rooms'; kind: 'room'; roomId: string }
  | { mode: 'rooms'; kind: 'reply'; roomId: string; messageId: string }
  | { mode: 'rooms'; kind: 'run'; roomId: string; runId: string }
  | { mode: 'rooms'; kind: 'task'; roomId: string; taskId: string }
  | { mode: 'rooms'; kind: 'member'; roomId: string; memberId: string }
  | { mode: 'work'; kind: 'resource'; resourceKey: string; view: WorkResourceView }
  | { mode: MobileMode; kind: 'settings' }

const MAX_IDENTIFIER_LENGTH = 512
const MODES = new Set<MobileMode>(['code', 'rooms', 'work'])
const WORK_VIEWS = new Set<WorkResourceView>(['read', 'edit', 'assistant', 'review', 'whiteboard'])
const MANAGED_KEYS = ['mode', 'mobile', 'thread', 'room', 'message', 'run', 'task', 'member', 'resource', 'view']

function identifier(url: URL, key: string): string | null {
  const value = url.searchParams.get(key)
  return value && value.length <= MAX_IDENTIFIER_LENGTH ? value : null
}

export function readMobilePage(url: URL): MobilePage {
  const rawMode = url.searchParams.get('mode')
  const mode: MobileMode = MODES.has(rawMode as MobileMode) ? rawMode as MobileMode : 'code'
  const kind = url.searchParams.get('mobile')
  if (kind === 'settings') return { mode, kind }
  if (kind === 'home' || !kind) return { mode, kind: 'home' }
  if (mode === 'code') {
    if (kind === 'new') return { mode, kind }
    const threadId = identifier(url, 'thread')
    if (kind === 'conversation' && threadId) return { mode, kind, threadId }
  }
  if (mode === 'rooms') {
    const roomId = identifier(url, 'room')
    if (!roomId) return { mode, kind: 'home' }
    if (kind === 'room') return { mode, kind, roomId }
    const routes = [
      ['reply', 'message', 'messageId'], ['run', 'run', 'runId'],
      ['task', 'task', 'taskId'], ['member', 'member', 'memberId']
    ] as const
    for (const [route, key, property] of routes) {
      const id = identifier(url, key)
      if (kind === route && id) return { mode, kind: route, roomId, [property]: id } as MobilePage
    }
  }
  if (mode === 'work' && kind === 'resource') {
    const resourceKey = identifier(url, 'resource')
    const view = url.searchParams.get('view') as WorkResourceView | null
    if (resourceKey && view && WORK_VIEWS.has(view)) return { mode, kind, resourceKey, view }
  }
  return { mode, kind: 'home' }
}

/** Only opaque navigation identifiers belong in URLs, never drafts, paths or credentials. */
export function mobilePageUrl(url: URL, page: MobilePage): string {
  const next = new URL(url)
  for (const key of MANAGED_KEYS) next.searchParams.delete(key)
  next.searchParams.set('mode', page.mode)
  next.searchParams.set('mobile', page.kind)
  if (page.kind === 'conversation') next.searchParams.set('thread', page.threadId)
  if ('roomId' in page) next.searchParams.set('room', page.roomId)
  if (page.kind === 'reply') next.searchParams.set('message', page.messageId)
  if (page.kind === 'run') next.searchParams.set('run', page.runId)
  if (page.kind === 'task') next.searchParams.set('task', page.taskId)
  if (page.kind === 'member') next.searchParams.set('member', page.memberId)
  if (page.kind === 'resource') {
    next.searchParams.set('resource', page.resourceKey)
    next.searchParams.set('view', page.view)
  }
  return next.pathname + next.search + next.hash
}

export function sameMobilePage(left: MobilePage, right: MobilePage): boolean {
  if (left.mode !== right.mode || left.kind !== right.kind) return false
  return mobilePageUrl(new URL('https://mobile.invalid/'), left)
    === mobilePageUrl(new URL('https://mobile.invalid/'), right)
}
