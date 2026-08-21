import { describe, expect, it } from 'vitest'
import { CapabilityRegistry } from './capability-registry.js'
import {
  buildConversationVisualizationToolProvider,
  CONVERSATION_VISUALIZATION_TOOL_NAME
} from './conversation-visualization-tool-provider.js'
import type { ToolHostContext } from '../../ports/tool-host.js'

const visualization = {
  version: 1,
  title: 'Release flow',
  sections: [{
    kind: 'flow',
    steps: [
      { id: 'build', title: 'Build' },
      { id: 'ship', title: 'Ship', tone: 'success' }
    ]
  }]
}

function context(clientSurface: ToolHostContext['clientSurface']): ToolHostContext {
  return {
    threadId: 'thread-1',
    turnId: 'turn-1',
    workspace: '/workspace',
    clientSurface,
    threadMode: 'agent',
    approvalPolicy: 'auto',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

describe('conversation visualization tool provider', () => {
  it('is disabled by default and is exposed only to GUI turns', () => {
    let enabled = false
    const providers = buildConversationVisualizationToolProvider(() => ({ enabled }))
    const registry = new CapabilityRegistry(providers)

    expect(registry.listTools(context('gui'))).toEqual([])
    enabled = true
    expect(registry.listTools(context('gui')).map((tool) => tool.name)).toContain(
      CONVERSATION_VISUALIZATION_TOOL_NAME
    )
    expect(registry.listTools(context('tui'))).toEqual([])
  })

  it('checks the switch again at execution and returns normalized data', async () => {
    let enabled = true
    const tool = buildConversationVisualizationToolProvider(() => ({ enabled }))[0]!.tools[0]!
    const success = await tool.execute(visualization, context('gui'))
    expect(success).toMatchObject({
      output: {
        status: 'completed',
        conversationVisualization: {
          version: 1,
          title: 'Release flow'
        }
      }
    })

    enabled = false
    const stale = await tool.execute(visualization, context('gui'))
    expect(stale).toMatchObject({ isError: true })
    expect(JSON.stringify(stale.output)).toContain('disabled in Lab settings')
  })

  it('rejects duplicate ids and unknown fields', async () => {
    const tool = buildConversationVisualizationToolProvider(() => ({ enabled: true }))[0]!.tools[0]!
    const result = await tool.execute({
      ...visualization,
      unexpected: true,
      sections: [{
        kind: 'flow',
        steps: [{ id: 'same', title: 'One' }, { id: 'same', title: 'Two' }]
      }]
    }, context('gui'))
    expect(result.isError).toBe(true)
  })
})
