import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SubagentProfileConfig } from '../contracts/capabilities.js'
import type { HarnessDefinition, HarnessId, HarnessStatus } from '../contracts/harness.js'
import {
  allSupportedStatuses,
  type HarnessCapabilities,
  type HarnessCapabilityKey
} from '../contracts/harness-capabilities.js'
import { BUILTIN_HARNESSES } from '../harness/builtin-harnesses.js'
import { AgentRoster, type AgentRosterDeps } from './agent-roster.js'
import type { AgentRosterEngineAccess } from './agent-roster-lanes.js'
import { BUILTIN_SUBAGENT_PROFILES } from './builtin-profiles.js'

const READY = (harnessId: string): HarnessStatus => ({
  harnessId,
  installed: 'yes',
  login: 'signed-in',
  checkedAt: '2026-01-01T00:00:00.000Z'
})

const def = (id: string): HarnessDefinition =>
  BUILTIN_HARNESSES.find((entry) => entry.id === id)!

function caps(unsupported: HarnessCapabilityKey[] = [], sandbox: 'host' | 'native' | 'none' = 'native'): HarnessCapabilities {
  const statuses = allSupportedStatuses()
  for (const key of unsupported) statuses[key] = { supported: false, reason: 'upstream' }
  return { statuses, facts: { sandbox, usageReporting: 'exact', compactionOwner: 'kun' } }
}

function engines(input: {
  ids?: string[]
  capsFor?: Record<string, HarnessCapabilities>
  statuses?: Record<string, HarnessStatus | undefined>
  disabled?: string[]
} = {}): AgentRosterEngineAccess {
  const defs = (input.ids ?? ['kun', 'claude-code', 'codex']).map(def)
  return {
    catalog: {
      get: (id) => defs.find((entry) => entry.id === id),
      isDisabled: (id: HarnessId) => input.disabled?.includes(id) ?? false
    },
    detector: {
      cachedStatus: (id) => input.statuses && id in input.statuses ? input.statuses[id] : READY(id),
      status: async (id) => input.statuses?.[id] ?? READY(id)
    },
    capabilitiesForRoute: async (route) => input.capsFor?.[route.harnessId] ?? caps(),
    configuredModel: () => undefined
  }
}

function roster(profiles: Record<string, SubagentProfileConfig>, overrides: Partial<AgentRosterDeps> = {}): AgentRoster {
  return new AgentRoster({
    profiles: () => profiles,
    honorEngineBinding: () => true,
    defaultParent: () => ({ model: 'deepseek-chat', providerId: 'deepseek' }),
    engines: engines(),
    ...overrides
  })
}

const reviewer: SubagentProfileConfig = {
  name: 'Codex Reviewer',
  description: 'Reviews diffs.',
  owns: 'owns code review. Do not review diffs yourself.',
  mode: 'subagent',
  toolPolicy: 'readOnly',
  harnessId: 'codex',
  model: 'gpt-5.5-codex'
}

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function workspaceWith(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'kun-roster-'))
  tempDirs.push(root)
  await mkdir(join(root, '.kun', 'agents'), { recursive: true })
  for (const [name, body] of Object.entries(files)) {
    await writeFile(join(root, '.kun', 'agents', name), body, 'utf8')
  }
  return root
}

