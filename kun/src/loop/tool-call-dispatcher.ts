import type {
  ToolCallLike,
  ToolHostContext,
  ToolHostResult,
  ToolProviderKind
} from '../ports/tool-host.js'

const PARALLEL_READ_ONLY_TOOL_NAMES = new Set(['read', 'grep', 'find', 'ls'])
const DELEGATE_TASK_TOOL_NAME = 'delegate_task'
const MAX_PARALLEL_TOOL_CALLS = 3

export type ToolCallDispatchInput = {
  calls: readonly ToolCallLike[]
  approvalPolicy: ToolHostContext['approvalPolicy']
  toolProviderKinds: ReadonlyMap<string, ToolProviderKind | undefined>
  signal: AbortSignal
}

export type ToolCallDispatchDependencies = {
  inspectStorm: (call: ToolCallLike) => { suppress: boolean; reason?: string } | undefined
  execute: (call: ToolCallLike) => Promise<ToolHostResult>
  persistResult: (call: ToolCallLike, result: ToolHostResult) => Promise<void>
  persistSuppressed: (call: ToolCallLike, reason?: string) => Promise<void>
  markProgress: (toolName: string) => void
}

function isParallelDelegationCall(
  call: ToolCallLike,
  toolProviderKinds: ReadonlyMap<string, ToolProviderKind | undefined>
): boolean {
  return (
    call.toolName === DELEGATE_TASK_TOOL_NAME &&
    toolProviderKinds.get(call.toolName) === 'delegation'
  )
}

function isParallelSafeToolCall(input: ToolCallDispatchInput, call: ToolCallLike): boolean {
  if (
    input.approvalPolicy === 'always' ||
    input.approvalPolicy === 'untrusted' ||
    input.approvalPolicy === 'never'
  ) {
    return false
  }
  if (isParallelDelegationCall(call, input.toolProviderKinds)) return true
  if (!PARALLEL_READ_ONLY_TOOL_NAMES.has(call.toolName)) return false
  if (call.toolKind && call.toolKind !== 'tool_call') return false
  return input.toolProviderKinds.get(call.toolName) === 'built-in'
}

export async function dispatchToolCalls(
  input: ToolCallDispatchInput,
  dependencies: ToolCallDispatchDependencies
): Promise<'continue' | 'aborted' | 'all_suppressed'> {
  let index = 0
  let executedAny = false

  while (index < input.calls.length) {
    if (input.signal.aborted) return 'aborted'
    const call = input.calls[index]
    if (!call) break

    const storm = dependencies.inspectStorm(call)
    if (storm?.suppress) {
      await dependencies.persistSuppressed(call, storm.reason)
      index += 1
      continue
    }

    if (!isParallelSafeToolCall(input, call)) {
      const result = await dependencies.execute(call)
      executedAny = true
      dependencies.markProgress(call.toolName)
      await dependencies.persistResult(call, result)
      index += 1
      continue
    }

    const headIsDelegation = isParallelDelegationCall(call, input.toolProviderKinds)
    const batchCap = headIsDelegation ? input.calls.length : MAX_PARALLEL_TOOL_CALLS
    const batch: ToolCallLike[] = [call]
    index += 1
    let suppressedAfterBatch: { call: ToolCallLike; reason?: string } | undefined

    while (batch.length < batchCap && index < input.calls.length) {
      const next = input.calls[index]
      if (!next || !isParallelSafeToolCall(input, next)) break
      if (isParallelDelegationCall(next, input.toolProviderKinds) !== headIsDelegation) break

      const nextStorm = dependencies.inspectStorm(next)
      if (nextStorm?.suppress) {
        suppressedAfterBatch = { call: next, reason: nextStorm.reason }
        index += 1
        break
      }
      batch.push(next)
      index += 1
    }

    const settled = await Promise.allSettled(batch.map((entry) => dependencies.execute(entry)))
    executedAny = true
    for (let batchIndex = 0; batchIndex < batch.length; batchIndex += 1) {
      const result = settled[batchIndex]
      const batchCall = batch[batchIndex]
      if (!result || !batchCall) continue
      if (result.status === 'rejected') throw result.reason
      dependencies.markProgress(batchCall.toolName)
      await dependencies.persistResult(batchCall, result.value)
    }

    if (suppressedAfterBatch) {
      await dependencies.persistSuppressed(
        suppressedAfterBatch.call,
        suppressedAfterBatch.reason
      )
    }
  }

  return executedAny ? 'continue' : 'all_suppressed'
}
