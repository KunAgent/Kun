import { describe, expect, it } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { buildDesignCanvasLocalTools } from './design-canvas-tool.js'
import { modelToolDiscoveryContexts } from '../../loop/tool-discovery-context-factory.js'
import {
  createDesignOpenTool,
  DESIGN_OPEN_TOOL_NAME,
  designOpenRequestId,
  shouldAdvertiseDesignOpen
} from './design-open-tool.js'

function codeContext(overrides: Partial<ToolHostContext> = {}): ToolHostContext {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspace: '/tmp/workspace',
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow',
    clientSurface: 'gui',
    agentSurface: 'code',
    activeToolCallId: 'call_1',
    ...overrides
  }
}

describe('design_open tool', () => {
  it('is registered with the design canvas local tools', () => {
    expect(buildDesignCanvasLocalTools().map((tool) => tool.name)).toContain(DESIGN_OPEN_TOOL_NAME)
  })

  it('advertises only on Kun-native GUI Code turns', () => {
    expect(shouldAdvertiseDesignOpen(codeContext())).toBe(true)
    expect(shouldAdvertiseDesignOpen(codeContext({ harnessId: 'kun' }))).toBe(true)
    expect(shouldAdvertiseDesignOpen(codeContext({ clientSurface: 'api' }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ clientSurface: 'tui' }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ agentSurface: 'design' }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ agentSurface: 'write' }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ agentSurface: undefined }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ threadMode: 'plan' }))).toBe(false)
    // A Code whiteboard turn is still a Code turn.
    expect(shouldAdvertiseDesignOpen(codeContext({ guiDesignCanvas: true }))).toBe(true)
    expect(shouldAdvertiseDesignOpen(codeContext({ guiExcalidrawCanvas: true }))).toBe(true)
    expect(shouldAdvertiseDesignOpen(codeContext({ guiDesignMode: true }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ imContext: true }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ roomStepKind: 'conversation' }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ roomAgent: true }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ executionUnitKind: 'worker' }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ harnessId: 'claude-code' }))).toBe(false)
    expect(shouldAdvertiseDesignOpen(codeContext({ workspace: '  ' }))).toBe(false)
  })

  it('stays in the cache-stable GUI catalog but only executes in a real Code turn', () => {
    const codeTurn = codeContext({ threadMode: 'agent' })
    const designTurn = codeContext({
      threadMode: 'agent', agentSurface: 'design', guiDesignCanvas: true, guiDesignMode: true
    })
    for (const turn of [codeTurn, designTurn]) {
      const listing = modelToolDiscoveryContexts(turn)
      expect(listing.length).toBeGreaterThan(1)
      expect(listing.some(shouldAdvertiseDesignOpen)).toBe(true)
    }
    expect(shouldAdvertiseDesignOpen(codeTurn)).toBe(true)
    expect(shouldAdvertiseDesignOpen(designTurn)).toBe(false)
  })

  it('queues a stable design request without touching the workspace', async () => {
    const tool = createDesignOpenTool()
    const result = await tool.execute({
      title: '  Update entry redesign  ',
      brief: 'Move the update button into the sidebar footer.',
      target: 'web',
      medium: 'html'
    }, codeContext())
    expect(result.isError).toBeUndefined()
    const expectedId = designOpenRequestId(
      codeContext(),
      'Update entry redesign',
      'Move the update button into the sidebar footer.'
    )
    expect(expectedId).toMatch(/^design_[0-9a-f]{16}$/)
    expect(result.output).toMatchObject({
      ok: true,
      status: 'queued',
      designRequest: {
        version: 1,
        requestId: expectedId,
        status: 'queued',
        title: 'Update entry redesign',
        brief: 'Move the update button into the sidebar footer.',
        target: 'web',
        medium: 'html'
      }
    })
    expect(JSON.stringify(result.output)).toContain('starts as soon as this reply ends')
  })

  it('drops unknown target and medium values', async () => {
    const result = await createDesignOpenTool().execute(
      { title: 'Login', brief: 'Design a login screen.', target: 'tv', medium: 'video' },
      codeContext()
    )
    const request = (result.output as { designRequest: Record<string, unknown> }).designRequest
    expect(request.target).toBeUndefined()
    expect(request.medium).toBeUndefined()
  })

  it('rejects a missing title or brief', async () => {
    const tool = createDesignOpenTool()
    expect((await tool.execute({ title: 'Login', brief: '  ' }, codeContext())).isError).toBe(true)
    expect((await tool.execute({ brief: 'Design a login screen.' }, codeContext())).isError).toBe(true)
  })

  it('derives a different request id per tool call', () => {
    const first = designOpenRequestId(codeContext(), 'A', 'B')
    const second = designOpenRequestId(codeContext({ activeToolCallId: 'call_2' }), 'A', 'B')
    expect(first).not.toBe(second)
  })
})
