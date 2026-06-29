import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  defaultClawSettings,
  defaultDesignSettings,
  defaultKeyboardShortcuts,
  defaultKunRuntimeSettings,
  defaultModelProviderSettings,
  defaultScheduleSettings,
  defaultWorkflowSettings,
  defaultWriteSettings,
  defaultTerminalSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import {
  guiSkillRootsForRuntime,
  isCodexPluginCacheRoot,
  listGuiSkillRoots,
  listGuiSkills
} from './skill-service'

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return {
    ...actual,
    homedir: () => process.env.KUN_SKILL_TEST_HOME || actual.homedir()
  }
})

describe('skill-service', () => {
  let tempRoot = ''

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'gui-skills-'))
    process.env.KUN_SKILL_TEST_HOME = tempRoot
  })

  afterEach(async () => {
    delete process.env.KUN_SKILL_TEST_HOME
    await rm(tempRoot, { recursive: true, force: true })
  })

  it('discovers project Codex skills from the active workspace', async () => {
    const workspaceRoot = join(tempRoot, 'workspace')
    const skillRoot = join(workspaceRoot, '.codex', 'skills', 'openspec-apply-change')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), [
      '---',
      'name: openspec-apply-change',
      'description: Implement tasks from an OpenSpec change.',
      '---',
      '',
      'Implement tasks from an OpenSpec change.'
    ].join('\n'), 'utf8')

    const result = await listGuiSkills(createSettings(workspaceRoot), workspaceRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skills).toContainEqual(expect.objectContaining({
      id: 'openspec-apply-change',
      name: 'Openspec Apply Change',
      description: 'Implement tasks from an OpenSpec change.',
      scope: 'project'
    }))
  })

  it('keeps legacy SKILL.md entries with Chinese frontmatter names distinct', async () => {
    const workspaceRoot = join(tempRoot, 'workspace-cn')
    const skillRoot = join(workspaceRoot, '.agents', 'skills')
    const tddRoot = join(skillRoot, 'tdd')
    const reviewRoot = join(skillRoot, 'code-review')
    await mkdir(tddRoot, { recursive: true })
    await mkdir(reviewRoot, { recursive: true })
    await writeFile(join(tddRoot, 'SKILL.md'), [
      '---',
      'name: 测试驱动开发(TDD)',
      'description: 用测试先行推进实现。',
      '---',
      '',
      '# TDD',
      '',
      '先写失败测试，再实现。'
    ].join('\n'), 'utf8')
    await writeFile(join(reviewRoot, 'SKILL.md'), [
      '---',
      'name: 代码审查',
      'description: 检查回归风险。',
      '---',
      '',
      '# Review',
      '',
      '关注正确性和测试。'
    ].join('\n'), 'utf8')

    const result = await listGuiSkills(createSettings(workspaceRoot), workspaceRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const projectSkills = result.skills.filter((skill) => skill.root.startsWith(skillRoot))
    expect(projectSkills).toHaveLength(2)
    expect(projectSkills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tdd',
        name: '测试驱动开发(TDD)',
        description: '用测试先行推进实现。'
      }),
      expect.objectContaining({
        id: 'code-review',
        name: '代码审查',
        description: '检查回归风险。'
      })
    ]))
    expect(projectSkills.map((skill) => skill.id)).not.toContain('skill')
  })

  it('detects workspace .claude/skills as a common directory and counts its skills', async () => {
    const workspaceRoot = join(tempRoot, 'ws-claude')
    const skillRoot = join(workspaceRoot, '.claude', 'skills', 'demo')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(join(skillRoot, 'SKILL.md'), [
      '---', 'name: demo', 'description: Demo skill.', '---', '', 'Body.'
    ].join('\n'), 'utf8')

    const result = await listGuiSkillRoots(createSettings(workspaceRoot), workspaceRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const claude = result.roots.find((root) => root.labelKey === 'pluginSkillRootWorkspaceClaude')
    expect(claude).toMatchObject({
      scope: 'project',
      source: 'common',
      exists: true,
      enabled: true,
      skillCount: 1
    })
    expect(comparable(claude?.path ?? '')).toBe(comparable(join(workspaceRoot, '.claude', 'skills')))
  })

  it('discovers and counts skills symlinked into .claude/skills (e.g. cc switch)', async (ctx) => {
    const workspaceRoot = join(tempRoot, 'ws-symlink')
    // cc switch stores the real skill files in its own config dir...
    const realSkill = join(tempRoot, 'cc-config', 'skills', 'linked-skill')
    await mkdir(realSkill, { recursive: true })
    await writeFile(join(realSkill, 'SKILL.md'), [
      '---', 'name: linked-skill', 'description: Linked via symlink.', '---', '', 'Body.'
    ].join('\n'), 'utf8')
    // ...and symlinks the per-skill directory into .claude/skills.
    const claudeSkills = join(workspaceRoot, '.claude', 'skills')
    await mkdir(claudeSkills, { recursive: true })
    try {
      await symlink(realSkill, join(claudeSkills, 'linked-skill'), 'dir')
    } catch {
      // Symlink creation can be unprivileged (e.g. Windows) — skip there.
      ctx.skip()
      return
    }

    const settings = createSettings(workspaceRoot)
    const result = await listGuiSkills(settings, workspaceRoot)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skills).toContainEqual(expect.objectContaining({
      id: 'linked-skill',
      name: 'Linked Skill',
      description: 'Linked via symlink.',
      scope: 'project'
    }))

    const roots = await listGuiSkillRoots(settings, workspaceRoot)
    expect(roots.ok).toBe(true)
    if (!roots.ok) return
    const claude = roots.roots.find((root) => root.labelKey === 'pluginSkillRootWorkspaceClaude')
    expect(claude?.skillCount).toBe(1)
  })

  it('omits a directory disabled via disabledDirs from runtime roots but still lists it', async () => {
    const workspaceRoot = join(tempRoot, 'ws-toggle')
    const claudeSkill = join(workspaceRoot, '.claude', 'skills', 'demo')
    const agentsSkill = join(workspaceRoot, '.agents', 'skills', 'demo2')
    await mkdir(claudeSkill, { recursive: true })
    await mkdir(agentsSkill, { recursive: true })
    await writeFile(join(claudeSkill, 'SKILL.md'), ['---', 'name: demo', '---', '', 'Body.'].join('\n'), 'utf8')
    await writeFile(join(agentsSkill, 'SKILL.md'), ['---', 'name: demo2', '---', '', 'Body.'].join('\n'), 'utf8')

    const settings = createSettings(workspaceRoot)
    settings.claw.skills.disabledDirs = ['workspace-claude']

    const runtimeRoots = (await guiSkillRootsForRuntime(settings, workspaceRoot)).map((root) =>
      comparable(root.path)
    )
    expect(runtimeRoots).not.toContain(comparable(join(workspaceRoot, '.claude', 'skills')))
    expect(runtimeRoots).toContain(comparable(join(workspaceRoot, '.agents', 'skills')))

    const list = await listGuiSkillRoots(settings, workspaceRoot)
    expect(list.ok).toBe(true)
    if (!list.ok) return
    const claude = list.roots.find((root) => root.labelKey === 'pluginSkillRootWorkspaceClaude')
    expect(claude?.enabled).toBe(false)
  })

  it('omits discovered Codex plugin roots disabled by path', async () => {
    const workspaceRoot = join(tempRoot, 'ws-plugin-toggle')
    const pluginRoot = join(tempRoot, '.codex', 'plugins', 'cache', 'github', '1.0', 'skills')
    await mkdir(join(pluginRoot, 'review'), { recursive: true })
    await writeFile(join(pluginRoot, 'review', 'SKILL.md'), ['---', 'name: review', '---'].join('\n'), 'utf8')

    const settings = createSettings(workspaceRoot)
    expect((await guiSkillRootsForRuntime(settings, workspaceRoot)).map((root) => comparable(root.path)))
      .toContain(comparable(pluginRoot))

    settings.claw.skills.disabledDirs = [pluginRoot]
    expect((await guiSkillRootsForRuntime(settings, workspaceRoot)).map((root) => comparable(root.path)))
      .not.toContain(comparable(pluginRoot))
  })

  it('stops scanning Codex plugin caches when global-codex is disabled', async () => {
    const workspaceRoot = join(tempRoot, 'ws-plugin-global')
    const pluginRoot = join(tempRoot, '.codex', 'plugins', 'cache', 'gmail', '1.0', 'skills')
    await mkdir(join(pluginRoot, 'gmail'), { recursive: true })
    await writeFile(join(pluginRoot, 'gmail', 'SKILL.md'), ['---', 'name: gmail', '---'].join('\n'), 'utf8')

    const settings = createSettings(workspaceRoot)
    // Plugin caches are on by default...
    expect((await guiSkillRootsForRuntime(settings, workspaceRoot)).map((root) => comparable(root.path)))
      .toContain(comparable(pluginRoot))

    // ...and disabling the Codex global root toggle takes them all down with it.
    settings.claw.skills.disabledDirs = ['global-codex']
    expect((await guiSkillRootsForRuntime(settings, workspaceRoot)).map((root) => comparable(root.path)))
      .not.toContain(comparable(pluginRoot))
  })

  it('recognizes roots under ~/.codex/plugins/cache as Codex plugin caches', () => {
    expect(isCodexPluginCacheRoot(join(tempRoot, '.codex', 'plugins', 'cache', 'vercel', '2.1', 'skills'))).toBe(true)
    expect(isCodexPluginCacheRoot(join(tempRoot, '.codex', 'skills'))).toBe(false)
    expect(isCodexPluginCacheRoot(join(tempRoot, '.kun', 'skills'))).toBe(false)
  })

  it('rejects a skill.json whose entry escapes the package directory (path traversal)', async () => {
    const workspaceRoot = join(tempRoot, 'ws-traversal')
    const skillRoot = join(workspaceRoot, '.claude', 'skills', 'evil')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(
      join(skillRoot, 'skill.json'),
      JSON.stringify({ id: 'evil', name: 'Evil', entry: '../../../../etc/passwd' }),
      'utf8'
    )

    const result = await listGuiSkills(createSettings(workspaceRoot), workspaceRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The crafted skill is skipped, not surfaced.
    expect(result.skills.some((skill) => skill.id === 'evil')).toBe(false)
    // ...and the violation is recorded as a validation error against its root.
    expect(result.validationErrors.some((error) => comparable(error.root) === comparable(skillRoot))).toBe(true)
  })

  it('imports a skill.json with a plain entry filename', async () => {
    const workspaceRoot = join(tempRoot, 'ws-entry-ok')
    const skillRoot = join(workspaceRoot, '.claude', 'skills', 'reader')
    await mkdir(skillRoot, { recursive: true })
    await writeFile(
      join(skillRoot, 'skill.json'),
      JSON.stringify({ id: 'reader', name: 'Reader', entry: 'GUIDE.md' }),
      'utf8'
    )
    await writeFile(join(skillRoot, 'GUIDE.md'), '# Reader', 'utf8')

    const result = await listGuiSkills(createSettings(workspaceRoot), workspaceRoot)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.skills).toContainEqual(expect.objectContaining({
      id: 'reader',
      name: 'Reader',
      entryPath: join(skillRoot, 'GUIDE.md')
    }))
  })

  function comparable(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase()
  }

  function createSettings(workspaceRoot: string): AppSettingsV1 {
    return {
      version: 1,
      locale: 'en',
      theme: 'system',
      uiFontScale: 0.82,
    chatContentMaxWidthPx: 896,
      provider: defaultModelProviderSettings(),
      agents: { kun: defaultKunRuntimeSettings() },
      workspaceRoot,
      conversationWorkspaceRoot: '~/Documents/Kun',
      log: { enabled: false, retentionDays: 7 },
      checkpointCleanup: { enabled: false, intervalDays: 3 },
      notifications: { turnComplete: true },
      appBehavior: { openAtLogin: false, startMinimized: false, closeToTray: false },
      keyboardShortcuts: defaultKeyboardShortcuts(),
      write: defaultWriteSettings(),
      claw: defaultClawSettings(),
      schedule: defaultScheduleSettings(),
      workflow: defaultWorkflowSettings(),
      design: defaultDesignSettings(),
      terminal: defaultTerminalSettings(),
      guiUpdate: { channel: 'stable' },
      codePromptPrefix: '',
      disabledSkillIds: []
    }
  }
})
