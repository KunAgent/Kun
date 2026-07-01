import type { ThreadRemoteTarget } from '../contracts/threads.js'
import type { RemoteExecutionHandle } from '../ports/remote-execution.js'
import { SshRemoteExecutionHandle, type SshRemoteExecutionHandleOptions } from './remote-execution-handle.js'

export type RemoteTargetRegistryDeps = {
  loadBinding: (threadId: string) => Promise<ThreadRemoteTarget | null | undefined>
  handleOptions?: Omit<SshRemoteExecutionHandleOptions, 'binding'>
}

export class RemoteTargetRegistry {
  private readonly handles = new Map<string, RemoteExecutionHandle>()

  constructor(private readonly deps: RemoteTargetRegistryDeps) {}

  async prime(threadId: string): Promise<void> {
    if (this.handles.has(threadId)) return
    const binding = await this.deps.loadBinding(threadId)
    if (!binding) return
    this.handles.set(threadId, new SshRemoteExecutionHandle({ binding, ...this.deps.handleOptions }))
  }

  resolve(threadId: string): RemoteExecutionHandle | undefined {
    return this.handles.get(threadId)
  }

  evict(threadId: string): void {
    this.handles.delete(threadId)
  }
}
