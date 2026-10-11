import { describe, expect, it } from 'vitest'
import { assembleSdkOptions } from './sdk-options-builder.js'
import { decideSdkBuiltinSandbox } from './agent-sdk-runtime-sandbox.js'
import { createAgentSdkToolRuntimeDeps } from './agent-sdk-runtime-factory-tools.js'

const retired = ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList']
describe('SDK task state retirement', () => {
  it.each(['on-request', 'auto'] as const)('removes local task state from %s availability including resumed sessions', (approvalPolicy) => {
    const options = assembleSdkOptions({ cwd: '/tmp', kunSystemPrompt: 'Kun', approvalPolicy,
      sandboxMode: 'danger-full-access', resume: 'existing-sdk-session', baseEnv: {},
      bridgedToolModelNames: ['mcp__kun__task_create', 'mcp__kun__task_update', 'mcp__kun__task_get', 'mcp__kun__task_list'] })
    for (const name of retired) {
      expect(options.tools).not.toContain(name)
      expect(options.allowedTools).not.toContain(name)
      expect(options.disallowedTools).toContain(name)
    }
    expect(options.allowedTools).toContain('mcp__kun__task_update')
    expect(options.resume).toBe('existing-sdk-session')
  })
  it.each(['read-only', 'workspace-write', 'danger-full-access', 'external-sandbox'] as const)('rejects stale task calls in %s', async (sandboxMode) => {
    const deps = createAgentSdkToolRuntimeDeps({} as never, { toolBridge: {} } as never)
    for (const name of retired) {
      expect(decideSdkBuiltinSandbox(name, {}, { workspace: '/tmp', sandboxMode })).toMatchObject({ allow: false })
      await expect(deps.decideToolApproval!('thread', 'turn', name, {}, new AbortController().signal)).resolves.toMatchObject({ allow: false })
    }
  })
  it('keeps Kun task tools behind the canonical bridge in plan/room-style restricted turns', () => {
    for (const planMode of [true, false]) {
      const options = assembleSdkOptions({ cwd: '/tmp', kunSystemPrompt: 'Kun', approvalPolicy: 'on-request',
        allowSdkBuiltins: false, planMode, baseEnv: {}, bridgedToolModelNames: ['mcp__kun__task_list'] })
      expect(options.tools).toEqual([])
      expect(options.allowedTools).toEqual(['mcp__kun__task_list'])
      expect(decideSdkBuiltinSandbox('TodoWrite', {}, { workspace: '/tmp', planMode, allowSdkBuiltins: false })).toMatchObject({ allow: false })
      expect(decideSdkBuiltinSandbox('mcp__kun__task_list', {}, { workspace: '/tmp', planMode, allowSdkBuiltins: false })).toBeNull()
    }
  })
})