describe('AgentRoster', () => {
  it('lists built-in, configured and workspace roles with the workspace winning', async () => {
    const workspace = await workspaceWith({
      'general.md': '---\nname: Workspace General\ndescription: overrides general\n---\nBe general.'
    })
    const entries = await roster({ ...BUILTIN_SUBAGENT_PROFILES, reviewer }).list({ workspace })
    const byId = new Map(entries.map((entry) => [entry.id, entry]))
    expect(byId.get('explore')?.source).toBe('builtin')
    expect(byId.get('reviewer')?.source).toBe('configured')
    expect(byId.get('general')).toMatchObject({ source: 'workspace', name: 'Workspace General' })
    expect(entries.map((entry) => entry.id)).toEqual([...entries.map((entry) => entry.id)].sort())
  })

  it('reports a bound engine and admits it on every lane it can run', async () => {
    const [entry] = await roster({ reviewer }).list()
    expect(entry!.engine).toMatchObject({ kind: 'bound', harnessId: 'codex', model: 'gpt-5.5-codex' })
    expect(entry!.owns).toBe('owns code review. Do not review diffs yourself.')
    expect(entry!.lanes).toEqual({
      delegate: { state: 'ok' },
      worker: { state: 'ok' },
      graph: { state: 'ok' },
      conversation: { state: 'ok' }
    })
    expect(entry!.facts.writes).toBe(false)
  })

  it('blocks only the lanes whose admission rule the engine misses', async () => {
    const [entry] = await roster({ reviewer }, {
      engines: engines({ capsFor: { codex: caps(['kunTools']) } })
    }).list()
    expect(entry!.lanes.graph).toMatchObject({ state: 'blocked', code: 'capability_missing' })
    expect(entry!.lanes.worker).toEqual({ state: 'ok' })
    expect(entry!.facts.kunTools).toBe(false)
  })

  it('requires an engine sandbox before a writing role shares the parent workspace', async () => {
    const writer = { ...reviewer, toolPolicy: 'inherit' as const }
    const [entry] = await roster({ writer }, {
      engines: engines({ capsFor: { codex: caps([], 'none') } })
    }).list()
    expect(entry!.lanes.delegate).toMatchObject({ state: 'blocked', code: 'sandbox_insufficient' })
    expect(entry!.lanes.worker).toEqual({ state: 'ok' })
  })

  it('marks unknown or disabled engines unavailable on every lane', async () => {
    const ghost = { ...reviewer, harnessId: 'ghost-agent' }
    const entries = await roster({ ghost, reviewer }, {
      engines: engines({ disabled: ['codex'] })
    }).list()
    for (const entry of entries) {
      expect(Object.values(entry.lanes).every((lane) =>
        lane.state === 'blocked' && lane.code === 'engine_unavailable')).toBe(true)
    }
  })

  it('reports unchecked readiness without probing during a listing', async () => {
    const [entry] = await roster({ reviewer }, {
      engines: engines({ statuses: { codex: undefined } })
    }).list()
    expect(entry!.lanes.worker).toEqual({ state: 'unchecked' })
  })

  it('keeps primary-session roles off the dispatch lanes', async () => {
    const persona: SubagentProfileConfig = { name: 'Persona', mode: 'primary', toolPolicy: 'inherit' }
    const [entry] = await roster({ persona }).list()
    expect(entry!.lanes.delegate).toMatchObject({ state: 'blocked', code: 'mode_mismatch' })
    expect(entry!.lanes.conversation).toEqual({ state: 'ok' })
  })

  it('resolves a lane route, or no route when delegate_task ignores bindings', async () => {
    const honored = await roster({ reviewer }).resolve('reviewer', { lane: 'delegate' })
    expect(honored).toMatchObject({ ok: true, route: { harnessId: 'codex', model: 'gpt-5.5-codex' } })
    const ignored = await roster({ reviewer }, { honorEngineBinding: () => false })
      .resolve('reviewer', { lane: 'delegate' })
    expect(ignored).toMatchObject({ ok: true })
    expect(ignored.ok ? ignored.route : 'failed').toBeUndefined()
    const worker = await roster({ reviewer }, { honorEngineBinding: () => false })
      .resolve('reviewer', { lane: 'worker' })
    expect(worker).toMatchObject({ ok: true, route: { harnessId: 'codex' } })
  })

  it('tells an unknown id apart from a role on another surface', async () => {
    const writeOnly: SubagentProfileConfig = { name: 'Editor', mode: 'subagent', toolPolicy: 'inherit', surfaces: ['write'] }
    const subject = roster({ writeOnly })
    expect(await subject.resolve('writeOnly', { lane: 'delegate' })).toMatchObject({ ok: false, code: 'surface_mismatch' })
    expect(await subject.resolve('nobody', { lane: 'delegate' })).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('drops blocked roles from routing and explains why', async () => {
    const ghost = { ...reviewer, harnessId: 'ghost-agent' }
    const { documents, excluded } = await roster({ ghost, reviewer }).routingDocuments({ lane: 'worker' })
    expect(documents.map((document) => document.id)).toEqual(['reviewer'])
    expect(excluded).toEqual([{ id: 'ghost', code: 'engine_unavailable', message: 'unknown engine ghost-agent' }])
  })

  it('never lets the generic role claim ownership', async () => {
    const entries = await roster({ general: { ...BUILTIN_SUBAGENT_PROFILES.general!, owns: 'owns everything' } }).list()
    expect(entries[0]!.owns).toBeUndefined()
  })

  it('appends trusted learned roles without shadowing catalog ids', async () => {
    const workspace = await workspaceWith({})
    const entries = await roster({ reviewer }, {
      learned: async () => [
        { id: 'reviewer', profile: { name: 'Shadow', mode: 'subagent', toolPolicy: 'readOnly' } },
        { id: 'learned-auditor', profile: { name: 'Auditor', mode: 'subagent', toolPolicy: 'readOnly' } }
      ]
    }).list({ workspace })
    expect(entries.map((entry) => [entry.id, entry.source])).toEqual([
      ['learned-auditor', 'learned'],
      ['reviewer', 'configured']
    ])
  })
})
