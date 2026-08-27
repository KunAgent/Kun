/** Secret-free lifecycle messages used to drain renderer-owned provider mutations. */
export type ProviderMutationFlushRequest = {
  requestId: string
  deadlineMs: number
}

export type ProviderMutationFlushResult = {
  requestId: string
  ok: boolean
  pendingProviderIds: string[]
  mutationKinds: Array<'profile' | 'catalog' | 'credential' | 'deletion'>
  errorCode?: 'renderer-unavailable' | 'timeout' | 'flush-failed' | 'invalid-ack'
}

export type ProviderMutationFlushRequestHandler = (
  request: ProviderMutationFlushRequest
) => Promise<ProviderMutationFlushResult>
