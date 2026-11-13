import { RemoteWorkboardApi, validateWorkboardSnapshot, type RemoteApi } from '@kun/remote-protocol'
import type { ProtectedRuntimeRequestLease } from '../ipc/app-ipc-handler-options'
import { sessionOperation } from './lifecycle'

/** A single bounded metadata publisher per enabled phone-access session. */
export class MobileWorkboard {
  private active?: { api: RemoteApi; control: AbortController }
  constructor(private deps: { lease(): Promise<ProtectedRuntimeRequestLease>; diagnostic?(code: string): void }) {}
  stop() { this.active?.control.abort(); this.active = undefined }
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
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
      const timer = setTimeout(done, ms); timer.unref?.(); signal.addEventListener('abort', done, { once: true })
    })
  }
  private async run(api: RemoteWorkboardApi, signal: AbortSignal, current: () => boolean) {
    let epoch: string | undefined, sequence = 0, attempt = 0
    while (current()) {
      try {
        if (!epoch) { epoch = (await api.publisher(signal)).epoch; sequence = 0 }
        if (!current()) return
        const lease = await sessionOperation(() => this.deps.lease(), signal)
        const response = await sessionOperation(() => lease.request('/v1/remote/workboard', 'GET'), signal)
        if (!current()) return
        if (!response.ok || response.body.length > 65536) throw Error('WORKBOARD_RUNTIME_UNAVAILABLE')
        const snapshot = validateWorkboardSnapshot(JSON.parse(response.body))
        await api.publish(epoch, ++sequence, snapshot, signal)
        if (!current()) return
        attempt = 0
        // New pending states are visible within one sample; no per-conversation streams.
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
