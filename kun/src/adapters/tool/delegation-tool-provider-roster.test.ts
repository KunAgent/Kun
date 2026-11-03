import { describe, expect, it, vi } from 'vitest'
import type { SubagentProfileConfig } from '../../contracts/capabilities.js'
import type { HarnessDefinition, HarnessStatus } from '../../contracts/harness.js'
import { allSupportedStatuses } from '../../contracts/harness-capabilities.js'
import { AgentRoster } from '../../delegation/agent-roster.js'
import type { DelegationRuntime } from '../../delegation/delegation-runtime.js'
import type { SubagentRouter } from '../../delegation/subagent-router.js'
import { BUILTIN_HARNESSES } from '../../harness/builtin-harnesses.js'
import type { ToolHostContext } from '../../ports/tool-host.js'
import { buildDelegationToolProviders } from './delegation-tool-provider.js'

const def = (id: string): HarnessDefinition => BUILTIN_HARNESSES.find((entry) => entry.id === id)!
const ready = (harnessId: string): HarnessStatus =>
  ({ harnessId, installed: 'yes', login: 'signed-in', checkedAt: '2026-01-01T00:00:00.000Z' })

const PROFILES: Record<string, SubagentProfileConfig> = {
  general: { name: 'General', mode: 'subagent', toolPolicy: 'inherit' },
  reviewer: {
    name: 'Codex Reviewer',
    description: 'Reviews diffs.',
    mode: 'subagent',
    toolPolicy: 'readOnly',
    harnessId: 'codex',
    model: 'gpt-5.5-codex'
  }
}

function setup(options: {
  statuses?: Record<string, HarnessStatus>
  cached?: Record<string, HarnessStatus | undefined>
  honor?: boolean
  routed?: string
} = {}) {
  const defs = [def('kun'), def('codex')]
  const roster = new AgentRoster({
    profiles: () => PROFILES,
    honorEngineBinding: () => options.honor !== false,
    defaultParent: () => ({ model: 'deepseek-chat', providerId: 'deepseek' }),
    engines: {
      catalog: { get: (id) => defs.find((entry) => entry.id === id) },
      detector: {
        cachedStatus: (id) => options.cached && id in options.cached ? options.cached[id] : ready(id),
        status: async (id) => options.statuses?.[id] ?? ready(id)
      },
      capabilitiesForRoute: async () => ({
        statuses: allSupportedStatuses(),
        facts: { sandbox: 'native', usageReporting: 'exact', compactionOwner: 'kun' }
      })
    }
  })
  const runChild = vi.fn(async (input: Record<string, unknown>) => ({
    id: 'child_1', parentThreadId: 'thread_parent', parentTurnId: 'turn_parent', status: 'completed',
    launcher: 'delegate_task', profile: input.inlineProfile && (input.inlineProfile as { id: string }).id,
    summary: 'done', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z'
  }))
  const runtime = {
    enabled: () => true,
    useExistingAgents: true,
    defaultProfileName: 'general',
    defaultToolPolicy: 'inherit',
    roster,
    runChild
  } as unknown as DelegationRuntime
  const router = {
    route: vi.fn(async () => ({
      source: 'llm-profile' as const,
      candidates: [],
      reason: 'The reviewer fits.',
      profileId: options.routed ?? 'reviewer'
    }))
  } as unknown as SubagentRouter
  const tool = buildDelegationToolProviders(runtime, router)[0]!.tools
    .find((candidate) => candidate.name === 'delegate_task')!
  return { tool, runChild, router }
}

const context = {
  threadId: 'thread_parent',
  turnId: 'turn_parent',
  workspace: '/workspace',
  approvalPolicy: 'auto',
  sandboxMode: 'workspace-write',
  model: { id: 'deepseek-chat', inputModalities: ['text'], outputModalities: ['text'], supportsToolCalling: true, messageParts: ['text'] },
  modelProviderId: 'deepseek',
  abortSignal: new AbortController().signal,
  awaitApproval: async () => 'allow'
} as unknown as ToolHostContext

describe('delegate_task on the agent roster', () => {
  it('runs an explicitly chosen role on its bound engine in a read-only sandbox', async () => {
    const { tool, runChild } = setup()
    const result = await tool.execute({ prompt: 'Review the diff', profile: 'reviewer' }, context)
    expect(result.isError).toBe(false)
    expect(runChild.mock.calls[0]![0]).toMatchObject({
      harnessId: 'codex',
      model: 'gpt-5.5-codex',
      credentialMode: 'native-login',
      sandboxMode: 'read-only',
      inlineProfile: { id: 'reviewer' }
    })
  })

  it('refuses a role whose engine is not ready instead of running it on the main route', async () => {
    const { tool, runChild } = setup({ statuses: { codex: { ...ready('codex'), login: 'signed-out' } } })
    const result = await tool.execute({ prompt: 'Review the diff', profile: 'reviewer' }, context)
    expect(result).toMatchObject({ isError: true, output: { error: expect.stringContaining('(engine_not_ready)') } })
    expect(runChild).not.toHaveBeenCalled()
  })

  it('falls back to the default role when the routed role fails its readiness probe', async () => {
    const { tool, runChild } = setup({ statuses: { codex: { ...ready('codex'), installed: 'no' } } })
    await tool.execute({ prompt: 'Review the diff' }, context)
    const input = runChild.mock.calls[0]![0] as { harnessId?: string; inlineProfile: { id: string }; routing: { reason: string } }
    expect(input.inlineProfile.id).toBe('general')
    expect(input.harnessId).toBeUndefined()
    expect(input.routing.reason).toContain('engine is unavailable: reviewer (engine_not_ready)')
  })

  it('leaves blocked roles out of automatic routing and says so', async () => {
    const { tool, runChild, router } = setup({ cached: { codex: { ...ready('codex'), login: 'signed-out' } }, routed: 'general' })
    await tool.execute({ prompt: 'Summarize the module' }, context)
    const documents = (router.route as ReturnType<typeof vi.fn>).mock.calls[0]![0].documents as Array<{ id: string }>
    expect(documents.map((document) => document.id)).toEqual(['general'])
    const input = runChild.mock.calls[0]![0] as { routing: { reason: string } }
    expect(input.routing.reason).toContain('Not available to delegate_task right now: reviewer (engine_not_ready)')
  })

  it('keeps every child on the main route when engine binding is turned off', async () => {
    const { tool, runChild } = setup({ honor: false })
    await tool.execute({ prompt: 'Review the diff', profile: 'reviewer' }, context)
    const input = runChild.mock.calls[0]![0] as Record<string, unknown>
    expect(input.harnessId).toBeUndefined()
    expect(input.sandboxMode).toBe('workspace-write')
  })
})
