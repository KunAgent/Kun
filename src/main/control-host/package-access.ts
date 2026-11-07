import type { ControlPackageManager, RpcPeer } from '@kun/control-host'

type Operation = 'check' | 'install' | 'apply' | 'recover'
type Manager = Pick<ControlPackageManager, 'initialize' | 'status' | Operation>

/** Separates restoring local state from the explicit intent to use or install remote control. */
export class ControlPackageAccess {
  private startup?: Promise<void>
  private queue: Promise<unknown> = Promise.resolve()
  private installation?: ReturnType<Manager['install']>
  private demand?: Promise<RpcPeer>
  constructor(private manager: Manager, private current: () => RpcPeer | undefined, private stopped: () => boolean) {}
  initialize() {
    return this.startup ??= this.manager.initialize().then(() => {})
  }
  private assertRunning() { if (this.stopped()) throw Error('CONTROL_HOST_STOPPED') }
  async available() {
    await this.initialize().catch(() => {})
    this.assertRunning()
    const rpc = this.current()
    return rpc && !rpc.closed ? rpc : undefined
  }
  async ready(): Promise<RpcPeer> {
    const existing = await this.available()
    if (existing) return existing
    if (this.demand) return this.demand
    const task = this.enqueue(async () => {
      // Apply/recovery may have restored a usable package while this request waited.
      // A demand for a runtime must not silently become a newer-package update.
      const restored = this.current()
      if (restored && !restored.closed) return restored
      await this.manager.install()
      this.assertRunning()
      const installed = this.current()
      if (!installed || installed.closed) throw Error('CONTROL_PROCESS_UNAVAILABLE')
      return installed
    })
    const demand = task.finally(() => { if (this.demand === demand) this.demand = undefined })
    this.demand = demand
    return demand
  }
  private enqueue<T>(run: () => Promise<T>) {
    const task = this.queue.catch(() => {}).then(async () => {
      await this.initialize().catch(() => {})
      this.assertRunning()
      return run()
    })
    this.queue = task
    return task
  }
  operation(operation: Operation) {
    if (operation === 'install' && this.installation) return this.installation
    const task = this.enqueue(() => {
      const restored = operation === 'recover' ? this.current() : undefined
      if (restored && !restored.closed) return Promise.resolve(this.manager.status())
      return this.manager[operation]()
    })
    if (operation !== 'install') return task
    const installation = task.finally(() => { if (this.installation === installation) this.installation = undefined })
    this.installation = installation
    return installation
  }
}
