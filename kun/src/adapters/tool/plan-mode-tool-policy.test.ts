import { describe, expect, it } from 'vitest'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { planModeToolBlock } from './plan-mode-tool-policy.js'

type PlanTool = { name: string; sideEffect?: 'read-only' | 'unknown' }

function context(threadMode: 'agent' | 'plan' = 'plan'): ToolHostContext {
  return {
    threadId: 'thread_1',
    turnId: 'turn_1',
    workspace: '/workspace',
    threadMode,
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}

async function isBlocked(tool: PlanTool, mode = context()): Promise<boolean> {
  return (await planModeToolBlock(tool, {}, mode)) !== null
}

describe('Plan mode tool execution policy', () => {
  it('allows only host-classified read-only tools and explicit exceptions', async () => {
    for (const tool of [
      { name: 'lsp', sideEffect: 'read-only' as const },
      { name: 'mcp_read_only_call', sideEffect: 'read-only' as const },
      { name: 'create_plan' },
      { name: 'generate_image' }
    ]) {
      await expect(isBlocked(tool)).resolves.toBe(false)
    }
  })

  it('fails closed for command, MCP, unknown, conflicting, and missing metadata', async () => {
    for (const tool of [
      { name: 'bash' },
      { name: 'bash', sideEffect: 'unknown' as const },
      { name: 'mcp_call' },
      { name: 'future_tool' },
      { name: 'read', sideEffect: 'unknown' as const }
    ]) {
      await expect(planModeToolBlock(tool, { toolKind: 'tool_call' }, context()))
        .resolves.toMatchObject({ code: 'plan_mode_write_blocked' })
    }
  })

  it('uses host metadata rather than client-supplied tool kinds', async () => {
    await expect(isBlocked({ name: 'trusted_command', sideEffect: 'read-only' }))
      .resolves.toBe(false)
    await expect(isBlocked({ name: 'untrusted_tool' })).resolves.toBe(true)
  })

  it('does not gate tools outside Plan mode', async () => {
    await expect(isBlocked({ name: 'bash' }, context('agent'))).resolves.toBe(false)
  })
})
