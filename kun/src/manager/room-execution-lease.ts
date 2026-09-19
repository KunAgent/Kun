import type { RuntimeFlavor } from '../contracts/runtime-flavor.js'
import { ManagerResourceLeaseClient, type ServiceManagerConnection } from './manager-client.js'
import type { ManagerResourceFence } from './resource-lease-state.js'
import { RemoteRoomStore } from './remote-room-store.js'

const RESOURCE = 'rooms-coordinator'

/** One canonical room coordinator across production/development Runtime slots. */
export class RoomExecutionLease {
  private readonly client: ManagerResourceLeaseClient
  private readonly executionStore: RemoteRoomStore
  private startPromise?: Promise<boolean>

  constructor(input: { manager: ServiceManagerConnection; flavor: RuntimeFlavor; instanceId: string }) {
    this.client = new ManagerResourceLeaseClient(input.manager, input.flavor, input.instanceId)
    this.executionStore = new RemoteRoomStore(input.manager, { getFence: () => this.getFence() })
  }

  get held(): boolean { return Boolean(this.getFence()) }

  getFence(): ManagerResourceFence | undefined { return this.client.getFence(RESOURCE) }

  /** Resolves once the first acquisition attempt has settled. */
  ready(): Promise<boolean> {
    return this.startPromise ?? Promise.resolve(this.held)
  }

  async start(): Promise<boolean> {
    this.startPromise ??= this.client.maintain({
      resource: RESOURCE,
      onAcquired: () => undefined,
      onLost: () => undefined
    })
    return this.startPromise
  }

  async assertOwnership(): Promise<void> { await this.executionStore.assertOwnership() }

  async close(): Promise<void> {
    await this.client.shutdown()
    this.startPromise = undefined
  }
}
