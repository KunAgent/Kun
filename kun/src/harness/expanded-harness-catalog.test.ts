import { describe, expect, it } from 'vitest'
import { HarnessDefinitionSchema } from '../contracts/harness.js'
import { KUN_TOOL_PERMISSION_MODES } from '../contracts/policy.js'
import { ACP_DEFAULT_CAPABILITIES, BUILTIN_HARNESSES } from './builtin-harnesses.js'
import { APPLICATION_HARNESSES } from './application-harnesses.js'
import { expandedCliHarnesses } from './expanded-cli-harnesses.js'
import { EXPANDED_HARNESS_UPDATE_RECIPES } from './expanded-harness-update-recipes.js'

const expanded = [...expandedCliHarnesses(ACP_DEFAULT_CAPABILITIES), ...APPLICATION_HARNESSES]
const byId = new Map(expanded.map((definition) => [definition.id, definition]))

// Fixed product coverage is checked independently of other repositories and their current files.
const SOURCE_TO_HARNESS = {
  claude: 'claude-code', 'claude-desktop': 'claude-desktop', codex: 'codex', gemini: 'gemini-cli',
  agy: 'antigravity', opencode: 'opencode', openchamber: 'openchamber', mimocode: 'mimocode',
  pi: 'pi', aside: 'aside', omo: 'omo', goose: 'goose', cursor: 'cursor',
  'cursor-local': 'cursor-local', zed: 'zed', vscode: 'vscode', air: 'air', copilot: 'copilot',
  crush: 'crush', dsh: 'deepseek-harness', commandcode: 'commandcode', fx: 'fx', omp: 'omp',
  devin: 'devin', hermes: 'hermes', morph: 'morph', kimi: 'kimi', muse: 'muse', empryo: 'empryo',
  'minimax-code': 'minimax-code', droid: 'droid', cline: 'cline', qoder: 'qoder', 'qoder-cn': 'qoder-cn',
  grok: 'grok', zcode: 'zcode', workbuddy: 'workbuddy', pencil: 'pencil', t3code: 't3code',
  hanako: 'hanako', atomcode: 'atomcode', alma: 'alma', cindy: 'cindy'
} as const

