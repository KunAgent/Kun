import type { AppSettingsV1 } from '../../shared/app-settings'

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
}

/** Browser settings updates must not turn a configured-feed read into an arbitrary host fetch. */
export async function remoteFeedAccessError(
  body: unknown, approvedFeeds: ReadonlySet<string> | null, getSettings: () => Promise<AppSettingsV1>
): Promise<string | null> {
  const channel = field(body, 'channel')
  const args = field(body, 'args')
  const payload = Array.isArray(args) ? args[0] as unknown : undefined
  if (channel === 'paper-discover:feed') {
    const url = field(payload, 'url')
    return typeof url === 'string' && approvedFeeds?.has(url)
      ? null : 'Only host-approved feeds are available over Remote'
  }
  if (channel !== 'settings:set' && channel !== 'settings:save-silent') return null
  const requested = field(field(field(field(payload, 'write'), 'paperMode'), 'discover'), 'feeds')
  if (requested === undefined) return null
  let current: AppSettingsV1
  try { current = await getSettings() } catch { return 'Cannot verify host feed subscriptions' }
  const urls = current.write?.paperMode?.discover?.feeds?.map((feed) => feed.url) ?? []
  return Array.isArray(requested) && requested.length === urls.length &&
    requested.every((feed: unknown, index: number) => field(feed, 'url') === urls[index])
    ? null : 'Remote cannot change host feed subscriptions'
}
