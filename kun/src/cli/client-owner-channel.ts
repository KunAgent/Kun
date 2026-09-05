import process from 'node:process'
import type { RuntimeClientOwnerKind } from '../contracts/runtime-owner.js'

export type RuntimeClientOwnerChannel = {
  connected?: boolean
  send?: unknown
  once(event: 'disconnect', listener: () => void): unknown
  removeListener(event: 'disconnect', listener: () => void): unknown
}

export type RuntimeClientOwnerMonitor = {
  disconnected: Promise<void>
  dispose(): void
}

export class RuntimeClientOwnerChannelUnavailableError extends Error {
  readonly code = 'runtime_client_owner_channel_unavailable'

  constructor(readonly ownerKind: RuntimeClientOwnerKind) {
    super(`${ownerKind}-owned runtime requires a live IPC owner channel`)
    this.name = 'RuntimeClientOwnerChannelUnavailableError'
  }
}

/**
 * Subscribe to the kernel-backed parent IPC channel before Runtime startup.
 * A resolved promise is the abnormal-owner-exit signal consumed by serve mode.
 */
export function monitorRuntimeClientOwnerChannel(
  ownerKind: RuntimeClientOwnerKind,
  channel: RuntimeClientOwnerChannel = process
): RuntimeClientOwnerMonitor {
  if (typeof channel.send !== 'function' || channel.connected !== true) {
    throw new RuntimeClientOwnerChannelUnavailableError(ownerKind)
  }
  let signalDisconnect!: () => void
  const disconnected = new Promise<void>((resolve) => { signalDisconnect = resolve })
  const onDisconnect = (): void => signalDisconnect()
  channel.once('disconnect', onDisconnect)
  return {
    disconnected,
    dispose: () => channel.removeListener('disconnect', onDisconnect)
  }
}
