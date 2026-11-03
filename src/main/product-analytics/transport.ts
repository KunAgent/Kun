import { z } from 'zod'
import { AnalyticsConfig, ANALYTICS_POLICY, type AnalyticsEvent } from '../../shared/product-analytics'
const ORIGIN = 'https://api-kun-server.com'
const Session = z.object({ sessionId: z.string().uuid(), credential: z.string().min(16).max(512).optional(),
  expiresAt: z.string().datetime() }).strip()
export type AnalyticsSession = z.infer<typeof Session> & { headers: Record<string, string> }
export class AnalyticsHttpError extends Error {
  constructor(readonly status: number, readonly retryMs = 30_000) { super('analytics_unavailable') }
}
export class AnalyticsTransport {
  constructor(private readonly fetcher: typeof fetch) {}
  async request(path: string, method: string, headers: Record<string, string>, body?: unknown, signal?: AbortSignal): Promise<unknown> {
    if (!path.startsWith('/api/product-')) throw new Error('analytics_path')
    const response = await this.fetcher(ORIGIN + path, { method, headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), credentials: 'omit', redirect: 'error', cache: 'no-store',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) })
    if (!response.ok) {
      const retry = Number(response.headers.get('Retry-After'))
      await response.body?.cancel()
      throw new AnalyticsHttpError(response.status, Number.isFinite(retry) && retry > 0 ? Math.min(3600_000, retry * 1000) : 30_000)
    }
    if (response.status === 204) return null
    const reader = response.body?.getReader(); if (!reader) throw new Error('analytics_empty_response')
    const chunks: Uint8Array[] = []; let size = 0
    try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break
        size += chunk.value.byteLength; if (size > 128 * 1024) throw new Error('analytics_response_limit')
        chunks.push(chunk.value)
      }
    } finally { await reader.cancel().catch(() => {}) }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }
  async config(signal?: AbortSignal) {
    return AnalyticsConfig.parse(await this.request('/api/product-experience/v1/config', 'GET', {}, undefined, signal))
  }
  async session(installationId: string, token: string | null, signal: AbortSignal): Promise<AnalyticsSession> {
    const auth: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
    const value = Session.parse(await this.request('/api/product-analytics/v1/sessions', 'POST', auth,
      { installationId, policyVersion: ANALYTICS_POLICY, schemaVersion: 1 }, signal))
    if (!token && !value.credential) throw new Error('analytics_guest_credential_missing')
    return { ...value, headers: token ? auth : { 'X-Kun-Analytics': value.credential! } }
  }
  async send(session: AnalyticsSession, events: AnalyticsEvent[], signal: AbortSignal): Promise<string[]> {
    const result = z.object({ acceptedEventIds: z.array(z.string().uuid()).max(50),
      rejected: z.array(z.object({ eventId: z.string().uuid(), code: z.string().max(80) })).max(50).default([]) })
      .parse(await this.request('/api/product-analytics/v1/events', 'POST', session.headers,
        { sessionId: session.sessionId, schemaVersion: 1, events }, signal))
    const submitted = new Set(events.map(e => e.eventId))
    return [...result.acceptedEventIds, ...result.rejected.map(e => e.eventId)].filter(id => submitted.has(id))
  }
  async revoke(session: AnalyticsSession) {
    await this.request('/api/product-analytics/v1/sessions/' + session.sessionId, 'DELETE', session.headers).catch(() => {})
  }
}
