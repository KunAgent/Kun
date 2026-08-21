import { describe, expect, it, vi } from 'vitest'
import type { DelegationRuntime } from '../../delegation/delegation-runtime.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { CapabilityRegistry } from './capability-registry.js'
import { buildDelegationToolProviders } from './delegation-tool-provider.js'
import { LocalToolHost } from './local-tool-host.js'

describe('delegate_task observability output', () => {
  it('exposes discovery plus the switch-dependent delegate schema without child runtime selection fields', () => {
    const existingRuntime = {
      enabled: () => true,
      useExistingAgents: true,
      defaultToolPolicy: 'inherit'
    } as unknown as DelegationRuntime
    const tools = buildDelegationToolProviders(existingRuntime)[0]?.tools ?? []
    const delegateTool = tools[0]
    const properties = delegateTool?.inputSchema.properties as Record<string, { description?: string }> | undefined

    expect(tools.map((tool) => tool.name)).toEqual(['delegate_task', 'list_subagent_profiles'])
    expect(delegateTool?.description).toContain('not tool-call arguments')
    expect(properties).not.toHaveProperty('model')
    expect(properties).not.toHaveProperty('providerId')
    expect(properties).toHaveProperty('profile')
    expect(properties).toHaveProperty('resumeChildId')
    expect(properties).toHaveProperty('expectedResumeCount')
    expect(properties?.resumeChildId?.description).toContain('Omit this field entirely for a new child')
    expect(properties?.expectedResumeCount?.description).toContain('omit it entirely for a new child')
    expect(delegateTool?.description).toContain('omit resumeChildId and expectedResumeCount entirely')
    expect(properties).not.toHaveProperty('custom_agent')
    expect(delegateTool?.inputSchema.required).toEqual(['prompt'])

    const customRuntime = {
      enabled: () => true,
      useExistingAgents: false,
      defaultToolPolicy: 'inherit'
    } as unknown as DelegationRuntime
    const customTools = buildDelegationToolProviders(customRuntime)[0]?.tools ?? []
    const customTool = customTools[0]
    const customModeProperties = customTool?.inputSchema.properties as Record<string, { description?: string }> | undefined
    expect(customTools.map((tool) => tool.name)).toEqual(['delegate_task', 'list_subagent_profiles'])
    expect(customModeProperties).not.toHaveProperty('profile')
    expect(customModeProperties?.custom_agent?.description).toContain('always inherits the current turn model/provider/reasoning strength')
    expect(customTool?.inputSchema.required).toEqual(['prompt'])
    const customProperties = (customModeProperties?.custom_agent as { properties?: Record<string, unknown> })?.properties
    expect(customProperties).not.toHaveProperty('reasoning_effort')
  })

  it('returns only the custom capability when reusable profiles are disabled', async () => {
    const listRoutingProfiles = vi.fn()
    const runtime = {
      enabled: () => true,
      useExistingAgents: false,
      defaultToolPolicy: 'inherit',
      listRoutingProfiles
    } as unknown as DelegationRuntime
    const tool = buildDelegationToolProviders(runtime)[0]?.tools
      .find((candidate) => candidate.name === 'list_subagent_profiles')

    const result = await tool!.execute({}, context())

    expect(result.output).toMatchObject({
      mode: 'custom-only',
      surface: 'code',
      profileCount: 0,
      nextOffset: null,
      profiles: [],
      customAgent: {
        id: 'custom',
        argument: 'custom_agent',
        lifetime: 'one-run',
        requiredFields: ['name', 'description', 'system_prompt']
      }
    })
    expect(listRoutingProfiles).not.toHaveBeenCalled()
  })

  it('keeps read-only discovery visible in plan mode without advertising child execution', async () => {
    const runtime = {
      enabled: () => true,
      useExistingAgents: true,
      defaultToolPolicy: 'inherit'
    } as unknown as DelegationRuntime
    const host = new LocalToolHost({
      registry: new CapabilityRegistry(buildDelegationToolProviders(runtime))
    })

    const tools = await host.listTools({ ...context(), threadMode: 'plan' })

    expect(tools.map((tool) => tool.name)).toEqual(['list_subagent_profiles'])
    expect(tools[0]?.sideEffect).toBe('read-only')
  })

  it('lists a bounded page from the current workspace and surface without leaking profile instructions', async () => {
    const listRoutingProfiles = vi.fn(async () => [
      {
        kind: 'profile' as const,
        id: 'alpha',
        source: 'configured' as const,
        profile: {
          name: 'A'.repeat(300),
          description: 'D'.repeat(1_200),
          toolPolicy: 'inherit' as const,
          systemPrompt: 'secret system prompt',
          promptPreamble: 'secret preamble',
          model: 'secret-model',
          providerId: 'secret-provider'
        }
      },
      {
        kind: 'profile' as const,
        id: 'workspace-reviewer',
        source: 'workspace' as const,
        profile: {
          name: 'Workspace Reviewer',
          description: 'Reviews the active design workspace.',
          toolPolicy: 'readOnly' as const,
          blockedTools: ['write']
        }
      }
    ])
    const runtime = {
      enabled: () => true,
      useExistingAgents: true,
      defaultProfileName: 'general',
      defaultToolPolicy: 'inherit',
      listRoutingProfiles
    } as unknown as DelegationRuntime
    const tool = buildDelegationToolProviders(runtime)[0]?.tools
      .find((candidate) => candidate.name === 'list_subagent_profiles')

    const result = await tool!.execute({ offset: 0, limit: 1 }, {
      ...context(),
      workspace: '/workspace/design',
      agentSurface: 'design'
    })
    const output = result.output as {
      profiles: Array<{ name: string; description: string }>
    }

    expect(listRoutingProfiles).toHaveBeenCalledWith('/workspace/design', 'design')
    expect(result.output).toMatchObject({
      mode: 'profiles-only',
      surface: 'design',
      profileCount: 2,
      offset: 0,
      limit: 1,
      nextOffset: 1,
      profiles: [{
        id: 'alpha',
        toolPolicy: 'inherit',
        access: expect.stringContaining('parent')
      }]
    })
    expect(result.output).not.toHaveProperty('customAgent')
    expect(output.profiles[0]?.name).toHaveLength(256)
    expect(output.profiles[0]?.description).toHaveLength(1_000)
    expect(JSON.stringify(result.output)).not.toContain('secret system prompt')
    expect(JSON.stringify(result.output)).not.toContain('secret preamble')
    expect(JSON.stringify(result.output)).not.toContain('secret-model')
    expect(JSON.stringify(result.output)).not.toContain('secret-provider')
    expect(JSON.stringify(result.output)).not.toContain('blockedTools')
  })

  it('runs an explicit custom agent in custom-only mode without invoking catalog routing', async () => {
    const listRoutingProfiles = vi.fn()
    const runChild = vi.fn(async (input: Parameters<DelegationRuntime['runChild']>[0]) => ({
      id: 'child_custom',
      parentThreadId: input.parentThreadId,
      parentTurnId: input.parentTurnId,
      prompt: input.prompt,
      profile: input.inlineProfile?.id,
      profileSource: 'custom' as const,
      profileSnapshot: input.inlineProfile?.profile,
      toolPolicy: 'readOnly' as const,
      status: 'completed' as const,
      summary: 'Custom review complete.',
      usage: { promptTokens: 3, completionTokens: 2, totalTokens: 5 },
      returnFormat: 'summary' as const,
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:01.000Z'
    }))
    const runtime = {
      enabled: () => true,
      useExistingAgents: false,
      defaultToolPolicy: 'inherit',
      listRoutingProfiles,
      runChild
    } as unknown as DelegationRuntime
    const tool = buildDelegationToolProviders(runtime)[0]?.tools
      .find((candidate) => candidate.name === 'delegate_task')

    const result = await tool!.execute({
      prompt: 'Review the IPC boundary',
      custom_agent: {
        name: 'IPC Reviewer',
        description: 'Reviews IPC boundaries.',
        system_prompt: 'Review IPC boundaries and return concrete evidence.',
        tool_policy: 'readOnly'
      }
    }, context())

    expect(result.isError).toBe(false)
    expect(listRoutingProfiles).not.toHaveBeenCalled()
    expect(runChild).toHaveBeenCalledWith(expect.objectContaining({
      inlineProfile: expect.objectContaining({
        id: 'custom:ipc-reviewer',
        source: 'custom'
      }),
      routing: expect.objectContaining({
        method: 'explicit-custom',
        selectedKind: 'custom'
      })
    }))
  })

  it('includes the effective model and snapshotted profile name in live and final output', async () => {
    const runChild = vi.fn(async (input: Parameters<DelegationRuntime['runChild']>[0]) => {
      const metadata = {
        model: 'gpt-5.6-sol',
        providerId: 'openai',
        reasoningEffort: 'high',
        profile: 'security-auditor',
        profileName: 'Security Auditor'
      }
      await input.onQueued?.('child_audit', 'security-auditor', metadata)
      await input.onRunning?.('child_audit', 'security-auditor', metadata)
      return {
        id: 'child_audit',
        parentThreadId: 'thread_parent',
        parentTurnId: 'turn_parent',
        prompt: 'Audit the change',
        model: 'gpt-5.6-sol',
        providerId: 'openai',
        reasoningEffort: 'high',
        profile: 'security-auditor',
        profileSnapshot: { name: 'Security Auditor' },
        toolPolicy: 'readOnly' as const,
        status: 'completed' as const,
        summary: 'No critical findings.',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        returnFormat: 'summary' as const,
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:00:01.000Z'
      }
    })
    const runtime = {
      enabled: () => true,
      listProfiles: () => [],
      listRoutingProfiles: async () => [{
        kind: 'profile' as const,
        id: 'general',
        source: 'builtin' as const,
        profile: { name: 'General', toolPolicy: 'inherit' as const }
      }],
      useExistingAgents: true,
      defaultProfileName: 'general',
      defaultToolPolicy: 'inherit',
      runChild
    } as unknown as DelegationRuntime
    const tool = buildDelegationToolProviders(runtime)[0]?.tools
      .find((candidate) => candidate.name === 'delegate_task')
    expect(tool).toBeDefined()

    const updates: unknown[] = []
    const result = await tool!.execute({
      label: 'Audit pass',
      prompt: 'Audit the change',
      model: 'stale-model',
      providerId: 'stale-provider'
    }, context(), (update) => {
      updates.push(update.output)
    })

    expect(updates).toEqual([
      expect.objectContaining({
        childId: 'child_audit',
        status: 'queued',
        profile: 'security-auditor',
        profileName: 'Security Auditor',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high'
      }),
      expect.objectContaining({
        childId: 'child_audit',
        status: 'running',
        profile: 'security-auditor',
        profileName: 'Security Auditor',
        model: 'gpt-5.6-sol',
        reasoningEffort: 'high'
      })
    ])
    expect(result.output).toMatchObject({
      childId: 'child_audit',
      status: 'completed',
      profile: 'security-auditor',
      profileName: 'Security Auditor',
      model: 'gpt-5.6-sol',
      reasoningEffort: 'high'
    })
    expect(runChild).toHaveBeenCalledWith(expect.objectContaining({
      clientSurface: 'tui',
      inheritedModel: 'gpt-5.6-luna',
      inheritedProviderId: 'openai',
      inheritedReasoningEffort: 'high'
    }))
    const childInput = runChild.mock.calls[0]?.[0]
    expect(childInput).not.toHaveProperty('model')
    expect(childInput).not.toHaveProperty('providerId')
  })

  it('resumes the exact structured child without routing or creating another child', async () => {
    const runChild = vi.fn()
    const resumeChild = vi.fn(async () => ({
      id: 'child_resume',
      parentThreadId: 'thread_parent',
      parentTurnId: 'turn_parent',
      launcher: 'delegate_task' as const,
      prompt: 'Continue',
      profile: 'general',
      profileSnapshot: { name: 'General Agent' },
      security: { sandboxRoot: '/workspace', memoryEnabled: false },
      approvalReviewer: 'user' as const,
      status: 'completed' as const,
      resumable: false,
      resumeCount: 2,
      summary: 'Finished after resume.',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      returnFormat: 'summary' as const,
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:01.000Z'
    }))
    const runtime = {
      enabled: () => true,
      useExistingAgents: false,
      defaultToolPolicy: 'inherit',
      runChild,
      resumeChild
    } as unknown as DelegationRuntime
    const tool = buildDelegationToolProviders(runtime)[0]!.tools[0]!
    const resumeContext = {
      ...context(),
      subagentResume: { childId: 'child_resume', expectedResumeCount: 1 }
    }

    const result = await tool.execute({
      prompt: 'model supplied text is replaced for the one-click path',
      resumeChildId: 'child_resume',
      expectedResumeCount: 1
    }, resumeContext)

    expect(result).toMatchObject({
      isError: false,
      output: {
        childId: 'child_resume',
        parentThreadId: 'thread_parent',
        parentTurnId: 'turn_parent',
        resumeCount: 2,
        resumable: false
      }
    })
    expect(runChild).not.toHaveBeenCalled()
    expect(resumeChild).toHaveBeenCalledWith(expect.objectContaining({
      childId: 'child_resume',
      parentThreadId: 'thread_parent',
      parentTurnId: 'turn_parent',
      expectedResumeCount: 1,
      expectedLaunchers: ['delegate_task'],
      requireResumable: true,
      proactive: false,
      prompt: expect.stringContaining('persisted child session')
    }))

    await expect(tool.execute({
      prompt: 'wrong child',
      resumeChildId: 'child_other',
      expectedResumeCount: 1
    }, resumeContext)).resolves.toMatchObject({ isError: true })

    await expect(tool.execute({
      prompt: 'invalid override',
      resumeChildId: 'child_resume',
      expectedResumeCount: 1,
      returnFormat: 'evidence'
    }, resumeContext)).resolves.toMatchObject({
      isError: true,
      output: { error: expect.stringContaining('omit resumeChildId and expectedResumeCount') }
    })
    expect(resumeChild).toHaveBeenCalledTimes(1)
  })

  it('marks a model-initiated resume as proactive', async () => {
    const resumeChild = vi.fn(async () => ({
      id: 'child_retry', parentThreadId: 'thread_parent', parentTurnId: 'turn_parent',
      launcher: 'delegate_task' as const, prompt: 'continue', profile: 'general',
      profileSnapshot: { name: 'General Agent' },
      security: { sandboxRoot: '/workspace', memoryEnabled: false },
      approvalReviewer: 'user' as const, status: 'completed' as const,
      resumable: false, resumeCount: 1, proactiveRetryCount: 1,
      summary: 'done', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      returnFormat: 'summary' as const,
      createdAt: '2026-08-19T00:00:00.000Z', updatedAt: '2026-08-19T00:00:01.000Z'
    }))
    const runtime = {
      enabled: () => true,
      useExistingAgents: false,
      defaultToolPolicy: 'inherit',
      proactiveRetryPolicy: { enabled: true, maxAttempts: 3 },
      runChild: vi.fn(),
      resumeChild
    } as unknown as DelegationRuntime
    const tool = buildDelegationToolProviders(runtime)[0]!.tools[0]!

    await expect(tool.execute({
      prompt: 'continue after the transient failure',
      resumeChildId: 'child_retry',
      expectedResumeCount: 0
    }, context())).resolves.toMatchObject({
      isError: false,
      output: {
        childId: 'child_retry',
        proactiveRetry: { count: 1, limit: 3, remaining: 2 }
      }
    })
    expect(resumeChild).toHaveBeenCalledWith(expect.objectContaining({ proactive: true }))
  })

  it('creates a new child when a provider materializes neutral resume placeholders', async () => {
    const resumeChild = vi.fn()
    const runChild = vi.fn(async (input: Parameters<DelegationRuntime['runChild']>[0]) => ({
      id: 'child_review',
      parentThreadId: input.parentThreadId,
      parentTurnId: input.parentTurnId,
      launcher: 'delegate_task' as const,
      label: input.label,
      prompt: input.prompt,
      profile: input.inlineProfile?.id,
      profileSnapshot: input.inlineProfile?.profile,
      security: { sandboxRoot: '/workspace', memoryEnabled: false },
      approvalReviewer: 'user' as const,
      status: 'completed' as const,
      resumable: false,
      summary: 'No findings.',
      evidence: ['Reviewed the targeted provider change.'],
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      returnFormat: 'evidence' as const,
      createdAt: '2026-08-15T00:00:00.000Z',
      updatedAt: '2026-08-15T00:00:01.000Z'
    }))
    const runtime = {
      enabled: () => true,
      useExistingAgents: true,
      defaultToolPolicy: 'inherit',
      resolveProfileSnapshot: vi.fn(async () => ({
        id: 'code-reviewer',
        source: 'builtin' as const,
        profile: { name: 'Code Reviewer', toolPolicy: 'readOnly' as const }
      })),
      runChild,
      resumeChild
    } as unknown as DelegationRuntime
    const tool = buildDelegationToolProviders(runtime)[0]!.tools[0]!

    const result = await tool.execute({
      detach: false,
      expectedResumeCount: 0,
      label: 'Provider fix review',
      profile: 'code-reviewer',
      prompt: 'Review the targeted provider fix without modifying files.',
      resumeChildId: '',
      returnFormat: 'evidence'
    }, context())

    expect(result).toMatchObject({
      isError: false,
      output: { childId: 'child_review', status: 'completed', returnFormat: 'evidence' }
    })
    expect(resumeChild).not.toHaveBeenCalled()
    expect(runChild).toHaveBeenCalledTimes(1)
    expect(runChild).toHaveBeenCalledWith(expect.objectContaining({
      label: 'Provider fix review',
      returnFormat: 'evidence',
      inlineProfile: expect.objectContaining({ id: 'code-reviewer' })
    }))

    await expect(tool.execute({
      prompt: 'Invalid orphaned count',
      profile: 'code-reviewer',
      expectedResumeCount: 1
    }, context())).resolves.toMatchObject({
      isError: true,
      output: { error: expect.stringContaining('omit both fields') }
    })
    expect(runChild).toHaveBeenCalledTimes(1)
  })

  it('rejects custom arguments in existing-profile mode and stale arguments that cross custom-only mode', async () => {
    const runChild = vi.fn()
    const existingRuntime = {
      enabled: () => true,
      useExistingAgents: true,
      defaultToolPolicy: 'inherit',
      runChild
    } as unknown as DelegationRuntime
    const existingTool = buildDelegationToolProviders(existingRuntime)[0]!.tools[0]!
    await expect(existingTool.execute({
      prompt: 'Review the change',
      custom_agent: {
        name: 'Reviewer',
        description: 'Reviews changes.',
        system_prompt: 'Review the change.'
      }
    }, context())).resolves.toMatchObject({
      isError: true,
      output: { error: expect.stringContaining('turned on') }
    })
    await expect(existingTool.execute({
      prompt: 'Review the change',
      profile: 'reviewer',
      custom_agent: {
        name: 'Reviewer',
        description: 'Reviews changes.',
        system_prompt: 'Review the change.'
      }
    }, context())).resolves.toMatchObject({
      isError: true,
      output: { error: expect.stringContaining('custom_agent is unavailable') }
    })

    const customRuntime = {
      enabled: () => true,
      useExistingAgents: false,
      defaultToolPolicy: 'inherit',
      runChild
    } as unknown as DelegationRuntime
    const customTool = buildDelegationToolProviders(customRuntime)[0]!.tools[0]!
    await expect(customTool.execute({
      prompt: 'Review the change',
      profile: 'reviewer'
    }, context())).resolves.toMatchObject({
      isError: true,
      output: { error: expect.stringContaining('turned off') }
    })
    await expect(customTool.execute({ prompt: 'Review the change' }, context())).resolves.toMatchObject({
      isError: true,
      output: { error: expect.stringContaining('custom_agent is required') }
    })
    expect(runChild).not.toHaveBeenCalled()
  })
})

function context(): ToolHostContext {
  return {
    threadId: 'thread_parent',
    turnId: 'turn_parent',
    workspace: '/workspace',
    approvalPolicy: 'auto',
    sandboxMode: 'workspace-write',
    model: {
      id: 'gpt-5.6-luna',
      inputModalities: ['text'],
      outputModalities: ['text'],
      supportsToolCalling: true,
      messageParts: ['text']
    },
    modelProviderId: 'openai',
    reasoningEffort: 'high',
    clientSurface: 'tui',
    abortSignal: new AbortController().signal,
    awaitApproval: async () => 'allow'
  }
}
