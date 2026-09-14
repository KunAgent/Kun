import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyImportPlan,
  buildImportPlan,
  detectImportSources,
  mergeManagedBlock,
  parseImportArgs,
  type SourceAdapter,
  type SourceToolId
} from '../src/instructions/instruction-import.js'

const KNOWN: SourceToolId[] = ['claude-code', 'codex', 'cursor']

describe('parseImportArgs', () => {
  it('defaults to workspace scope, no tools, no dry-run', () => {
    expect(parseImportArgs(undefined, KNOWN)).toEqual({
      tools: [], unknownTools: [], scopes: ['workspace'], dryRun: false
    })
  })

  it('extracts a known tool and keeps workspace scope', () => {
    const parsed = parseImportArgs('claude-code', KNOWN)
    expect(parsed.tools).toEqual(['claude-code'])
    expect(parsed.scopes).toEqual(['workspace'])
  })

  it('maps --global alone to global-only scope', () => {
    expect(parseImportArgs('--global', KNOWN).scopes).toEqual(['global'])
  })

  it('maps --global --workspace to both scopes', () => {
    expect(parseImportArgs('codex --global --workspace', KNOWN).scopes).toEqual(['workspace', 'global'])
  })

  it('flags --dry-run', () => {
    expect(parseImportArgs('--dry-run', KNOWN).dryRun).toBe(true)
  })

  it('separates unknown tools from known tools', () => {
    const parsed = parseImportArgs('claude-code bogus cursor', KNOWN)
    expect(parsed.tools).toEqual(['claude-code', 'cursor'])
    expect(parsed.unknownTools).toEqual(['bogus'])
  })
})

const adapters: SourceAdapter[] = [
  {
    tool: 'claude-code',
    label: 'Claude Code',
    workspace: [
      { kind: 'CLAUDE.md', relFile: 'CLAUDE.md', resolveImports: true },
      { kind: '.claude/rules', relDir: '.claude/rules', exts: ['.md'] }
    ],
    global: [{ kind: '~/.claude/CLAUDE.md', relFile: '.claude/CLAUDE.md' }]
  },
  {
    tool: 'codex',
    label: 'Codex',
    workspace: [{ kind: 'AGENTS.md', relFile: 'AGENTS.md' }],
    global: [{ kind: '~/.codex/AGENTS.md', relFile: '.codex/AGENTS.md' }]
  },
  {
    tool: 'cursor',
    label: 'Cursor',
    workspace: [{ kind: '.cursor/rules', relDir: '.cursor/rules', exts: ['.mdc'], stripFrontmatter: true }],
    global: []
  }
]

