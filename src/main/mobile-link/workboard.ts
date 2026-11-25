import { RemoteWorkboardApi, validateWorkboardSnapshot, type RemoteApi, type WorkboardHostSnapshot } from '@kun/remote-protocol'
import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'
import { sessionOperation } from './lifecycle'
import type { WorkboardCompletionAttention } from '../../shared/workboard-attention'


const TERMINAL_RETENTION_MS = 600000

/** Overlay renderer-owned read state without adding titles, text or paths to the metadata snapshot. */
export function applyCompletionAttention(
  snapshot: WorkboardHostSnapshot,
  attention: WorkboardCompletionAttention
): WorkboardHostSnapshot {
  const cutoff = snapshot.observedAt - TERMINAL_RETENTION_MS
  const sessions = snapshot.sessions.flatMap(row => {
    if (row.kind === 'code' && ['completed', 'failed'].includes(row.phase)) {
      const unread = attention[row.id] === row.phase
      if (row.phase === 'completed' && !unread && row.updatedAt < cutoff) return []
      return [{ ...row, unread }]
    }
    if (['completed', 'stopped'].includes(row.phase) && row.updatedAt < cutoff) return []
    return [row]
  })
  return { ...snapshot, schemaVersion: 2, sessions }
}

/** A single bounded metadata publisher per enabled phone-access session. */
export class MobileWorkboard {
  private active?: { api: RemoteApi; control: AbortController }
  private attentionVersion = 0
  private wake?: () => void
  constructor(private deps: {
    lease(): Promise<ProtectedRuntimeRequestLease>
    completionAttention?(): WorkboardCompletionAttention
    diagnostic?(code: string): void
  }) {}
  stop() { this.active?.control.abort(); this.active = undefined }
  nudge() {
    this.attentionVersion += 1
    this.wake?.()
  }
  start(api: RemoteApi, eligible: () => boolean) {
    if (this.active?.api === api) return
    this.stop()
    const active = { api, control: new AbortController() }; this.active = active
    const current = () => this.active === active && !active.control.signal.aborted && eligible()
    void this.run(new RemoteWorkboardApi(api), active.control.signal, current).catch(() => {
      if (current()) this.deps.diagnostic?.('WORKBOARD_UNAVAILABLE')
    })
  }
  private async pause(ms: number, signal: AbortSignal) {
    await new Promise<void>(resolve => {
      if (signal.aborted) return resolve()
      const done = () => {
        if (this.wake === done) this.wake = undefined
        clearTimeout(timer)
        signal.removeEventListener('abort', done)
        resolve()
      }
      const timer = setTimeout(done, ms); timer.unref?.()
      this.wake = done
      signal.addEventListener('abort', done, { once: true })
    })
  }
  private async run(api: RemoteWorkboardApi, signal: AbortSignal, current: () => boolean) {
    let epoch: string | undefined, sequence = 0, attempt = 0
    while (current()) {
      try {
        if (!epoch) { epoch = (await api.publisher(signal)).epoch; sequence = 0 }
        if (!current()) return
        const lease = await sessionOperation(() => this.deps.lease(), signal)
        const response = await sessionOperation(() => lease.request('/v1/remote/workboard', 'POST', JSON.stringify({
          attention: this.deps.completionAttention?.() ?? {}
        })), signal)
        if (!current()) return
        if (!response.ok || response.body.length > 65536) throw Error('WORKBOARD_RUNTIME_UNAVAILABLE')
        const runtimeSnapshot = validateWorkboardSnapshot(JSON.parse(response.body))
        const snapshot = validateWorkboardSnapshot(
          applyCompletionAttention(runtimeSnapshot, this.deps.completionAttention?.() ?? {})
        )
        const publishedAttention = this.attentionVersion
        await api.publish(epoch, ++sequence, snapshot, signal)
        if (!current()) return
        attempt = 0
        if (publishedAttention !== this.attentionVersion) continue
        // New pending states are visible within one sample; read-state changes wake the sampler.
        await this.pause(15000, signal)
      } catch (error) {
        if (!current()) return
        const code = (error as { code?: string; status?: number }).code
        if (code === 'conflict') { epoch = undefined; return } // a newer publisher owns this host
        if (['unauthorized', 'vip_mobile_remote_required', 'forbidden'].includes(code ?? '')) return
        this.deps.diagnostic?.('WORKBOARD_PUBLISH_RETRY')
        await this.pause(Math.min(300000, 15000 * 2 ** Math.min(attempt++, 5)), signal)
      }
    }
  }
}
