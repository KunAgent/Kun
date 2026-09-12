import type { RuntimeFlavor } from '../contracts/runtime-flavor.js'
import { ManagerResourceLeaseClient, type ServiceManagerConnection } from './manager-client.js'
import type { ManagerResourceFence } from './resource-lease-state.js'
import { RemoteRoomStore } from './remote-room-store.js'

const RESOURCE = 'rooms-coordinator'

/** One canonical room coordinator across production/development Runtime slots. */
export class RoomExecutionLease {
  private readonly client: ManagerResourceLeaseClient
  private readonly executionStore: RemoteRoomStore
  private started = false

  constructor(input: { manager: ServiceManagerConnection; flavor: RuntimeFlavor; instanceId: string }) {
    this.client = new ManagerResourceLeaseClient(input.manager, input.flavor, input.instanceId)
    this.executionStore = new RemoteRoomStore(input.manager, { getFence: () => this.getFence() })
  }

  get held(): boolean { return Boolean(this.getFence()) }

  getFence(): ManagerResourceFence | undefined { return this.client.getFence(RESOURCE) }

  async start(): Promise<boolean> {
    if (this.started) return this.held
    this.started = true
    return this.client.maintain({ resource: RESOURCE, onAcquired: () => undefined, onLost: () => undefined })
  }

  async assertOwnership(): Promise<void> { await this.executionStore.assertOwnership() }

  async close(): Promise<void> {
    await this.client.shutdown()
    this.started = false
  }
}
