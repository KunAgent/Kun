import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyImportPlan, buildImportPlan } from '../src/instructions/instruction-import.js'
import { IMPORT_ADAPTERS, adapterById, supportedToolIds } from '../src/instructions/import-adapters.js'

describe('import-adapters (round 1)', () => {
  let root = ''
  let home = ''
  let workspace = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-import-adapters-'))
    home = join(root, 'home')
    workspace = join(root, 'workspace')
    await mkdir(home, { recursive: true })
    await mkdir(workspace, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('exposes claude-code and codex and rejects unknown ids', () => {
    expect(supportedToolIds()).toEqual(expect.arrayContaining(['claude-code', 'codex']))
    expect(adapterById('claude-code')?.label).toBe('Claude Code')
    expect(adapterById('nope')).toBeUndefined()
  })

  it('imports Claude Code CLAUDE.md, CLAUDE.local.md and .claude/rules into workspace AGENTS.md', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'Base rule.', 'utf8')
    await writeFile(join(workspace, 'CLAUDE.local.md'), 'Local rule.', 'utf8')
    await mkdir(join(workspace, '.claude', 'rules'), { recursive: true })
    await writeFile(join(workspace, '.claude', 'rules', 'a.md'), 'Rule A.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['workspace'], tools: ['claude-code']
    })
    await applyImportPlan(plan, { workspace })
    const text = await readFile(join(workspace, 'AGENTS.md'), 'utf8')

    expect(text).toContain('Base rule.')
    expect(text).toContain('Local rule.')
    expect(text).toContain('Rule A.')
    expect(text).toContain('<!-- kun:import:begin tool=claude-code -->')
  })

  it('imports Claude Code global CLAUDE.md into ~/.kun/AGENTS.md', async () => {
    await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(join(home, '.claude', 'CLAUDE.md'), 'Global claude rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['global'], tools: ['claude-code']
    })
    await applyImportPlan(plan, { workspace })
    const text = await readFile(join(home, '.kun', 'AGENTS.md'), 'utf8')

    expect(text).toContain('Global claude rule.')
  })

  it('skips Codex workspace AGENTS.md as identity but imports AGENTS.override.md while preserving native content', async () => {
    await writeFile(join(workspace, 'AGENTS.md'), 'Kun native rule.', 'utf8')
    await writeFile(join(workspace, 'AGENTS.override.md'), 'Codex override rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['workspace'], tools: ['codex']
    })

    expect(plan.warnings).toContainEqual({ code: 'identity-skip', tool: 'codex', path: join(workspace, 'AGENTS.md') })
    await applyImportPlan(plan, { workspace })
    const text = await readFile(join(workspace, 'AGENTS.md'), 'utf8')

    expect(text).toContain('Kun native rule.')
    expect(text).toContain('Codex override rule.')
  })

  it('imports Codex global AGENTS.md into ~/.kun/AGENTS.md', async () => {
    await mkdir(join(home, '.codex'), { recursive: true })
    await writeFile(join(home, '.codex', 'AGENTS.md'), 'Global codex rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['global'], tools: ['codex']
    })
    await applyImportPlan(plan, { workspace })
    const text = await readFile(join(home, '.kun', 'AGENTS.md'), 'utf8')

    expect(text).toContain('Global codex rule.')
    expect(text).toContain('<!-- kun:import:begin tool=codex -->')
  })
})
