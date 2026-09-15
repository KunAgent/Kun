import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyImportPlan,
  buildImportPlan,
  describeWarning,
  detectImportSources,
  isManagedBlockModified,
  MAX_IMPORT_SOURCE_BYTES,
  mergeManagedBlock,
  parseImportArgs,
  type SourceAdapter,
  type SourceToolId
} from '../src/instructions/instruction-import.js'

const KNOWN: SourceToolId[] = ['claude-code', 'codex', 'cursor']

describe('parseImportArgs', () => {
  it('defaults to workspace scope, no tools, no dry-run', () => {
    expect(parseImportArgs(undefined, KNOWN)).toEqual({
      tools: [], unknownTools: [], unknownFlags: [], scopes: ['workspace'], dryRun: false, force: false
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

  it('collects unknown flags instead of silently ignoring them', () => {
    const parsed = parseImportArgs('--gloabl', KNOWN)
    expect(parsed.unknownFlags).toEqual(['--gloabl'])
  })

  it('accepts the three known flags without flagging them unknown', () => {
    const parsed = parseImportArgs('--global --workspace --dry-run', KNOWN)
    expect(parsed.unknownFlags).toEqual([])
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

  it('adds a non-enforced condition note for a scoped Cursor rule (globs)', async () => {
    await mkdir(join(workspace, '.cursor', 'rules'), { recursive: true })
    await writeFile(join(workspace, '.cursor', 'rules', 'ts.mdc'), '---\nglobs: "**/*.ts"\n---\nPrefer const.', 'utf8')

    const plan = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['cursor'] })
    const text = plan.targets[0]?.mergedText ?? ''

    expect(text).toContain('NOT enforced by Kun')
    expect(text).toContain('globs=**/*.ts')
    expect(text).toContain('Prefer const.')
  })

  it('does not add a condition note for an alwaysApply Cursor rule', async () => {
    await mkdir(join(workspace, '.cursor', 'rules'), { recursive: true })
    await writeFile(join(workspace, '.cursor', 'rules', 'all.mdc'), '---\nalwaysApply: true\nglobs: "**/*.ts"\n---\nGlobal rule.', 'utf8')

    const plan = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['cursor'] })
    const text = plan.targets[0]?.mergedText ?? ''

    expect(text).toContain('Global rule.')
    expect(text).not.toContain('NOT enforced by Kun')
  })

  it('preserves list-form globs from scoped Cursor frontmatter', async () => {
    await mkdir(join(workspace, '.cursor', 'rules'), { recursive: true })
    await writeFile(
      join(workspace, '.cursor', 'rules', 'web.mdc'),
      '---\nglobs:\n  - "**/*.ts"\n  - "**/*.tsx"\n---\nPrefer const.',
      'utf8'
    )

    const plan = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['cursor'] })
    const text = plan.targets[0]?.mergedText ?? ''

    expect(text).toContain('globs=**/*.ts, **/*.tsx')
    expect(text).toContain('NOT enforced by Kun')
  })

  it('marks alwaysApply false as a non-enforced condition', async () => {
    await mkdir(join(workspace, '.cursor', 'rules'), { recursive: true })
    await writeFile(join(workspace, '.cursor', 'rules', 'manual.mdc'), '---\nalwaysApply: false\n---\nManual rule.', 'utf8')

    const plan = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['cursor'] })

    expect(plan.targets[0]?.mergedText).toContain('alwaysApply=false')
    expect(plan.targets[0]?.mergedText).toContain('NOT enforced by Kun')
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

  it('blocks an @import that resolves outside the workspace and home', async () => {
    const outside = join(root, 'outside', 'secret.md')
    await mkdir(join(root, 'outside'), { recursive: true })
    await writeFile(outside, 'TOP SECRET', 'utf8')
    await writeFile(join(workspace, 'CLAUDE.md'), `Root.\n@${outside.replace(/\\/gu, '/')}`, 'utf8')

    const plan = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'] })

    expect(plan.warnings.some((w) => w.code === 'out-of-bounds-import')).toBe(true)
    expect(plan.targets[0]?.mergedText).not.toContain('TOP SECRET')
  })

  it('blocks a ../ traversal @import above the workspace', async () => {
    const outside = join(root, 'sibling-secret.md')
    await writeFile(outside, 'SIBLING SECRET', 'utf8')
    await writeFile(join(workspace, 'CLAUDE.md'), 'Root.\n@../sibling-secret.md', 'utf8')

    const plan = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'] })

    expect(plan.warnings.some((w) => w.code === 'out-of-bounds-import')).toBe(true)
    expect(plan.targets[0]?.mergedText).not.toContain('SIBLING SECRET')
  })

  it('allows an @import inside the home directory', async () => {
    await mkdir(join(home, 'shared'), { recursive: true })
    await writeFile(join(home, 'shared', 'rules.md'), 'Home shared rule.', 'utf8')
    await writeFile(join(workspace, 'CLAUDE.md'), `Root.\n@${join(home, 'shared', 'rules.md').replace(/\\/gu, '/')}`, 'utf8')

    const plan = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'] })

    expect(plan.targets[0]?.mergedText).toContain('Home shared rule.')
  })

  it('rethrows non-ENOENT errors when reading the target file', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'Root rule.', 'utf8')
    // Make the target a directory so reading it fails with EISDIR, not ENOENT.
    await mkdir(join(workspace, 'AGENTS.md'), { recursive: true })

    await expect(
      buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'] })
    ).rejects.toThrow()
  })

  it('appends a managed block on first import and is idempotent on re-import', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'Claude rule.', 'utf8')

    const first = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'] })
    expect(first.targets[0]?.changed).toBe(true)
    await applyImportPlan(first, { workspace })

    const second = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'] })
    expect(second.targets[0]?.changed).toBe(false)
  })

  it('writes a content hash in the begin marker and detects a hand-edited block', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'Original rule.', 'utf8')
    const first = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'] })
    await applyImportPlan(first, { workspace })

    const written = await readIfExists(join(workspace, 'AGENTS.md'))
    expect(written).toMatch(/<!-- kun:import:begin tool=claude-code sha=[0-9a-f]+ -->/u)
    expect(isManagedBlockModified(written, 'claude-code')).toBe(false)

    const tampered = written.replace('Original rule.', 'Hand-edited by user.')
    expect(isManagedBlockModified(tampered, 'claude-code')).toBe(true)
  })

  it('skips a hand-edited managed block on re-import and warns, unless forced', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'Rule v1.', 'utf8')
    await applyImportPlan(
      await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'] }),
      { workspace }
    )
    // User hand-edits inside the managed block, then the source changes.
    const target = join(workspace, 'AGENTS.md')
    const edited = (await readIfExists(target)).replace('Rule v1.', 'Rule v1 (user tweaked).')
    await writeFile(target, edited, 'utf8')
    await writeFile(join(workspace, 'CLAUDE.md'), 'Rule v2.', 'utf8')

    const guarded = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'] })
    expect(guarded.warnings.some((w) => w.code === 'block-modified')).toBe(true)
    expect(guarded.targets[0]?.changed).toBe(false)

    const forced = await buildImportPlan({ workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'], force: true })
    expect(forced.warnings.some((w) => w.code === 'block-modified')).toBe(false)
    expect(forced.targets[0]?.mergedText).toContain('Rule v2.')
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

  it('still imports an over-budget top-level file but warns it is oversized', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'A'.repeat(200), 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'], maxFileBytes: 64
    })

    const warning = plan.warnings.find((item) => item.code === 'oversized-source-imported')
    expect(warning).toBeDefined()
    expect(warning && describeWarning(warning)).toContain('Imported oversized source')
    expect(plan.targets[0]?.mergedText).toContain('A'.repeat(200))
  })

  it('skips a top-level source above the hard source ceiling', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'B'.repeat(2048), 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'],
      maxFileBytes: 64, maxSourceBytes: 1024
    })

    expect(plan.warnings.some((w) => w.code === 'oversized-import')).toBe(true)
    expect(plan.targets[0]?.changed).toBe(false)
  })

  it('does not allow maxSourceBytes to raise the independent hard ceiling', async () => {
    await writeFile(join(workspace, 'CLAUDE.md'), 'C'.repeat(MAX_IMPORT_SOURCE_BYTES + 1), 'utf8')

    const plan = await buildImportPlan({
      workspace, homeDir: home, adapters, scopes: ['workspace'], tools: ['claude-code'],
      maxSourceBytes: MAX_IMPORT_SOURCE_BYTES * 2
    })

    const warning = plan.warnings.find((item) => item.code === 'oversized-import')
    expect(warning).toBeDefined()
    expect(warning && describeWarning(warning)).toContain('Skipped oversized @import')
    expect(plan.targets[0]?.changed).toBe(false)
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
