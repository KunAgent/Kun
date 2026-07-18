import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  KUN_PROJECT_CONFIG_RELATIVE_PATH,
  KunProjectConfigSchema,
  MAX_KUN_PROJECT_CONFIG_BYTES,
  MAX_KUN_PROJECT_MCP_SERVERS,
  MAX_KUN_PROJECT_SKILL_ROOTS,
  loadKunProjectConfig,
  validateKunProjectConfigText,
  writeKunProjectConfig
} from './project-config.js'

describe('Kun project config', () => {
  let workspace = ''

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'kun-project-config-'))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('reports missing without inheriting a parent project file', async () => {
    const child = join(workspace, 'child')
    await mkdir(join(workspace, '.kun'), { recursive: true })
    await mkdir(child)
    await writeFile(join(workspace, KUN_PROJECT_CONFIG_RELATIVE_PATH), JSON.stringify({ version: 1 }))
    const realChild = await realpath(child)

    await expect(loadKunProjectConfig(child)).resolves.toMatchObject({
      status: 'missing',
      workspaceRoot: realChild
    })
  })

  it('normalizes valid config and gives formatting-equivalent JSON the same digest', async () => {
    await mkdir(join(workspace, 'skills'))
    await mkdir(join(workspace, 'api'))
    const compact = JSON.stringify({
      version: 1,
      skills: { roots: ['skills'], disabledIds: ['unsafe'] },
      mcp: {
        servers: {
          api: { transport: 'stdio', command: 'node', args: ['server.js'], cwd: 'api' }
        }
      }
    })
    const reordered = JSON.stringify({
      mcp: {
        servers: {
          api: { cwd: 'api', args: ['server.js'], command: 'node', transport: 'stdio' }
        }
      },
      skills: { disabledIds: ['unsafe'], roots: ['skills'] },
      version: 1
    }, null, 2)

    const first = await validateKunProjectConfigText(workspace, compact)
    const second = await validateKunProjectConfigText(workspace, reordered)
    const realWorkspace = await realpath(workspace)

    expect(first.digest).toBe(second.digest)
    expect(first.skills.roots).toEqual([join(realWorkspace, 'skills')])
    expect(first.mcp.servers.api?.cwd).toBe(join(realWorkspace, 'api'))
  })

  it.each([
    ['malformed JSON', '{', /must be JSON/],
    ['unsupported version', JSON.stringify({ version: 2 }), /unsupported project config version/],
    ['unknown field', JSON.stringify({ version: 1, surprise: true }), /unrecognized key/i],
    ['repository trust field', JSON.stringify({
      version: 1,
      mcp: { servers: { bad: { transport: 'stdio', command: 'node', trustScope: 'user' } } }
    }), /unrecognized key/i]
  ])('rejects %s', async (_label, content, expected) => {
    await expect(validateKunProjectConfigText(workspace, content)).rejects.toThrow(expected as RegExp)
  })

  it('rejects oversized content', async () => {
    await expect(validateKunProjectConfigText(
      workspace,
      `${JSON.stringify({ version: 1, $schema: '' }).slice(0, -2)}${'x'.repeat(MAX_KUN_PROJECT_CONFIG_BYTES)}}`
    )).rejects.toThrow(/exceeds/)
  })

  it('rejects oversized MCP and Skill collections', async () => {
    const servers = Object.fromEntries(Array.from(
      { length: MAX_KUN_PROJECT_MCP_SERVERS + 1 },
      (_, index) => [`server-${index}`, { transport: 'stdio', command: 'node' }]
    ))
    await expect(validateKunProjectConfigText(workspace, JSON.stringify({
      version: 1,
      mcp: { servers }
    }))).rejects.toThrow(/at most/)

    const roots = Array.from(
      { length: MAX_KUN_PROJECT_SKILL_ROOTS + 1 },
      (_, index) => `skills-${index}`
    )
    await expect(validateKunProjectConfigText(workspace, JSON.stringify({
      version: 1,
      skills: { roots }
    }))).rejects.toThrow(/too_big|too big|array/i)
  })

  it('rejects lexical and absolute path escapes', async () => {
    await expect(validateKunProjectConfigText(workspace, JSON.stringify({
      version: 1,
      skills: { roots: ['../outside'] }
    }))).rejects.toThrow(/escapes the workspace/)
    await expect(validateKunProjectConfigText(workspace, JSON.stringify({
      version: 1,
      mcp: { servers: { bad: { transport: 'stdio', command: 'node', cwd: workspace } } }
    }))).rejects.toThrow(/relative to the workspace/)
  })

  it('rejects a project path symlinked outside the workspace', async (ctx) => {
    const outside = await mkdtemp(join(tmpdir(), 'kun-project-outside-'))
    try {
      try {
        await symlink(outside, join(workspace, 'linked'), 'dir')
      } catch {
        ctx.skip()
        return
      }
      await expect(validateKunProjectConfigText(workspace, JSON.stringify({
        version: 1,
        skills: { roots: ['linked'] }
      }))).rejects.toThrow(/resolves outside the workspace/)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('writes atomically without following a project.json symlink', async (ctx) => {
    const outside = join(workspace, 'outside.json')
    await mkdir(join(workspace, '.kun'))
    await writeFile(outside, 'outside')
    try {
      await symlink(outside, join(workspace, KUN_PROJECT_CONFIG_RELATIVE_PATH))
    } catch {
      ctx.skip()
      return
    }

    await expect(writeKunProjectConfig(workspace, JSON.stringify({ version: 1 })))
      .rejects.toThrow(/symbolic link/)
    await expect(readFile(outside, 'utf8')).resolves.toBe('outside')
  })

  it('round-trips a safely written config', async () => {
    const written = await writeKunProjectConfig(workspace, JSON.stringify({ version: 1 }, null, 2))
    expect(written.path).toBe(join(await realpath(workspace), KUN_PROJECT_CONFIG_RELATIVE_PATH))
    await expect(loadKunProjectConfig(workspace)).resolves.toMatchObject({
      status: 'valid',
      digest: written.digest
    })
  })

  it('leaves the previous file unchanged when an edit is invalid', async () => {
    const original = JSON.stringify({ version: 1 }, null, 2)
    const written = await writeKunProjectConfig(workspace, original)

    await expect(writeKunProjectConfig(workspace, '{')).rejects.toThrow(/must be JSON/)
    await expect(readFile(written.path, 'utf8')).resolves.toBe(original)
  })

  it('keeps the documented project config example schema-valid', async () => {
    const example = JSON.parse(await readFile(
      resolve(process.cwd(), '..', 'docs', 'examples', 'kun-project.json'),
      'utf8'
    )) as unknown

    expect(KunProjectConfigSchema.safeParse(example).success).toBe(true)
  })
})
