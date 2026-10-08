import type { RuntimeFlavor } from '../contracts/runtime-flavor.js'
import { ManagerResourceLeaseClient, type ServiceManagerConnection } from './manager-client.js'
import { RESOURCE_LEASE_TICK_MS, RESOURCE_LEASE_TTL_MS, type ManagerResourceFence } from './resource-lease-state.js'
import { RemoteRoomStore } from './remote-room-store.js'
import { RoomCoordinatorUnavailableError } from '../rooms/room-store.js'

const RESOURCE = 'rooms-coordinator'
/**
 * A previous holder that died without releasing keeps the lease until its TTL expires, and the
 * next acquisition attempt lands on a tick. Waiting less than that fails the first send after a restart.
 */
const READINESS_TIMEOUT_MS = RESOURCE_LEASE_TTL_MS + RESOURCE_LEASE_TICK_MS + 2_000

/** One canonical room coordinator across production/development Runtime slots. */
export class RoomExecutionLease {
  private readonly client: ManagerResourceLeaseClient
  private readonly executionStore: RemoteRoomStore
  private startPromise?: Promise<boolean>
  private acquiredOnce = false
  private admissionClosed = false
  private readonly waiters = new Set<(held: boolean) => void>()

  constructor(input: { manager: ServiceManagerConnection; flavor: RuntimeFlavor; instanceId: string }) {
    this.client = new ManagerResourceLeaseClient(input.manager, input.flavor, input.instanceId)
    this.executionStore = new RemoteRoomStore(input.manager, { getFence: () => this.getFence() })
  }

  get held(): boolean { return Boolean(this.getFence()) }

  getFence(): ManagerResourceFence | undefined { return this.client.getFence(RESOURCE) }

  /** Only startup commits wait; a running operation must fail closed on lease loss. */
  async ready(): Promise<void> {
    if (!this.acquiredOnce) await this.waitForOwnership()
  }

  /** Admission may wait for startup/recovery, without ever bypassing Manager fencing. */
  async waitForOwnership(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    if (this.admissionClosed) throw new RoomCoordinatorUnavailableError()
    if (this.held) return
    const held = await new Promise<boolean>((resolve) => {
      const finish = (value: boolean) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        this.waiters.delete(finish)
        resolve(value)
      }
      const abort = () => finish(false)
      const timer = setTimeout(() => finish(false), READINESS_TIMEOUT_MS)
      timer.unref?.()
      this.waiters.add(finish)
      signal?.addEventListener('abort', abort, { once: true })
    })
    signal?.throwIfAborted()
    if (!held || this.admissionClosed || !this.held) throw new RoomCoordinatorUnavailableError()
  }

  /** Unblock pending admissions before draining room work during shutdown. */
  closeAdmission(): void {
    this.admissionClosed = true
    this.settleWaiters(false)
  }

  private settleWaiters(held: boolean): void {
    for (const finish of this.waiters) finish(held)
  }

  async start(): Promise<boolean> {
    if (this.admissionClosed) return false
    this.startPromise ??= this.client.maintain({
      resource: RESOURCE,
      onAcquired: () => {
        this.acquiredOnce = true
        this.settleWaiters(true)
      },
      onLost: () => undefined
    })
    return this.startPromise
  }

  async assertOwnership(): Promise<void> { await this.executionStore.assertOwnership() }

  async close(): Promise<void> {
    this.closeAdmission()
    await this.client.shutdown()
  }
}
