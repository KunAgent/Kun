import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveKunRuntimeSettings, type AppSettingsV1 } from '../../shared/app-settings'
import { syncGuiManagedKunConfig } from '../runtime/kun-runtime-config-service'
import { JsonSettingsStore } from '../settings-store'
import { buildCanvasKunMcpServer, CANVAS_MCP_SERVER_ID } from './canvas-mcp-config'

const launch = { appPath: '/Applications/Kun.app/Contents/Resources/app.asar', execPath: process.execPath, isPackaged: true }

function withDataDir(settings: AppSettingsV1, dataDir: string): AppSettingsV1 {
  const kun = settings.agents.kun
  return {
    ...settings,
    agents: { ...settings.agents, kun: { ...kun, dataDir } }
  } as AppSettingsV1
}

describe('canvas MCP App config', () => {
  it('launches the packaged node entry with boards in the Kun data dir', () => {
    const server = buildCanvasKunMcpServer(launch, '/data/kun')
    expect(server).toMatchObject({ transport: 'stdio', trustScope: 'user', env: { ELECTRON_RUN_AS_NODE: '1' } })
    expect(server.args).toEqual([
      '/Applications/Kun.app/Contents/Resources/app.asar/out/main/canvas-mcp-node-entry.js',
      '--kun-canvas-mcp-server',
      '--data-dir', '/data/kun/canvas-boards',
      '--app-dir', '/Applications/Kun.app/Contents/Resources/app.asar/out/canvas-app',
      '--fonts-dir', '/Applications/Kun.app/Contents/Resources/app.asar/out/renderer/excalidraw/fonts'
    ])
  })

  it('always registers the managed server without a Lab switch', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-canvas-config-'))
    const dataDir = join(userDataDir, 'runtime-data')
    const defaults = await new JsonSettingsStore(userDataDir).load()
    const settings = withDataDir(defaults, dataDir)
    await syncGuiManagedKunConfig(dataDir, resolveKunRuntimeSettings(settings), {
      scheduleMcp: { settings, launch: { appPath: userDataDir, execPath: process.execPath, isPackaged: false } },
      mcpConfigPath: join(userDataDir, 'missing-mcp.json')
    })
    const config = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8')) as {
      capabilities: { mcp: { servers: Record<string, unknown> } }
      lab?: Record<string, unknown>
    }
    expect(config.capabilities.mcp.servers[CANVAS_MCP_SERVER_ID]).toMatchObject({ trustScope: 'user' })
    expect(config.lab).not.toHaveProperty('mcpApps')
  })
})
