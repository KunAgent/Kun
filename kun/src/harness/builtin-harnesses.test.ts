import { describe, expect, it } from 'vitest'
import { BUILTIN_HARNESSES } from './builtin-harnesses.js'
import { HarnessDefinitionSchema } from '../contracts/harness.js'
import { KUN_TOOL_PERMISSION_MODES } from '../contracts/policy.js'

const ladderIndex = (mode: string): number => KUN_TOOL_PERMISSION_MODES.indexOf(
  mode as (typeof KUN_TOOL_PERMISSION_MODES)[number]
)

describe('BUILTIN_HARNESSES', () => {
  it('every definition passes the schema', () => {
    for (const def of BUILTIN_HARNESSES) {
      const parsed = HarnessDefinitionSchema.safeParse(def)
      expect(parsed.success, def.id).toBe(true)
    }
  })

  it('ids and transports are unique', () => {
    const ids = BUILTIN_HARNESSES.map((d) => d.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('permission modes run strict to wide on the Kun ladder', () => {
    for (const def of BUILTIN_HARNESSES) {
      const rungs = def.permissionModes.map((mode) => ladderIndex(mode.kunPermissionMode))
      expect(rungs.length, def.id).toBeGreaterThan(0)
      for (let i = 1; i < rungs.length; i += 1) {
        expect(
          rungs[i]! >= rungs[i - 1]!,
          `${def.id}: ${def.permissionModes[i]!.id} is narrower than ${def.permissionModes[i - 1]!.id}`
        ).toBe(true)
      }
      // The first entry is the safest fallback used for unknown requests.
      expect(rungs[0]).toBe(Math.min(...rungs))
    }
  })

  it('CLI transports declare a detect block; SDK transports do not need one', () => {
    for (const def of BUILTIN_HARNESSES) {
      if (def.transport === 'antigravity-cli' || def.transport === 'acp') {
        expect(def.detect?.command, def.id).toBeTruthy()
      }
      if (def.transport === 'native-loop' || def.transport === 'agent-sdk' || def.transport === 'cursor-sdk') {
        expect(def.transport).toBeTruthy()
      }
    }
  })

  // P4-07: Agent Center cards are data-driven from `setup` — locally
  // installable harnesses must declare install or login guidance, and the
  // entries must pass schema validation with no stray keys.
  it('locally installable builtins carry setup metadata', () => {
    for (const def of BUILTIN_HARNESSES) {
      if (!def.detect) continue
      const setup = def.setup
      expect(setup, def.id).toBeTruthy()
      expect(
        Boolean(setup?.install?.length || setup?.adapter || setup?.docsUrl),
        `${def.id} has no install path, adapter, or docs link`
      ).toBe(true)
      const parsed = HarnessDefinitionSchema.safeParse(def)
      expect(parsed.success, def.id).toBe(true)
    }
  })

  it('setup snapshots pin the commands the terminal prefill shows', () => {
    const byId = new Map(BUILTIN_HARNESSES.map((def) => [def.id, def]))
    expect(byId.get('claude-code')?.setup?.login).toMatchObject({ command: 'claude' })
    expect(byId.get('gemini-cli')?.setup?.login).toMatchObject({
      command: 'gemini', args: []
    })
    expect(byId.get('codex')?.setup).toMatchObject({
      login: { command: 'codex', args: ['login'] }
    })
    expect(byId.get('codex')?.setup?.adapter).toBeUndefined()
    expect(byId.get('opencode')?.setup?.login).toMatchObject({
      command: 'opencode', args: ['auth', 'login']
    })
    // Provider/SDK-only harnesses and the native loop need no setup card data.
    expect(byId.get('kun')?.setup).toBeUndefined()
    expect(byId.get('cursor')?.setup).toBeUndefined()
  })
})
