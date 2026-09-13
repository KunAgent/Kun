import { rm } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { historyReferenceFixture, SOURCE_TEXT } from '../../tests/support/history-reference-fixtures.js'
import { AgentLoop } from './agent-loop.js'
import { LocalToolHost } from '../adapters/tool/local-tool-host.js'
import { CapabilityRegistry } from '../adapters/tool/capability-registry.js'
import { buildHistoryReferenceToolProvider } from '../adapters/tool/history-reference-tool.js'
import { UsageService } from '../services/usage-service.js'
import { createImmutablePrefix } from '../cache/immutable-prefix.js'
import type { ModelClient, ModelStreamChunk } from '../ports/model-client.js'

it.each(['codex', 'claude-code'] as const)('%s sends only a descriptor initially, then persists requested excerpts for subsequent native turns', async (provider) => {
  const f = await historyReferenceFixture(provider)
  const requests: string[] = []
  let step = 0
  const model: ModelClient = { provider: 'test', model: 'test',
    async *stream(request): AsyncIterable<ModelStreamChunk> {
      requests.push(JSON.stringify(request))
      if (step++ === 0) {
        yield { kind: 'tool_call_complete', callId: 'read_old', toolName: 'read_source_history', arguments: { operation: 'recent' } }
        yield { kind: 'completed', stopReason: 'tool_calls' }
      } else {
        yield { kind: 'assistant_text_delta', text: 'I can continue the task.' }
        yield { kind: 'completed', stopReason: 'stop' }
      }
    }
  }
  const createLoop = () => new AgentLoop({ ...f, model,
    turns: f.turnService,
    approvalGate: { request: async () => 'allow', get: () => undefined } as never,
    userInputGate: {} as never,
    toolHost: new LocalToolHost({ registry: new CapabilityRegistry([buildHistoryReferenceToolProvider(f.historyReferences)]) }),
    usage: new UsageService(), prefix: createImmutablePrefix({ systemPrompt: 'Kun test contract' })
  })
  const loop = createLoop()
  try {
    const started = await f.turnService.startTurn({ threadId: f.thread.id, request: { prompt: 'Continue the prior task' } })
    expect(await loop.runTurn(f.thread.id, started.turnId)).toBe('completed')
    expect(requests[0]).toContain(f.reference.id)
    expect(requests[0]).not.toContain(SOURCE_TEXT)
    expect(requests[1]).toContain(SOURCE_TEXT)
    const items = await f.sessionStore.loadItems(f.thread.id)
    expect(items.some((item) => item.id.startsWith(`${provider}:`))).toBe(false)
    expect(items.filter((item) => item.kind === 'user_message')).toHaveLength(1)
    expect(items.filter((item) => item.kind === 'tool_result')).toHaveLength(1)
    await rm(f.path)
    const second = await f.turnService.startTurn({ threadId: f.thread.id, request: { prompt: 'Use what you already read' } })
    const recovered = createLoop()
    try {
      expect(await recovered.runTurn(f.thread.id, second.turnId)).toBe('completed')
      expect(requests.at(-1)).toContain(SOURCE_TEXT)
    } finally { recovered.shutdownGoalResume(); recovered.shutdownInterruptedResume() }
  } finally {
    loop.shutdownGoalResume(); loop.shutdownInterruptedResume()
    await rm(f.root, { recursive: true, force: true })
  }
})
