export type MobilePage =
  | { kind: 'home' }
  | { kind: 'new' }
  | { kind: 'conversation'; threadId: string }
  | { kind: 'settings' }

const PAGE_KEY = 'mobile'
const THREAD_KEY = 'thread'

export function readMobilePage(url: URL): MobilePage {
  const kind = url.searchParams.get(PAGE_KEY)
  if (kind === 'new' || kind === 'settings') return { kind }
  const threadId = url.searchParams.get(THREAD_KEY)
  if (kind === 'conversation' && threadId && threadId.length <= 512) {
    return { kind, threadId }
  }
  return { kind: 'home' }
}

/** Only navigation identifiers belong in URLs, never drafts or credentials. */
export function mobilePageUrl(url: URL, page: MobilePage): string {
  const next = new URL(url)
  next.searchParams.set(PAGE_KEY, page.kind)
  if (page.kind === 'conversation') next.searchParams.set(THREAD_KEY, page.threadId)
  else next.searchParams.delete(THREAD_KEY)
  return next.pathname + next.search + next.hash
}

export function sameMobilePage(left: MobilePage, right: MobilePage): boolean {
  if (left.kind !== right.kind) return false
  return left.kind !== 'conversation'
    || (right.kind === 'conversation' && left.threadId === right.threadId)
}
