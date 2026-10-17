import { describe, expect, it } from 'vitest'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import type { RuntimeTuningConfig } from '../config/kun-config.js'
import type { ModelClient, ModelStreamChunk } from '../ports/model-client.js'
import { createChildAgentExecutor } from './child-agent-executor.js'

/** Never answers: every step reads one more distinct file, so only the step cap ends it. */
class EndlessDistinctReadsModel implements ModelClient {
  readonly provider = 'test'
  readonly model = 'endless-reads-model'
  requests = 0

  async *stream(): AsyncIterable<ModelStreamChunk> {
    this.requests += 1
    yield { kind: 'assistant_text_delta', text: `Checking file ${this.requests}.` }
    yield {
      kind: 'tool_call_complete',
      callId: `read_${this.requests}`,
      toolName: 'read',
      arguments: { path: `src/file_${this.requests}.ts` }
    }
    yield { kind: 'completed', stopReason: 'tool_calls' }
  }
}

describe('child agent turn budget stops', () => {
  it('names the step budget instead of reporting only the last sentence', async () => {
    const model = new EndlessDistinctReadsModel()
    const read = LocalToolHost.defineTool({
      name: 'read',
      description: 'read',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } }, additionalProperties: false },
      policy: 'auto',
      sideEffect: 'read-only',
      execute: async (args) => ({ output: { path: args.path, content: 'export {}' } })
    })
    const executor = createChildAgentExecutor({
      model,
      toolHost: new LocalToolHost({ tools: [read] }),
      prefix: createImmutablePrefix({ systemPrompt: 'test' }),
      defaultModel: model.model,
      runtime: { turnLimits: { maxSteps: 3 } } as RuntimeTuningConfig
    })

    await expect(executor({
      childId: 'child_step_limit',
      parentThreadId: 'parent',
      parentTurnId: 'turn_parent',
      prompt: 'inspect every file',
      workspace: '/workspace',
      model: model.model,
      toolPolicy: 'inherit',
      signal: new AbortController().signal
    })).rejects.toMatchObject({
      name: 'ChildResultExecutionError',
      message: 'Child stopped: turn exceeded 3 model steps',
      failure: { source: 'runtime', code: 'turn_step_limit' },
      result: { summary: expect.stringContaining('Checking file') }
    })
    expect(model.requests).toBe(3)
  })
})
