import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSkillToolProviders } from '../src/adapters/tool/skill-tool-provider.js'
import { CapabilityRegistry } from '../src/adapters/tool/capability-registry.js'
import { LocalToolHost } from '../src/adapters/tool/local-tool-host.js'
import { KunCapabilitiesConfig } from '../src/contracts/capabilities.js'
import type { ToolHostContext } from '../src/ports/tool-host.js'
import { SkillRuntime } from '../src/skills/skill-runtime.js'

describe('buildSkillToolProviders', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-skill-tool-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  async function runtimeWithSkill(): Promise<SkillRuntime> {
    const dir = join(root, 'demo')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'skill.json'), JSON.stringify({ id: 'demo', name: 'Demo' }), 'utf8')
    await writeFile(join(dir, 'SKILL.md'), 'demo body instructions', 'utf8')
    const config = KunCapabilitiesConfig.parse({
      skills: { enabled: true, roots: [root], legacySkillMd: true }
    })
    return SkillRuntime.create(config.skills)
  }

  it('returns no provider when no skills are loaded', async () => {
    const runtime = await SkillRuntime.create({ enabled: false, roots: [], workspaceRoots: [], globalRoots: [], disabledIds: [], legacySkillMd: true })
    expect(buildSkillToolProviders(runtime)).toEqual([])
    expect(buildSkillToolProviders(undefined)).toEqual([])
  })

  it('exposes a load_skill tool that returns the skill body', async () => {
    const runtime = await runtimeWithSkill()
    const [provider] = buildSkillToolProviders(runtime)
    expect(provider?.id).toBe('skill')
    const tool = provider?.tools.find((candidate) => candidate.name === 'load_skill')
    expect(tool).toBeDefined()

    const ok = await tool!.execute({ skill_id: '$demo' }, {} as never)
    expect(ok.isError).toBeFalsy()
    expect(ok.output).toMatchObject({ skillId: 'demo', name: 'Demo' })
    expect((ok.output as { instruction: string }).instruction).toContain('demo body instructions')

    const missing = await tool!.execute({ skill_id: 'nope' }, {} as never)
    expect(missing.isError).toBe(true)

    const blank = await tool!.execute({ skill_id: '   ' }, {} as never)
    expect(blank.isError).toBe(true)
  })

  it('activates a loaded skill only for the current thread and turn', async () => {
    const runtime = await runtimeWithSkill()
    const [provider] = buildSkillToolProviders(runtime)
    const tool = provider?.tools.find((candidate) => candidate.name === 'load_skill')
    expect(tool).toBeDefined()

    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspace: root,
      blockedSkillIds: []
    } as never
    const loaded = await tool!.execute({ skill_id: 'demo' }, context)
    expect(loaded.isError).toBeFalsy()

    const active = await runtime.resolveTurn({
      prompt: 'continue',
      workspace: root,
      threadId: 'thread_1',
      turnId: 'turn_1'
    })
    const otherTurn = await runtime.resolveTurn({
      prompt: 'continue',
      workspace: root,
      threadId: 'thread_1',
      turnId: 'turn_2'
    })

    expect(active.activeSkillIds).toEqual(['demo'])
    expect(active.activations).toEqual([
      expect.objectContaining({ skillId: 'demo', reason: 'load_skill' })
    ])
    expect(otherTurn.activeSkillIds).toEqual([])

    runtime.clearTurnActivation('thread_1', 'turn_1')
    await expect(runtime.resolveTurn({
      prompt: 'continue',
      workspace: root,
      threadId: 'thread_1',
      turnId: 'turn_1'
    })).resolves.toMatchObject({ activeSkillIds: [] })
  })

  it('does not activate a skill rejected by the turn deny-list', async () => {
    const runtime = await runtimeWithSkill()
    const [provider] = buildSkillToolProviders(runtime)
    const tool = provider?.tools.find((candidate) => candidate.name === 'load_skill')
    const context = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspace: root,
      blockedSkillIds: ['demo']
    } as never

    const loaded = await tool!.execute({ skill_id: 'demo' }, context)
    expect(loaded.isError).toBe(true)
    await expect(runtime.resolveTurn({
      prompt: 'continue',
      workspace: root,
      threadId: 'thread_1',
      turnId: 'turn_1',
      blockedSkillIds: ['demo']
    })).resolves.toMatchObject({ activeSkillIds: [] })
  })

  it('refreshes skill-gated tool discovery on the model step after load_skill', async () => {
    const runtime = await runtimeWithSkill()
    const gatedTool = LocalToolHost.defineTool({
      name: 'demo_run',
      description: 'Run the managed demo workflow',
      inputSchema: { type: 'object', properties: {} },
      policy: 'auto',
      shouldAdvertise: (context) => context.activeSkillIds?.includes('demo') === true,
      execute: async () => ({ output: { ran: true } })
    })
    const registry = new CapabilityRegistry([
      ...buildSkillToolProviders(runtime),
      {
        id: 'managed-demo',
        kind: 'skill',
        enabled: true,
        available: true,
        tools: [gatedTool]
      }
    ])
    const host = new LocalToolHost({ registry })
    const baseContext: ToolHostContext = {
      threadId: 'thread_1',
      turnId: 'turn_1',
      workspace: root,
      activeSkillIds: [],
      approvalPolicy: 'auto',
      sandboxMode: 'danger-full-access',
      abortSignal: new AbortController().signal,
      awaitApproval: async () => 'allow' as const
    }

    expect((await host.listTools(baseContext)).map((spec) => spec.name)).toEqual(['load_skill'])
    await host.execute({
      callId: 'call_load',
      toolName: 'load_skill',
      arguments: { skill_id: 'demo' }
    }, baseContext)

    const nextResolution = await runtime.resolveTurn({
      prompt: 'continue',
      workspace: root,
      threadId: 'thread_1',
      turnId: 'turn_1'
    })
    const nextContext = { ...baseContext, activeSkillIds: nextResolution.activeSkillIds }
    expect((await host.listTools(nextContext)).map((spec) => spec.name)).toEqual([
      'load_skill', 'demo_run'
    ])
    await expect(host.execute({
      callId: 'call_run',
      toolName: 'demo_run',
      arguments: {}
    }, nextContext)).resolves.toMatchObject({
      item: expect.objectContaining({ kind: 'tool_result', output: { ran: true } })
    })
  })
})
