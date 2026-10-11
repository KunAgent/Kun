import { session } from 'electron'

export async function electronSystemProxyRules(url: string): Promise<string> {
  return Promise.race([
    session.defaultSession.resolveProxy(url),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error('System proxy resolution timed out')), 3000)
      timer.unref?.()
    })
  ])
}

export function electronProxyRuleUrl(kind: string, target: string): string {
  const protocol = ({ PROXY: 'http:', HTTPS: 'https:', SOCKS: 'socks5:',
    SOCKS5: 'socks5:', SOCKS4: 'socks4:' } as Record<string, string>)[kind.toUpperCase()]
  const authority = /^(?:\[[^\]\s]+\]|[^:[\]/\\?#@\s]+):([0-9]+)$/u.exec(target)
  const port = Number(authority?.[1])
  if (!protocol || !authority || !Number.isInteger(port) || port < 1 || port > 65535) return ''
  try {
    const url = new URL(`${protocol}//${target}`)
    // URL normalizes explicit HTTP :80 / HTTPS :443 to an empty port.
    // Validate the original authority above rather than losing valid defaults.
    return url.hostname && !url.username && !url.password && (!url.pathname || url.pathname === '/') &&
      !url.search && !url.hash ? url.toString() : ''
  } catch {
    return ''
  }
}

/** Provider probes retain their existing ordered supported-proxy selection. */
export async function resolveElectronSystemProxyUrl(url: string): Promise<string> {
  try {
    for (const entry of (await electronSystemProxyRules(url)).split(';')) {
      const [kind = '', target = ''] = entry.trim().split(/\s+/, 2)
      const proxy = electronProxyRuleUrl(kind, target)
      if (proxy) return proxy
    }
  } catch {
    // A system policy failure must not expose proxy credentials in diagnostic logs.
  }
  return ''
}
