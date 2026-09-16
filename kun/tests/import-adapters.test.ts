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
    expect(text).toContain('<!-- kun:import:begin tool=claude-code sha=')
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
    expect(text).toContain('<!-- kun:import:begin tool=codex sha=')
  })
})

describe('import-adapters (round 2: cursor, gemini)', () => {
  let root = ''
  let home = ''
  let workspace = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-import-adapters2-'))
    home = join(root, 'home')
    workspace = join(root, 'workspace')
    await mkdir(home, { recursive: true })
    await mkdir(workspace, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('imports Cursor .mdc rules (frontmatter stripped) and legacy .cursorrules', async () => {
    await mkdir(join(workspace, '.cursor', 'rules'), { recursive: true })
    await writeFile(join(workspace, '.cursor', 'rules', 'style.mdc'), '---\ndescription: style\n---\nUse tabs.', 'utf8')
    await writeFile(join(workspace, '.cursorrules'), 'Legacy cursor rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['workspace'], tools: ['cursor']
    })
    await applyImportPlan(plan, { workspace })
    const text = await readFile(join(workspace, 'AGENTS.md'), 'utf8')

    expect(text).toContain('Use tabs.')
    expect(text).toContain('Legacy cursor rule.')
    expect(text).not.toContain('description: style')
    expect(text).toContain('<!-- kun:import:begin tool=cursor sha=')
  })

  it('imports Gemini GEMINI.md at workspace and global scope', async () => {
    await writeFile(join(workspace, 'GEMINI.md'), 'Workspace gemini rule.', 'utf8')
    await mkdir(join(home, '.gemini'), { recursive: true })
    await writeFile(join(home, '.gemini', 'GEMINI.md'), 'Global gemini rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['workspace', 'global'], tools: ['gemini']
    })
    await applyImportPlan(plan, { workspace })

    expect(await readFile(join(workspace, 'AGENTS.md'), 'utf8')).toContain('Workspace gemini rule.')
    expect(await readFile(join(home, '.kun', 'AGENTS.md'), 'utf8')).toContain('Global gemini rule.')
  })
})

describe('import-adapters (round 3: copilot, windsurf, cline)', () => {
  let root = ''
  let home = ''
  let workspace = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-import-adapters3-'))
    home = join(root, 'home')
    workspace = join(root, 'workspace')
    await mkdir(home, { recursive: true })
    await mkdir(workspace, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('imports Copilot instructions and .github/instructions with frontmatter stripped', async () => {
    await mkdir(join(workspace, '.github', 'instructions'), { recursive: true })
    await writeFile(join(workspace, '.github', 'copilot-instructions.md'), 'Copilot main rule.', 'utf8')
    await writeFile(join(workspace, '.github', 'instructions', 'ts.instructions.md'), '---\napplyTo: "**/*.ts"\n---\nTS rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['workspace'], tools: ['copilot']
    })
    await applyImportPlan(plan, { workspace })
    const text = await readFile(join(workspace, 'AGENTS.md'), 'utf8')

    expect(text).toContain('Copilot main rule.')
    expect(text).toContain('TS rule.')
    expect(text).not.toContain('applyTo:')
  })

  it('imports Windsurf rules directory and legacy .windsurfrules', async () => {
    await mkdir(join(workspace, '.windsurf', 'rules'), { recursive: true })
    await writeFile(join(workspace, '.windsurf', 'rules', 'core.md'), 'Windsurf core rule.', 'utf8')
    await writeFile(join(workspace, '.windsurfrules'), 'Legacy windsurf rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['workspace'], tools: ['windsurf']
    })
    await applyImportPlan(plan, { workspace })
    const text = await readFile(join(workspace, 'AGENTS.md'), 'utf8')

    expect(text).toContain('Windsurf core rule.')
    expect(text).toContain('Legacy windsurf rule.')
  })

  it('imports a .clinerules file', async () => {
    await writeFile(join(workspace, '.clinerules'), 'Cline file rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['workspace'], tools: ['cline']
    })
    await applyImportPlan(plan, { workspace })

    expect(await readFile(join(workspace, 'AGENTS.md'), 'utf8')).toContain('Cline file rule.')
  })

  it('imports a .clinerules directory of markdown rules', async () => {
    await mkdir(join(workspace, '.clinerules'), { recursive: true })
    await writeFile(join(workspace, '.clinerules', 'one.md'), 'Cline dir rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['workspace'], tools: ['cline']
    })
    await applyImportPlan(plan, { workspace })

    expect(await readFile(join(workspace, 'AGENTS.md'), 'utf8')).toContain('Cline dir rule.')
  })
})

