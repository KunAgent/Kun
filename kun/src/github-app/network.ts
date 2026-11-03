import { MacSystemHttpsProxy } from '../gmail/google-network-transport.js'
import { createProxyFetch } from '../adapters/model/proxy-fetch.js'

export const GITHUB_WIRE_FENCE = Symbol('github-wire-fence')
export type GitHubFetchInit = RequestInit & { [GITHUB_WIRE_FENCE]?: () => void }

/** Fixed GitHub destinations, with the same explicit/system proxy precedence as Gmail. */
export function createGitHubFetch(appProxy: () => Promise<string>): typeof fetch {
  const system = new MacSystemHttpsProxy()
  return async (input, init) => {
    const fence = (init as GitHubFetchInit | undefined)?.[GITHUB_WIRE_FENCE]
    fence?.()
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    if (!['https://github.com', 'https://api.github.com', 'https://api.githubcopilot.com'].includes(url.origin) ||
        url.username || url.password || url.hash) throw new Error('Unexpected GitHub destination')
    const proxy = (await appProxy()).trim() || await system.resolve() || ''
    init?.signal?.throwIfAborted()
    fence?.()
    return (createProxyFetch(proxy) ?? fetch)(input, { ...init, redirect: 'error' })
  }
}
