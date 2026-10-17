import { execFile } from 'node:child_process'
import { isIP } from 'node:net'
import { createProxyFetch } from '../adapters/model/proxy-fetch.js'
import { assertGmailWireFence } from './google-wire-fence.js'

const CACHE_MS = 10_000
const MAX_REPORT_BYTES = 65_536
const PROBE_TIMEOUT_MS = 2_000
type SystemProxyDependencies = { platform: NodeJS.Platform; now: () => number; report: () => Promise<string> }

/** Read only the global HTTPS proxy. PAC scripts, scoped routes and proxy authentication are unsupported. */
export function parseMacHttpsProxyReport(report: string): string | undefined {
  if (Buffer.byteLength(report) > MAX_REPORT_BYTES) return undefined
  const lines = report.trim().split(/\r?\n/u)
  if (lines[0]?.trim() !== '<dictionary> {') return undefined
  const fields = new Map<string, string>()
  let depth = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (depth === 1) {
      const field = /^(HTTPSEnable|HTTPSProxy|HTTPSPort)\s*:\s*(.*?)\s*$/u.exec(trimmed)
      if (field) {
        if (fields.has(field[1])) return undefined
        fields.set(field[1], field[2])
      }
    }
    if (/<(?:dictionary|array)>\s*\{$/u.test(trimmed)) depth += 1
    else if (trimmed === '}') depth -= 1
    if (depth < 0) return undefined
  }
  if (depth !== 0 || fields.get('HTTPSEnable') !== '1') return undefined
  const host = fields.get('HTTPSProxy') ?? ''
  const port = fields.get('HTTPSPort') ?? ''
  const dnsHost = host.length <= 253 && host.split('.').every((label) =>
    /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/u.test(label))
  if (!isIP(host) && (!dnsHost || /^[\d.]+$/u.test(host))) return undefined
  if (!/^[1-9]\d{0,4}$/u.test(port) || Number(port) > 65_535) return undefined
  return `http://${isIP(host) === 6 ? `[${host}]` : host}:${port}`
}

/** Fixed utility, no shell and no report/credential output in errors or logs. */
function readSystemProxyReport(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8', timeout: PROBE_TIMEOUT_MS,
      maxBuffer: MAX_REPORT_BYTES, windowsHide: true }, (error, stdout) => {
      if (error) reject(new Error('System HTTPS proxy settings are unavailable'))
      else resolve(stdout)
    })
  })
}

export class MacSystemHttpsProxy {
  private cached?: { expiresAt: number; value: Promise<string | undefined> }
  constructor(private readonly dependencies: SystemProxyDependencies = {
    platform: process.platform, now: Date.now, report: readSystemProxyReport
  }) {}

  async resolve(): Promise<string | undefined> {
    if (this.dependencies.platform !== 'darwin') return undefined
    const now = this.dependencies.now()
    if (this.cached && this.cached.expiresAt > now) return this.cached.value
    const value = this.dependencies.report().then(parseMacHttpsProxyReport, () => undefined)
    this.cached = { expiresAt: now + CACHE_MS, value }
    return value
  }
}

/** Google mail/OAuth only. Explicit application proxy wins; an empty setting uses macOS HTTPS fallback. */
export function createGmailGoogleFetch(input: {
  appProxy: () => Promise<string | undefined>
}, dependencies: { systemProxy?: Pick<MacSystemHttpsProxy, 'resolve'>; directFetch?: typeof fetch;
  proxyFetch?: (url: string) => typeof fetch | null } = {}): typeof fetch {
  const system = dependencies.systemProxy ?? new MacSystemHttpsProxy()
  return async (request, init) => {
    const destination = assertGoogleDestination(request)
    const target = typeof request === 'string' || request instanceof URL ? destination : request
    assertGmailWireFence(init)
    const explicit = (await input.appProxy())?.trim()
    const proxyUrl = explicit || await system.resolve() || ''
    const transport = (dependencies.proxyFetch ?? createProxyFetch)(proxyUrl) ?? dependencies.directFetch ?? fetch
    init?.signal?.throwIfAborted()
    assertGmailWireFence(init)
    assertGoogleDestination(target)
    return transport(target, { ...init, redirect: 'error' })
  }
}

function assertGoogleDestination(input: Parameters<typeof fetch>[0]): string {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const token = url.origin === 'https://oauth2.googleapis.com' && ['/token', '/revoke'].includes(url.pathname) && !url.search
  const mail = url.origin === 'https://gmail.googleapis.com' &&
    /^\/gmail\/v1\/users\/me\/(?:profile|messages(?:\/[A-Za-z0-9_-]{1,128})?)$/u.test(url.pathname)
  if ((!token && !mail) || url.username || url.password || url.hash) throw new Error('Unexpected Gmail transport destination')
  return url.href
}
