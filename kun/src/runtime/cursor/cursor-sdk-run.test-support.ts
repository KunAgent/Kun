import type { Run, RunResult, SDKMessage } from '@cursor/sdk'

function messages(values: SDKMessage[]): AsyncGenerator<SDKMessage, void> {
  return (async function* () {
    for (const value of values) yield value
  })()
}

export function fakeRun(input: {
  stream?: SDKMessage[]
  result?: Partial<RunResult>
  cancel?: () => Promise<void>
} = {}): Run {
  const result: RunResult = {
    id: 'run_1',
    status: 'finished',
    result: 'hello',
    ...input.result
  }
  return {
    id: 'run_1',
    agentId: 'agent_1',
    supports: (operation) => operation === 'stream' || operation === 'wait' || operation === 'cancel',
    unsupportedReason: () => undefined,
    stream: () => messages(input.stream ?? [{
      type: 'assistant',
      agent_id: 'agent_1',
      run_id: 'run_1',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
    }]),
    conversation: async () => [],
    wait: async () => result,
    cancel: input.cancel ?? (async () => undefined),
    status: result.status,
    onDidChangeStatus: () => () => undefined,
    result: result.result,
    error: result.error,
    model: result.model,
    durationMs: result.durationMs,
    usage: result.usage,
    git: result.git,
    createdAt: 1
  }
}
