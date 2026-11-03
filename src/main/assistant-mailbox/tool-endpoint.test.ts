import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildAssistantKunMcpServer } from './mcp-config'
import { callAssistantEndpoint, parseAssistantMcpLaunch } from './mcp-server'
import { AssistantToolEndpoint, assistantToolEndpointPaths } from './tool-endpoint'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!()
})

describe.skipIf(process.platform === 'win32')('assistant tool endpoint', () => {
  it('serves allowlisted routes to callers holding the current secret', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kun-am-'))
    cleanup.push(() => rm(dir, { recursive: true, force: true }))
    const paths = assistantToolEndpointPaths(dir)
    const calls: Array<[string, unknown]> = []
    const endpoint = new AssistantToolEndpoint(paths, new Set(['/assistants', '/fail']), async (route, body) => {
      calls.push([route, body])
      if (route === '/fail') throw new Error('No connected assistant matches "x".')
      return { assistants: [] }
    })
    await endpoint.start()
    cleanup.push(() => endpoint.stop())
    expect((await stat(paths.socketPath)).mode & 0o777).toBe(0o600)
    expect((await stat(paths.secretPath)).mode & 0o777).toBe(0o600)

    expect(await callAssistantEndpoint(paths, '/assistants', { a: 1 })).toEqual({ assistants: [] })
    await expect(callAssistantEndpoint(paths, '/fail', {})).rejects.toThrow('No connected assistant matches')
    await expect(callAssistantEndpoint(paths, '/other', {})).rejects.toThrow('NOT_FOUND')
    await writeFile(paths.secretPath, 'f'.repeat(64))
    await expect(callAssistantEndpoint(paths, '/assistants', {})).rejects.toThrow('UNAUTHORIZED')
    expect(calls).toEqual([['/assistants', { a: 1 }], ['/fail', {}]])

    await endpoint.stop()
    await expect(callAssistantEndpoint(paths, '/assistants', {})).rejects.toThrow('Cannot reach Kun')
  })
})

describe('assistant MCP wiring', () => {
  it('keeps socket paths short and stable, and launches the bridge with them', () => {
    const long = assistantToolEndpointPaths(`/Users/${'x'.repeat(120)}/Library/Application Support/Kun`, 'darwin')
    expect(Buffer.byteLength(long.socketPath)).toBeLessThanOrEqual(100)
    expect(assistantToolEndpointPaths('/data', 'darwin')).toEqual({ socketPath: '/data/assistant-mailbox/tools.sock', secretPath: '/data/assistant-mailbox/tools.secret' })
    expect(assistantToolEndpointPaths('C:\\Kun', 'win32').socketPath).toMatch(/^\\\\\.\\pipe\\kun-assistant-mailbox-[0-9a-f]{16}$/)

    const server = buildAssistantKunMcpServer({ appPath: '/app', execPath: '/app/kun', isPackaged: true, userDataDir: '/data' })
    expect(server).toMatchObject({ transport: 'stdio', env: { ELECTRON_RUN_AS_NODE: '1' }, trustScope: 'user' })
    const args = server.args as string[]
    expect(args[0]).toBe('/app/out/main/assistant-mcp-node-entry.js')
    expect(parseAssistantMcpLaunch(args)).toEqual({ socketPath: '/data/assistant-mailbox/tools.sock', secretPath: '/data/assistant-mailbox/tools.secret' })
    expect(parseAssistantMcpLaunch(['--kun-assistant-mcp-server'])).toBeNull()
  })
})