describe('import-adapters (round 4: zed, opencode, kiro)', () => {
  let root = ''
  let home = ''
  let workspace = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-import-adapters4-'))
    home = join(root, 'home')
    workspace = join(root, 'workspace')
    await mkdir(home, { recursive: true })
    await mkdir(workspace, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('imports Zed .rules at workspace and ~/.config/zed/AGENTS.md at global scope', async () => {
    await writeFile(join(workspace, '.rules'), 'Zed workspace rule.', 'utf8')
    await mkdir(join(home, '.config', 'zed'), { recursive: true })
    await writeFile(join(home, '.config', 'zed', 'AGENTS.md'), 'Zed global rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['workspace', 'global'], tools: ['zed']
    })
    await applyImportPlan(plan, { workspace })

    expect(await readFile(join(workspace, 'AGENTS.md'), 'utf8')).toContain('Zed workspace rule.')
    expect(await readFile(join(home, '.kun', 'AGENTS.md'), 'utf8')).toContain('Zed global rule.')
  })

  it('skips OpenCode workspace AGENTS.md as identity but imports .opencode/memories', async () => {
    await writeFile(join(workspace, 'AGENTS.md'), 'Kun native rule.', 'utf8')
    await mkdir(join(workspace, '.opencode', 'memories'), { recursive: true })
    await writeFile(join(workspace, '.opencode', 'memories', 'mem.md'), 'OpenCode memory rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['workspace'], tools: ['opencode']
    })

    expect(plan.warnings).toContainEqual({ code: 'identity-skip', tool: 'opencode', path: join(workspace, 'AGENTS.md') })
    await applyImportPlan(plan, { workspace })
    const text = await readFile(join(workspace, 'AGENTS.md'), 'utf8')

    expect(text).toContain('Kun native rule.')
    expect(text).toContain('OpenCode memory rule.')
  })

  it('imports Kiro steering files with inclusion frontmatter stripped', async () => {
    await mkdir(join(workspace, '.kiro', 'steering'), { recursive: true })
    await writeFile(join(workspace, '.kiro', 'steering', 'product.md'), 'Product steering.', 'utf8')
    await writeFile(
      join(workspace, '.kiro', 'steering', 'ts.md'),
      '---\ninclusion: fileMatch\nfileMatchPattern: "**/*.ts"\n---\nTS steering.',
      'utf8'
    )

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['workspace'], tools: ['kiro']
    })
    await applyImportPlan(plan, { workspace })
    const text = await readFile(join(workspace, 'AGENTS.md'), 'utf8')

    expect(text).toContain('Product steering.')
    expect(text).toContain('TS steering.')
    expect(text).not.toContain('inclusion: fileMatch\n')
    expect(text).toContain('NOT enforced by Kun')
    expect(text).toContain('inclusion=fileMatch(**/*.ts)')
  })

  it('exposes all ten tools', () => {
    expect(supportedToolIds()).toEqual(expect.arrayContaining([
      'claude-code', 'codex', 'cursor', 'gemini', 'copilot', 'windsurf', 'cline', 'zed', 'opencode', 'kiro'
    ]))
  })
})

describe('import-adapters (round 5: roo-code, kilo-code)', () => {
  let root = ''
  let home = ''
  let workspace = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-import-adapters5-'))
    home = join(root, 'home')
    workspace = join(root, 'workspace')
    await mkdir(home, { recursive: true })
    await mkdir(workspace, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('imports Roo Code .roo/rules and legacy .roorules at workspace scope', async () => {
    await mkdir(join(workspace, '.roo', 'rules'), { recursive: true })
    await writeFile(join(workspace, '.roo', 'rules', 'core.md'), 'Roo core rule.', 'utf8')
    await writeFile(join(workspace, '.roorules'), 'Legacy roo rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['workspace'], tools: ['roo-code']
    })
    await applyImportPlan(plan, { workspace })
    const text = await readFile(join(workspace, 'AGENTS.md'), 'utf8')

    expect(text).toContain('Roo core rule.')
    expect(text).toContain('Legacy roo rule.')
    expect(text).toContain('<!-- kun:import:begin tool=roo-code sha=')
  })

  it('imports Roo Code global ~/.roo/rules into ~/.kun/AGENTS.md', async () => {
    await mkdir(join(home, '.roo', 'rules'), { recursive: true })
    await writeFile(join(home, '.roo', 'rules', 'g.md'), 'Roo global rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['global'], tools: ['roo-code']
    })
    await applyImportPlan(plan, { workspace })

    expect(await readFile(join(home, '.kun', 'AGENTS.md'), 'utf8')).toContain('Roo global rule.')
  })

  it('skips Kilo Code root AGENTS.md as identity but imports .kilocode/rules', async () => {
    await writeFile(join(workspace, 'AGENTS.md'), 'Kun native rule.', 'utf8')
    await mkdir(join(workspace, '.kilocode', 'rules'), { recursive: true })
    await writeFile(join(workspace, '.kilocode', 'rules', 'r.md'), 'Kilo rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['workspace'], tools: ['kilo-code']
    })

    expect(plan.warnings).toContainEqual({ code: 'identity-skip', tool: 'kilo-code', path: join(workspace, 'AGENTS.md') })
    await applyImportPlan(plan, { workspace })
    const text = await readFile(join(workspace, 'AGENTS.md'), 'utf8')

    expect(text).toContain('Kun native rule.')
    expect(text).toContain('Kilo rule.')
  })

  it('imports Kilo Code global config AGENTS.md and ~/.kilocode/rules', async () => {
    await mkdir(join(home, '.config', 'kilo'), { recursive: true })
    await writeFile(join(home, '.config', 'kilo', 'AGENTS.md'), 'Kilo global config rule.', 'utf8')
    await mkdir(join(home, '.kilocode', 'rules'), { recursive: true })
    await writeFile(join(home, '.kilocode', 'rules', 'g.md'), 'Kilo global dir rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['global'], tools: ['kilo-code']
    })
    await applyImportPlan(plan, { workspace })
    const text = await readFile(join(home, '.kun', 'AGENTS.md'), 'utf8')

    expect(text).toContain('Kilo global config rule.')
    expect(text).toContain('Kilo global dir rule.')
  })
})

