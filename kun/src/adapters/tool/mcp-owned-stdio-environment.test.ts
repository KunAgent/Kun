import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { getDefaultEnvironment } from '@modelcontextprotocol/client/stdio'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnOwnedProcess } from '../../process/owned-process.js'
import { resolveWindowsExecutablePath } from '../../process/owned-process-windows.js'
import { OwnedStdioClientTransport } from './mcp-owned-stdio.js'
import { buildMcpStdioEnvironment } from './mcp-stdio-environment.js'

// Only replace native process creation. Run the real builder, SDK inherited
// environment, transport merge, filesystem and Windows executable resolver.
vi.mock('../../process/owned-process.js', () => ({
  spawnOwnedProcess: vi.fn(), stopOwnedProcess: vi.fn(async () => undefined)
}))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
let directory: string
let inherited: string
let configured: string
let finalEnv: NodeJS.ProcessEnv
let executable: string
let resolveCommand: boolean
let transport: OwnedStdioClientTransport | undefined

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'kun-mcp-environment-'))
  inherited = join(directory, 'parent-without-npx')
  configured = join(directory, 'configured-tools')
  await mkdir(inherited)
  await mkdir(configured)
  await writeFile(join(configured, 'npx'), '#!/bin/sh\nexit 1\n')
  await writeFile(join(configured, 'npx.ps1'), 'exit 1\n')
  await writeFile(join(configured, 'npx.cmd'), '@exit /b 0\n')
  vi.stubEnv('PATH', inherited)
  resolveCommand = true
  finalEnv = {}
  executable = ''
  vi.mocked(spawnOwnedProcess).mockImplementation(async (command, _args, options = {}) => {
    finalEnv = options.env ?? {}
    if (resolveCommand) executable = await resolveWindowsExecutablePath(command, options)
    return Object.assign(new EventEmitter(), { pid: 4242, stdin: new PassThrough(),
      stdout: new PassThrough(), stderr: new PassThrough() }) as unknown as ChildProcess
  })
})

afterEach(async () => {
  await transport?.close()
  transport = undefined
  Object.defineProperty(process, 'platform', platform)
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  await rm(directory, { recursive: true, force: true })
})

function assertNoWindowsAliases(env: NodeJS.ProcessEnv) {
  const keys = Object.keys(env).map(key => key.toLowerCase())
  expect(new Set(keys).size).toBe(keys.length)
}

describe('MCP environment construction through owned transport and resolver', () => {
  it.each([['PATH', 'Path'], ['Path', 'PATH']])('resolves configured %s over inherited %s to npx.cmd', async (configuredKey, inheritedKey) => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    // SDK whitelist returns uppercase PATH, even when user configuration uses
    // Path. The inherited directory deliberately has none of the shim files.
    expect(getDefaultEnvironment().PATH).toBe(inherited)
    const env = buildMcpStdioEnvironment({ [configuredKey]: configured, PathExt: '.CMD',
      TOKEN: 'first', Token: 'configured' }, { platform: 'win32', baseEnv: { [inheritedKey]: inherited } })
    transport = new OwnedStdioClientTransport({ command: 'npx', env, stderr: 'pipe' })
    await transport.start()
    expect(executable).toBe(join(configured, 'npx.cmd'))
    expect(finalEnv[configuredKey]).toBe(configured)
    expect(finalEnv.PathExt).toBe('.CMD')
    expect(finalEnv.Token).toBe('configured')
    assertNoWindowsAliases(finalEnv)
    expect(Object.keys(finalEnv).filter(key => key.toLowerCase() === 'path')).toEqual([configuredKey])
  })

  it.each([['PATH', 'Path'], ['Path', 'PATH']])('does not lose GUI npm augmentation with base %s and configured %s', async (inheritedKey, configuredKey) => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    // Windows-form common directories are checked as environment values here;
    // the cross-platform resolver tests above use real host filesystem paths.
    resolveCommand = false
    const env = buildMcpStdioEnvironment({ [configuredKey]: 'C:\\Tools' }, {
      platform: 'win32', baseEnv: { [inheritedKey]: 'C:\\Windows', APPDATA: 'C:\\AppData' }
    })
    transport = new OwnedStdioClientTransport({ command: 'npx', env, stderr: 'pipe' })
    await transport.start()
    expect(finalEnv[configuredKey]).toBe('C:\\Tools;C:\\AppData\\npm')
    assertNoWindowsAliases(finalEnv)
  })

  it('does not let SDK defaults revive an explicitly unset PATH', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const env = buildMcpStdioEnvironment({ Path: undefined, PathExt: undefined, Token: undefined }, {
      platform: 'win32', baseEnv: { PATH: inherited, APPDATA: 'C:\\AppData' }
    })
    transport = new OwnedStdioClientTransport({ command: 'npx', env, stderr: 'pipe' })
    await expect(transport.start()).rejects.toMatchObject({ code: 'ENOENT' })
    expect(finalEnv).toMatchObject({ Path: undefined, PathExt: undefined, Token: undefined })
    expect(Object.hasOwn(finalEnv, 'PATH')).toBe(false)
    assertNoWindowsAliases(finalEnv)
  })

  it.each(['linux', 'darwin'] as const)('preserves distinct PATH/Path through the transport on %s', async os => {
    Object.defineProperty(process, 'platform', { value: os })
    resolveCommand = false
    const env = buildMcpStdioEnvironment({ Path: configured }, { platform: os, baseEnv: { PATH: inherited } })
    transport = new OwnedStdioClientTransport({ command: 'npx', env, stderr: 'pipe' })
    await transport.start()
    expect(finalEnv.Path).toBe(configured)
    expect(finalEnv.PATH?.split(':')[0]).toBe(inherited)
  })
})
