import { electronProxyRuleUrl, electronSystemProxyRules } from '../electron-system-proxy'

/**
 * Resolves the desktop's proxy decision for one Browser Use destination.
 * Returns the first HTTP forward proxy Chromium would use, or `''` for DIRECT
 * and for proxy kinds the policy proxy cannot tunnel through (SOCKS, HTTPS).
 */
export async function resolveBrowserUseUpstreamProxy(
  url: string,
  resolveRules: (url: string) => Promise<string> = electronSystemProxyRules
): Promise<string> {
  let rules: string
  try {
    rules = await resolveRules(url)
  } catch {
    return ''
  }
  for (const entry of rules.split(';')) {
    const [kind = '', target = ''] = entry.trim().split(/\s+/, 2)
    if (kind.toUpperCase() === 'DIRECT') return ''
    if (kind.toUpperCase() !== 'PROXY') continue
    const proxyUrl = electronProxyRuleUrl(kind, target)
    if (proxyUrl) return proxyUrl
  }
  return ''
}
