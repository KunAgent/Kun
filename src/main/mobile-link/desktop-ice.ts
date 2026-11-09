import { RemoteApi, type DeviceIdentity } from '@kun/remote-protocol'
import type { ArtAccountAccess } from '../art-assets/account-access'
import { hasKunAccountSession } from '../../shared/kun-account'
import type { DesktopAuthority } from '../remote-desktop/session-service'

// Bound ICE preparation within the 15-second host setup window, leaving time for capture.
export const DESKTOP_ICE_TIMEOUT_MS = 9000
type Diagnostic = { event: 'ice_ready' | 'ice_failed'; stage: 'account' | 'identity' | 'token' | 'request' | 'response';
  elapsedMs: number; reason?: 'timeout' | 'authorization' | 'http' | 'network' | 'invalid_response' | 'identity'; status?: number }
type Dependencies = {
  account: Pick<ArtAccountAccess, 'getState' | 'accessToken'>
  identity(owner: string): Promise<DeviceIdentity>
  fetch: typeof globalThis.fetch
  origin: string
  diagnostic?(value: Diagnostic): void
}

function validIce(value: unknown): value is { schemaVersion: 1; expiresAt: number; iceServers: unknown[] } {
  if (!value || typeof value !== 'object') return false
  const result = value as { schemaVersion?: unknown; expiresAt?: unknown; iceServers?: unknown }
  return result.schemaVersion === 1 && typeof result.expiresAt === 'number' && Number.isFinite(result.expiresAt) &&
    result.expiresAt > Date.now() && Array.isArray(result.iceServers) && result.iceServers.length > 0 && result.iceServers.length <= 8 &&
    result.iceServers.every(server => {
      if (!server || typeof server !== 'object') return false
      const urls: unknown[] = Array.isArray(server.urls) ? server.urls : [server.urls]
      return urls.length > 0 && urls.length <= 8 && urls.every(url => typeof url === 'string' && /^(stun|stuns|turn|turns):[^\s]{1,2048}$/.test(url))
    })
}

export class DesktopIceClient {
  constructor(private readonly deps: Dependencies) {}
  async request(authority: DesktopAuthority): Promise<unknown[]> {
    const started = performance.now(), abort = new AbortController()
    const progress: { stage: Diagnostic['stage'] } = { stage: 'account' }
    let expire!: (error: Error) => void
    const deadline = new Promise<never>((_resolve, reject) => { expire = reject })
    const timer = setTimeout(() => { abort.abort(); expire(Error('DESKTOP_ICE_UNAVAILABLE')) }, DESKTOP_ICE_TIMEOUT_MS)
    const current = () => { if (!authority.current()) throw Error('DESKTOP_AUTHORITY_CHANGED'); abort.signal.throwIfAborted() }
    const report = (value: Omit<Diagnostic, 'stage' | 'elapsedMs'>) => {
      try { this.deps.diagnostic?.({ ...value, stage: progress.stage, elapsedMs: Math.max(0, Math.round(performance.now() - started)) }) } catch { /* Non-authoritative diagnostics. */ }
    }
    try {
      return await Promise.race([deadline, (async () => {
        const state = await this.deps.account.getState(); current()
        if (!hasKunAccountSession(state) || state.user?.id !== authority.accountId) throw Error('DESKTOP_AUTHORITY_CHANGED')
        const api = new RemoteApi({ origin: this.deps.origin,
          identity: async () => { progress.stage = 'identity'; current(); const identity = await this.deps.identity(authority.accountId); current(); return identity },
          token: async () => { progress.stage = 'token'; current(); const token = await this.deps.account.accessToken(); current(); if (!token) throw Error('DESKTOP_AUTHORITY_CHANGED'); return token },
          fetch: (input, init) => { progress.stage = 'request'; current(); return this.deps.fetch(input, init) }
        })
        const value = await api.request('/desktop/ice', 'POST', { peerDeviceId: authority.deviceId }, false, abort.signal)
        progress.stage = 'response'; current()
        if (!validIce(value)) throw Error('DESKTOP_ICE_UNAVAILABLE')
        report({ event: 'ice_ready' })
        return value.iceServers
      })()])
    } catch (error) {
      const changed = !authority.current() || error instanceof Error && error.message === 'DESKTOP_AUTHORITY_CHANGED'
      const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : undefined
      report({ event: 'ice_failed', reason: changed ? 'authorization' : abort.signal.aborted ? 'timeout' : status ? 'http' :
        progress.stage === 'response' || error instanceof SyntaxError ? 'invalid_response' : progress.stage === 'identity' ? 'identity' : 'network',
        ...(status && Number.isInteger(status) && status >= 100 && status < 600 ? { status } : {}) })
      throw Error(changed ? 'DESKTOP_AUTHORITY_CHANGED' : 'DESKTOP_ICE_UNAVAILABLE')
    } finally { clearTimeout(timer) }
  }
}