describe('expanded Agent catalog', () => {
  it('covers the fixed 43 products and separately exposes the Cursor CLI', () => {
    const all = new Set(BUILTIN_HARNESSES.map((definition) => definition.id))
    expect(all.size).toBe(BUILTIN_HARNESSES.length)
    expect(Object.keys(SOURCE_TO_HARNESS)).toHaveLength(43)
    expect(new Set(Object.values(SOURCE_TO_HARNESS)).size).toBe(43)
    for (const id of Object.values(SOURCE_TO_HARNESS)) expect(all.has(id), id).toBe(true)
    expect(byId.get('cursor-cli')?.transport).toBe('acp')
    expect(expanded).toHaveLength(35)
    expect(APPLICATION_HARNESSES).toHaveLength(13)
  })

  it('validates definitions without expanding permission ceilings', () => {
    expect(new Set(expanded.map((definition) => definition.id)).size).toBe(expanded.length)
    for (const definition of expanded) {
      const parsed = HarnessDefinitionSchema.safeParse(definition)
      expect(parsed.success, `${definition.id}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true)
      const rungs = definition.permissionModes.map((mode) => KUN_TOOL_PERMISSION_MODES.indexOf(mode.kunPermissionMode))
      expect(rungs).toEqual([...rungs].sort((a, b) => a - b))
      expect(definition.capabilities.facts.sandbox, definition.id).toBe('none')
      expect(definition.setup?.docsUrl, definition.id).toMatch(/^https:\/\//)
    }
  })

  it('pins official ACP commands instead of guessing a shared subcommand', () => {
    const expected: Record<string, string[]> = {
      'cursor-cli': ['agent', 'acp'], mimocode: ['mimo', 'acp'], goose: ['goose', 'acp'],
      copilot: ['copilot', '--acp', '--stdio'], fx: ['fx', 'acp'], omp: ['omp', 'acp'],
      hermes: ['hermes', 'acp'], kimi: ['kimi', 'acp'], 'minimax-code': ['mcode', 'acp'],
      droid: ['droid', 'exec', '--output-format', 'acp'],
      cline: ['cline', '--acp', '--auto-approve', 'false'],
      qoder: ['qoder', '--acp'], 'qoder-cn': ['qodercn', '--acp'], grok: ['grok', 'agent', 'stdio']
    }
    const acpIds = expanded.filter((definition) => definition.transport === 'acp').map((definition) => definition.id)
    expect(acpIds.sort()).toEqual(Object.keys(expected).sort())
    for (const [id, command] of Object.entries(expected)) {
      const definition = byId.get(id)!
      expect([definition.launch?.command, ...(definition.launch?.args ?? [])], id).toEqual(command)
      expect(command, id).not.toContain('--always-approve')
      expect(command, id).not.toContain('--yolo')
      expect(definition.poolScope, id).toBe('thread')
    }
    expect(byId.get('minimax-code')?.acpPermission?.configOptionId).toBe('permissionMode')
    expect(byId.get('droid')?.permissionModes.map((mode) => mode.id)).toEqual(['spec', 'auto'])
    expect(byId.get('droid')?.permissionModes[1]?.kunPermissionMode).toBe('full-access')
    expect(byId.get('droid')?.acpPermission?.configOptionId).toBeUndefined()
    expect(byId.get('minimax-code')?.poolScope).toBe('thread')
    expect(byId.get('fx')?.poolScope).toBe('thread')
    expect(byId.get('kimi')?.permissionModes.map((mode) => mode.id)).toEqual(['plan', 'default', 'auto', 'yolo'])
    expect(byId.get('kimi')?.detect?.minVersion).toBe('2.0.0')
    expect(byId.get('kimi')?.setup?.install?.[0]?.command).toContain('@moonshot-ai/kimi-code')
    expect(byId.get('commandcode')?.detect?.aliases).not.toContain('cmd')
  })

  it('keeps editor launchers and native apps out of chat dispatch', () => {
    for (const definition of APPLICATION_HARNESSES) {
      expect(definition.transport).toBe('application')
      expect(definition.launch).toBeUndefined()
      if (definition.detect) expect(definition.detect.versionArgs).toEqual([])
      expect(definition.application?.locations.length, definition.id).toBeGreaterThan(0)
      for (const location of definition.application!.locations) {
        expect(location.path, definition.id).not.toMatch(/settings\.json|config\.json|models\.json/)
      }
      expect(definition.capabilities.statuses.kunTools.supported, definition.id).toBe(false)
    }
    expect(byId.get('cursor-local')?.application?.productName).toBe('Cursor Private Inference')
    for (const id of ['aside', 'omo', 'crush', 'commandcode', 'morph', 'muse', 'empryo', 'atomcode']) {
      expect(byId.get(id)?.transport, id).toBe('terminal')
      expect(byId.get(id)?.capabilities.statuses.structuredStreaming.supported, id).toBe(false)
    }
  })

  it('uses curated publisher identities for managed CLI updates', () => {
    expect(EXPANDED_HARNESS_UPDATE_RECIPES.copilot?.packageName).toBe('@github/copilot')
    expect(EXPANDED_HARNESS_UPDATE_RECIPES.omp?.packageName).toBe('@oh-my-pi/pi-coding-agent')
    expect(EXPANDED_HARNESS_UPDATE_RECIPES['minimax-code']?.packageName).toBe('@minimax-ai/code')
    expect(EXPANDED_HARNESS_UPDATE_RECIPES.mimocode?.packageName).toBe('@mimo-ai/cli')
    expect(EXPANDED_HARNESS_UPDATE_RECIPES.kimi?.packageName).toBe('@moonshot-ai/kimi-code')
    expect(EXPANDED_HARNESS_UPDATE_RECIPES.empryo).toBeUndefined()
    for (const [id, recipe] of Object.entries(EXPANDED_HARNESS_UPDATE_RECIPES)) {
      expect(byId.has(id), id).toBe(true)
      expect(recipe.packageName, id).toMatch(/^(?:@[a-z0-9.-]+\/)?[a-z0-9.-]+$/)
    }
  })
})
