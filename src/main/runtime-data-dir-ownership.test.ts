import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RUNTIME_DATA_DIR_OWNER_FILE } from '../../kun/src/server/runtime-data-dir-lease.js'
import {
  WINDOWS_PROCESS_COMMAND_SCRIPT,
  WINDOWS_PROCESS_COMMAND_TIMEOUT_MS,
  activeKunRuntimePidsForDataDir,
  commandUsesKunDataDir,
  windowsProcessCommands
} from './runtime-data-dir-ownership'

const tempRoots: string[] = []

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) await rm(root, { recursive: true, force: true })
  }
})

describe('Runtime data directory ownership detection', () => {
  it('filters the production Windows inventory while preserving shell-hosted Kun commands', () => {
    const dataDir = 'C:\\Users\\Zoe\\.deepseekgui\\kun'
    const run = vi.fn(() => JSON.stringify([
      {
        ProcessId: 4_242,
        CommandLine: `cmd.exe /d /s /c kun serve --data-dir ${dataDir}`
      },
      {
        ProcessId: 4_243,
        CommandLine: 'node C:\\tools\\dev-server.js'
      }
    ]))

    const commands = windowsProcessCommands(run)

    expect(activeKunRuntimePidsForDataDir(dataDir, {
      platform: 'win32',
      processCommands: () => commands
    })).toEqual([4_242])
    expect(WINDOWS_PROCESS_COMMAND_SCRIPT).toContain(
      `-Filter "CommandLine LIKE '%serve%'"`
    )
    expect(WINDOWS_PROCESS_COMMAND_SCRIPT).not.toContain(
      'Get-CimInstance Win32_Process |'
    )
    expect(run).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_PROCESS_COMMAND_SCRIPT],
      {
        encoding: 'utf8',
        windowsHide: true,
        timeout: WINDOWS_PROCESS_COMMAND_TIMEOUT_MS,
        maxBuffer: 32 * 1024 * 1024
      }
    )
    expect(WINDOWS_PROCESS_COMMAND_TIMEOUT_MS).toBe(300_000)
  })

  it('fails closed when the production Windows inventory times out', () => {
    const timeout = Object.assign(
      new Error('spawnSync powershell.exe ETIMEDOUT'),
      { code: 'ETIMEDOUT' }
    )
    const run = vi.fn(() => {
      throw timeout
    })

    expect(() => activeKunRuntimePidsForDataDir('C:\\Users\\Zoe\\.kun\\data', {
      platform: 'win32',
      processCommands: () => windowsProcessCommands(run)
    })).toThrow(/ETIMEDOUT/)
  })

  it('fails closed when the production Windows inventory is malformed', () => {
    expect(() => windowsProcessCommands(() => '{broken')).toThrow(SyntaxError)
  })

  it('recognizes managed and standalone Kun serve commands using the legacy directory', () => {
    expect(commandUsesKunDataDir(
      '/Applications/Kun.app/Contents/MacOS/Kun /app/serve-entry.js serve --data-dir /Users/zoe/.deepseekgui/kun',
      '/Users/zoe/.deepseekgui/kun',
      'darwin'
    )).toBe(true)
    expect(commandUsesKunDataDir(
      'kun serve --data-dir C:\\Users\\Zoë\\.DEEPSEEKGUI\\KUN',
      'c:\\users\\zoë\\.deepseekgui\\kun',
      'win32'
    )).toBe(true)
    expect(commandUsesKunDataDir(
      'node "/opt/custom runtime.js" --data-dir="/Users/zoe/Library Data/.deepseekgui/kun"',
      '/Users/zoe/Library Data/.deepseekgui/kun',
      'darwin'
    )).toBe(true)
    expect(commandUsesKunDataDir(
      'node unrelated.js /Users/zoe/.deepseekgui/kun',
      '/Users/zoe/.deepseekgui/kun',
      'darwin'
    )).toBe(false)
    expect(commandUsesKunDataDir(
      'kun serve --data-dir /Users/zoe/.deepseekgui/kun-other',
      '/Users/zoe/.deepseekgui/kun',
      'darwin'
    )).toBe(false)
    expect(commandUsesKunDataDir(
      'kun serve --dataDir /Users/zoe/.deepseekgui/kun/',
      '/Users/zoe/.deepseekgui/kun',
      'darwin'
    )).toBe(true)
    expect(commandUsesKunDataDir(
      'KUN_DATA_DIR=/Users/zoe/.deepseekgui/kun kun serve',
      '/Users/zoe/.deepseekgui/kun',
      'darwin'
    )).toBe(true)
    expect(commandUsesKunDataDir(
      'kun serve --data-dir ../.deepseekgui/kun',
      '/home/zoe/.deepseekgui/kun',
      'linux',
      { cwd: '/home/zoe/workspace' }
    )).toBe(true)
  })

  it('recognizes environment and explicit config data-directory sources', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-owner-'))
    tempRoots.push(root)
    const legacy = join(root, '.deepseekgui', 'kun')
    const configPath = join(root, 'kun-config.json')
    await mkdir(legacy, { recursive: true })
    await writeFile(configPath, JSON.stringify({ serve: { dataDir: legacy } }), 'utf8')

    expect(commandUsesKunDataDir(
      'kun serve',
      legacy,
      process.platform,
      { environment: { KUN_DATA_DIR: legacy } }
    )).toBe(true)
    expect(commandUsesKunDataDir(
      `kun serve --config "${configPath}"`,
      legacy,
      process.platform
    )).toBe(true)

    await writeFile(configPath, '{broken', 'utf8')
    expect(() => commandUsesKunDataDir(
      `kun serve --config "${configPath}"`,
      legacy,
      process.platform
    )).toThrow(/could not inspect Kun Runtime config/)
  })

  it('returns only other Kun Runtime processes using the selected directory', () => {
    const ownPid = process.pid
    const otherPid = ownPid + 1
    expect(activeKunRuntimePidsForDataDir('/home/zoe/.deepseekgui/kun', {
      platform: 'linux',
      processCommands: () => [
        {
          pid: ownPid,
          command: 'kun serve --data-dir /home/zoe/.deepseekgui/kun'
        },
        {
          pid: otherPid,
          command: 'node /opt/kun/serve-entry.js serve --data-dir /home/zoe/.deepseekgui/kun'
        },
        {
          pid: 4343,
          command: 'kun serve --data-dir /home/other/.kun/data'
        }
      ]
    })).toEqual([otherPid])
  })

  it('detects a live Runtime lease even when its environment is not visible', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-runtime-owner-'))
    tempRoots.push(dataDir)
    await writeFile(
      join(dataDir, RUNTIME_DATA_DIR_OWNER_FILE),
      JSON.stringify({
        schemaVersion: 1,
        pid: 5151,
        token: 'runtime-token',
        startedAt: '2026-07-26T00:00:00.000Z'
      }),
      'utf8'
    )

    expect(activeKunRuntimePidsForDataDir(dataDir, {
      platform: process.platform,
      processCommands: () => [],
      processIsAlive: (pid) => pid === 5151
    })).toEqual([5151])
  })

  it('fails closed when process ownership cannot be inventoried', () => {
    expect(() => activeKunRuntimePidsForDataDir('/home/zoe/.deepseekgui/kun', {
      platform: 'linux',
      processCommands: () => {
        throw new Error('process inventory denied')
      }
    })).toThrow(/process inventory denied/)
  })
})
