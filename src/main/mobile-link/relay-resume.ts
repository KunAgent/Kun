import type { ArtAccountAccess } from '../art-assets/account-access'
import { hasKunAccountSession, type KunAccountState } from '../../shared/kun-account'
import type { MobileLinkStatus } from '../../shared/mobile-link'
import type { RelayPreference } from './relay-preference'

type Relay = {
  enable(value: boolean, keepGrants?: boolean): Promise<MobileLinkStatus>
  dispose(keepAccess?: boolean): void
}
// Retrying cannot help until the account or the user acts.
const FINAL = new Set(['LOGIN_REQUIRED', 'SECURE_STORAGE_REQUIRED'])
export const RESUME_RETRY_MS = [15000, 30000, 60000, 120000, 300000, 300000]

/**
 * Restores the Kun iOS relay at launch for an account that left it on. A resumed relay keeps its cloud grants, so
 * approved phones reconnect without pairing again. An explicit stop, sign-out or account switch forgets the choice
 * and still revokes every grant; quitting keeps them only while the choice is remembered.
 */
export class MobileRelayResume {
  private owner: string | null | undefined
  private remembered = new Set<string>()
  private serial = 0
  private timer?: ReturnType<typeof setTimeout>
  private stopListening: () => void
  private stopEnding: () => void
  constructor(private deps: {
    account: ArtAccountAccess
    relay: Relay
    preference: RelayPreference
    diagnostic?(code: string): void
  }) {
    this.stopListening = deps.account.onState((state) => this.observe(state))
    this.stopEnding = deps.account.onSessionEnding?.((session) =>
      session.userId ? this.forget(session.userId) : Promise.resolve()) ?? (() => {})
    void deps.account.getState().then((state) => this.observe(state), () => {})
  }
  /** The user's switch. A remembered account restarts with its grants; a stop forgets before it revokes. */
  async manual(value: boolean): Promise<MobileLinkStatus> {
    this.cancel()
    const owner = this.owner
    if (!value) {
      if (owner) await this.forget(owner)
      return this.deps.relay.enable(false)
    }
    const status = await this.deps.relay.enable(true, Boolean(owner && this.remembered.has(owner)))
    if (owner && owner === this.owner && status.enabled) await this.remember(owner)
    return status
  }
  dispose() {
    this.cancel()
    this.stopListening()
    this.stopEnding()
    this.deps.relay.dispose(Boolean(this.owner && this.remembered.has(this.owner)))
  }
  private observe(state: KunAccountState) {
    const next = hasKunAccountSession(state) ? state.user!.id : null
    if (next === this.owner) return
    const previous = this.owner
    this.owner = next
    this.cancel()
    // Sign-out or a switch ended that account's remote session; it must not come back by itself.
    if (previous) void this.forget(previous)
    if (next) void this.load(next, this.serial)
  }
  private async load(owner: string, serial: number) {
    if (!(await this.deps.preference.remembered(owner)) || serial !== this.serial) return
    this.remembered.add(owner)
    await this.resume(owner, serial, 0)
  }
  private async resume(owner: string, serial: number, attempt: number) {
    try {
      await this.deps.relay.enable(true, true)
      this.deps.diagnostic?.('RELAY_RESUMED')
    } catch (error) {
      if (serial !== this.serial || !this.remembered.has(owner)) return
      if (FINAL.has(error instanceof Error ? error.message : '') || attempt >= RESUME_RETRY_MS.length) return
      this.deps.diagnostic?.('RELAY_RESUME_RETRY')
      this.timer = setTimeout(() => void this.resume(owner, serial, attempt + 1), RESUME_RETRY_MS[attempt])
    }
  }
  private async remember(owner: string) {
    try {
      await this.deps.preference.remember(owner)
      // A sign-out that finished during the write must not leave the choice behind.
      if (owner === this.owner) this.remembered.add(owner)
      else await this.deps.preference.forget(owner)
    } catch {
      this.deps.diagnostic?.('RELAY_PREFERENCE_FAILED')
    }
  }
  private async forget(owner: string) {
    this.remembered.delete(owner)
    if (owner === this.owner) this.cancel()
    await this.deps.preference.forget(owner).catch(() => this.deps.diagnostic?.('RELAY_PREFERENCE_FAILED'))
  }
  private cancel() {
    ++this.serial
    clearTimeout(this.timer)
    this.timer = undefined
  }
}