describe('instruction-import', () => {
  let root = ''
  let home = ''
  let workspace = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-import-'))
    home = join(root, 'home')
    workspace = join(root, 'workspace')
    await mkdir(home, { recursive: true })
    await mkdir(workspace, { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('detects present sources per tool and scope, and omits absent tools', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'Claude rule.', 'utf8')
    await mkdir(join(workspace, '.cursor', 'rules'), { recursive: true })
    await writeFile(join(workspace, '.cursor', 'rules', 'style.mdc'), '---\nx: 1\n---\nCursor rule.', 'utf8')

    const found = await detectImportSources({ workspace, homeDir: home, adapters, scopes: ['workspace'] })
    const tools = found.map((source) => source.tool).sort()

    expect(tools).toEqual(['claude-code', 'cursor'])
    expect(found.every((source) => source.scope === 'workspace')).toBe(true)
  })

  it('detects global sources independently of workspace sources', async () => {
    await writeFile(join(home, '.claude', 'CLAUDE.md'), 'Global claude.', 'utf8').catch(async () => {
      await mkdir(join(home, '.claude'), { recursive: true })
      await writeFile(join(home, '.claude', 'CLAUDE.md'), 'Global claude.', 'utf8')
    })

    const found = await detectImportSources({ workspace, homeDir: home, adapters, scopes: ['global'] })

    expect(found.map((source) => source.tool)).toEqual(['claude-code'])
    expect(found[0]?.scope).toBe('global')
  })

  it('strips .mdc frontmatter and preserves the markdown body', async () => {
    await mkdir(join(workspace, '.cursor', 'rules'), { recursive: true })
    await writeFile(join(workspace, '.cursor', 'rules', 'style.mdc'), '---\ndescription: x\n---\nUse tabs.', 'utf8')

    const plan = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['cursor'] })
    const text = plan.targets[0]?.mergedText ?? ''

    expect(text).toContain('Use tabs.')
    expect(text).not.toContain('description: x')
  })

  it('skips a Codex workspace AGENTS.md that is the target itself', async () => {
    await writeFile(join(workspace, 'AGENTS.md'), 'Existing kun rule.', 'utf8')

    const plan = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['codex'] })

    expect(plan.warnings).toContainEqual({
      code: 'identity-skip',
      tool: 'codex',
      path: join(workspace, 'AGENTS.md')
    })
    expect(plan.targets[0]?.changed).toBe(false)
  })

  it('inlines nested @import references', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'Top.\n@docs/rules.md', 'utf8')
    await mkdir(join(workspace, 'docs'), { recursive: true })
    await writeFile(join(workspace, 'docs', 'rules.md'), 'Mid.\n@detail.md', 'utf8')
    await writeFile(join(workspace, 'docs', 'detail.md'), 'Leaf detail.', 'utf8')

    const plan = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'] })
    const text = plan.targets[0]?.mergedText ?? ''

    expect(text).toContain('Top.')
    expect(text).toContain('Mid.')
    expect(text).toContain('Leaf detail.')
  })

  it('detects an @import cycle and warns without infinite recursion', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'Root.\n@a.md', 'utf8')
    await writeFile(join(workspace, 'a.md'), 'A.\n@b.md', 'utf8')
    await writeFile(join(workspace, 'b.md'), 'B.\n@a.md', 'utf8')

    const plan = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'] })

    expect(plan.warnings.some((w) => w.code === 'import-cycle')).toBe(true)
    expect(plan.targets[0]?.mergedText).toContain('A.')
  })

  it('warns on an unresolvable path-like @import and leaves the token', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'Root.\n@docs/missing.md', 'utf8')

    const plan = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'] })

    expect(plan.warnings.some((w) => w.code === 'unresolved-import')).toBe(true)
    expect(plan.targets[0]?.mergedText).toContain('@docs/missing.md')
  })

  it('appends a managed block on first import and is idempotent on re-import', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'Claude rule.', 'utf8')

    const first = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'] })
    expect(first.targets[0]?.changed).toBe(true)
    await applyImportPlan(first, { workspace })

    const second = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'] })
    expect(second.targets[0]?.changed).toBe(false)
  })

  it('replaces only its own block and preserves user text and other blocks', () => {
    const existing = 'User note.\n\n<!-- kun:import:begin tool=codex -->\nCodex block.\n<!-- kun:import:end tool=codex -->\n'
    const merged = mergeManagedBlock(existing, 'claude-code', 'Claude block.')
    const remerged = mergeManagedBlock(merged, 'claude-code', 'Claude block v2.')

    expect(remerged).toContain('User note.')
    expect(remerged).toContain('Codex block.')
    expect(remerged).toContain('Claude block v2.')
    expect(remerged).not.toContain('Claude block.\n<!-- kun:import:end tool=claude-code')
  })

  it('routes workspace and global scopes to their own targets', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'WS rule.', 'utf8')
    await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(join(home, '.claude', 'CLAUDE.md'), 'Global rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters, scopes: ['workspace', 'global'], tools: ['claude-code']
    })
    const ws = plan.targets.find((t) => t.scope === 'workspace')
    const gl = plan.targets.find((t) => t.scope === 'global')

    expect(ws?.target).toBe(join(workspace, 'AGENTS.md'))
    expect(ws?.mergedText).toContain('WS rule.')
    expect(ws?.mergedText).not.toContain('Global rule.')
    expect(gl?.target).toBe(join(home, '.kun', 'AGENTS.md'))
    expect(gl?.mergedText).toContain('Global rule.')
  })

  it('warns when a merged target exceeds the per-file byte budget', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'x'.repeat(200), 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'], maxFileBytes: 64
    })

    expect(plan.warnings.some((w) => w.code === 'budget-exceeded')).toBe(true)
  })

  it('applies only workspace target and creates ~/.kun for global', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'WS rule.', 'utf8')
    await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(join(home, '.claude', 'CLAUDE.md'), 'Global rule.', 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters, scopes: ['workspace', 'global'], tools: ['claude-code']
    })
    const applied = await applyImportPlan(plan, { workspace })

    expect(applied.map((a) => a.scope).sort()).toEqual(['global', 'workspace'])
    const globalText = await readIfExists(join(home, '.kun', 'AGENTS.md'))
    expect(globalText).toContain('Global rule.')
  })

  it('refuses to write through a workspace AGENTS.md symlink', async () => {
    const outside = join(root, 'outside.md')
    await writeFile(outside, 'secret', 'utf8')
    await symlink(outside, join(workspace, 'AGENTS.md'))
    await writeFile(join(workspace, 'CLAUDE.md'), 'WS rule.', 'utf8')

    const plan = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'] })

    await expect(applyImportPlan(plan, { workspace })).rejects.toThrow(/symbolic link/u)
    expect((await lstat(outside)).isFile()).toBe(true)
  })
})

async function readIfExists(path: string): Promise<string> {
  const { readFile } = await import('node:fs/promises')
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}
