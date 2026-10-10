import { hasKunAccountSession, type KunAccountState } from '../../shared/kun-account'
import type { ArtState } from '../../shared/kun-art'
import type { ArtAccountAccess } from './account-access'
import type { ArtAssetService } from './service'
export const signedOutArt = (): ArtState => ({ phase: 'signed_out', manifest: null, completed: 0, total: 0 })
/** A session change immediately fences old downloads, callbacks and local protocol reads. */
export class ArtAccountSession {
  private identity: string | null = null
  private epoch = 0
  private active?: ArtAssetService
  private transitioning: Promise<void> = Promise.resolve()
  private stopped = false
  private unsubscribe: () => void
  constructor(private readonly deps: {
    account: ArtAccountAccess
    create(changed: (state: ArtState) => void, current: () => boolean): ArtAssetService
    changed(state: ArtState): void
    reset(): Promise<void>
  }) {
    this.unsubscribe = deps.account.onState(state => { void this.accountChanged(state) })
  }
  private accountChanged(state: KunAccountState): Promise<void> {
    const identity = hasKunAccountSession(state) ? state.user?.id ?? null : null
    if (this.stopped || identity === this.identity) return this.transitioning
    this.identity = identity
    const epoch = ++this.epoch, old = this.active
    this.active = undefined
    old?.dispose()
    this.deps.changed(identity ? { ...signedOutArt(), phase: 'checking' } : signedOutArt())
    this.transitioning = this.transitioning.catch(() => undefined).then(async () => {
      await old?.stop()
      if (epoch !== this.epoch || this.stopped) return
      if (!identity) { await this.deps.reset().catch(() => undefined); return }
      const current = () => !this.stopped && epoch === this.epoch && this.identity === identity
      this.active = this.deps.create(state => { if (current()) this.deps.changed(state) }, current)
      // A successful sign-in starts the update automatically.
      void this.active.check()
    })
    return this.transitioning
  }
  private async service(): Promise<ArtAssetService | undefined> {
    await this.accountChanged(await this.deps.account.getState())
    return this.active
  }
  async getState(): Promise<ArtState> { return (await this.service())?.getState() ?? signedOutArt() }
  async checkIfDue(): Promise<ArtState> { return (await this.service())?.checkIfDue() ?? signedOutArt() }
  async resource(url: string): Promise<Uint8Array> {
    const service = await this.service(), epoch = this.epoch
    if (!service) throw new Error('login_required')
    const result = await service.resource(url)
    if (epoch !== this.epoch || this.stopped) throw new Error('account_changed')
    return result
  }
  dispose(): void { this.stopped = true; this.epoch++; this.unsubscribe(); this.active?.dispose(); this.active = undefined }
}