describe('import-adapters (round 6: continue, amp)', () => {
  let root = ''
  let home = ''
  let workspace = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-import-adapters6-'))
    home = join(root, 'home')
    workspace = join(root, 'workspace')
    await mkdir(home, { recursive: true })
    await mkdir(workspace, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('skips Continue root AGENTS.md as identity and notes scoped rule frontmatter', async () => {
    await writeFile(join(workspace, 'AGENTS.md'), 'Kun native rule.', 'utf8')
    await mkdir(join(workspace, '.continue', 'rules'), { recursive: true })
    await writeFile(join(workspace, '.continue', 'rules', 'all.md'), '---\nalwaysApply: true\n---\nContinue always rule.', 'utf8')
    await writeFile(join(workspace, '.continue', 'rules', 'ts.md'), '---\nglobs: "**/*.ts"\n---\nContinue TS rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['workspace'], tools: ['continue']
    })

    expect(plan.warnings).toContainEqual({ code: 'identity-skip', tool: 'continue', path: join(workspace, 'AGENTS.md') })
    await applyImportPlan(plan, { workspace })
    const text = await readFile(join(workspace, 'AGENTS.md'), 'utf8')

    expect(text).toContain('Kun native rule.')
    expect(text).toContain('Continue always rule.')
    expect(text).toContain('Continue TS rule.')
    expect(text).toContain('globs=**/*.ts')
    expect(text).toContain('NOT enforced by Kun')
  })

  it('imports Continue global ~/.continue/rules into ~/.kun/AGENTS.md', async () => {
    await mkdir(join(home, '.continue', 'rules'), { recursive: true })
    await writeFile(join(home, '.continue', 'rules', 'g.md'), 'Continue global rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['global'], tools: ['continue']
    })
    await applyImportPlan(plan, { workspace })

    expect(await readFile(join(home, '.kun', 'AGENTS.md'), 'utf8')).toContain('Continue global rule.')
  })

  it('skips Amp root AGENTS.md as identity and imports .agents/memories with scope note', async () => {
    await writeFile(join(workspace, 'AGENTS.md'), 'Kun native rule.', 'utf8')
    await mkdir(join(workspace, '.agents', 'memories'), { recursive: true })
    await writeFile(join(workspace, '.agents', 'memories', 'ts.md'), '---\nglobs: "**/*.ts"\n---\nAmp TS memory.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['workspace'], tools: ['amp']
    })

    expect(plan.warnings).toContainEqual({ code: 'identity-skip', tool: 'amp', path: join(workspace, 'AGENTS.md') })
    await applyImportPlan(plan, { workspace })
    const text = await readFile(join(workspace, 'AGENTS.md'), 'utf8')

    expect(text).toContain('Kun native rule.')
    expect(text).toContain('Amp TS memory.')
    expect(text).toContain('globs=**/*.ts')
    expect(text).toContain('NOT enforced by Kun')
  })

  it('imports Amp global config AGENTS.md into ~/.kun/AGENTS.md', async () => {
    await mkdir(join(home, '.config', 'amp'), { recursive: true })
    await writeFile(join(home, '.config', 'amp', 'AGENTS.md'), 'Amp global rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters: IMPORT_ADAPTERS, scopes: ['global'], tools: ['amp']
    })
    await applyImportPlan(plan, { workspace })

    expect(await readFile(join(home, '.kun', 'AGENTS.md'), 'utf8')).toContain('Amp global rule.')
  })
})
