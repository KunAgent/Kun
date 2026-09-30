import { mkdtemp, rm, readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanupHookConfig, writeHookConfig } from './hook-config-writer.js'

const dirs: string[] = []

afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true })
})

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

const CLAUDE_HOOKS = { kind: 'claude-settings', events: ['Stop', 'PostToolUse', 'SessionEnd'] }

describe('hook-config-writer', () => {
  it('writes a per-launch settings file under dataDir and returns launch extras', async () => {
    const dataDir = await tempDir('kun-hooks-data-')
    const home = await tempDir('kun-hooks-home-')
    // The writer must never touch the user's global agent config — seed a
    // sentinel file under the fake HOME and assert it survives untouched.
    await mkdir(join(home, '.claude'), { recursive: true })
    await writeFile(join(home, '.claude', 'settings.json'), '{"user":true}\n')

    const extras = await writeHookConfig(dataDir, 'tu_1', CLAUDE_HOOKS, '"kun" "entry.js"')
    expect(extras).toBeTruthy()
    expect(extras!.dir).toBe(join(dataDir, 'ade', 'hooks', 'tu_1'))
    expect(extras!.env.KUN_HOOK_DIR).toBe(extras!.dir)
    expect(extras!.args).toEqual(['--settings', join(extras!.dir, 'settings.json')])

    const settings = JSON.parse(await readFile(extras!.args[1]!, 'utf8')) as {
      hooks: Record<string, { matcher: string; hooks: { type: string; command: string }[] }[]>
    }
    expect(Object.keys(settings.hooks).sort()).toEqual(['PostToolUse', 'SessionEnd', 'Stop'])
    for (const event of CLAUDE_HOOKS.events) {
      expect(settings.hooks[event]).toEqual([{
        matcher: '*',
        hooks: [{ type: 'command', command: `"kun" "entry.js" worker hook ${event}` }]
      }])
    }
    // HOME untouched: no ~/.claude writes, sentinel intact.
    expect(await readFile(join(home, '.claude', 'settings.json'), 'utf8')).toBe('{"user":true}\n')
    expect(await readdir(home)).toEqual(['.claude'])
  })

  it('returns null for unsupported or empty hook definitions', async () => {
    const dataDir = await tempDir('kun-hooks-data-')
    expect(await writeHookConfig(dataDir, 'tu_2', { kind: 'none', events: [] }, 'kun')).toBeNull()
    expect(await writeHookConfig(dataDir, 'tu_3', { kind: 'other-kind', events: ['Stop'] }, 'kun'))
      .toBeNull()
    expect(existsSync(join(dataDir, 'ade'))).toBe(false)
  })

  it('cleanup removes the unit directory only', async () => {
    const dataDir = await tempDir('kun-hooks-data-')
    await writeHookConfig(dataDir, 'tu_1', CLAUDE_HOOKS, 'kun')
    await writeHookConfig(dataDir, 'tu_2', CLAUDE_HOOKS, 'kun')
    await cleanupHookConfig(dataDir, 'tu_1')
    expect(existsSync(join(dataDir, 'ade', 'hooks', 'tu_1'))).toBe(false)
    expect(existsSync(join(dataDir, 'ade', 'hooks', 'tu_2'))).toBe(true)
    // Missing units are fine (idempotent on repeated exits).
    await cleanupHookConfig(dataDir, 'tu_1')
  })

  it('sanitizes unit ids inside the config path', async () => {
    const dataDir = await tempDir('kun-hooks-data-')
    const extras = await writeHookConfig(dataDir, '../escape/../x', CLAUDE_HOOKS, 'kun')
    expect(extras!.dir.startsWith(join(dataDir, 'ade', 'hooks'))).toBe(true)
    expect(extras!.dir).not.toContain('..')
  })
})
