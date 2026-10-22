import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveKunRuntimeSettings, type AppSettingsV1 } from '../../shared/app-settings'
import { runtimeSettingsApplyMode } from '../runtime-settings-apply-mode'
import { syncGuiManagedKunConfig } from '../runtime/kun-runtime-config-service'
import { JsonSettingsStore } from '../settings-store'
import { ASSISTANT_MCP_SERVER_ID } from './mcp-config'

function withAssistants(settings: AppSettingsV1, dataDir: string, enabled: boolean): AppSettingsV1 {
  const kun = settings.agents.kun
  return {
    ...settings,
    agents: { ...settings.agents, kun: { ...kun, dataDir, lab: { ...kun.lab, assistantMailbox: { enabled } } } }
  } as AppSettingsV1
}

describe('assistant MCP runtime config', () => {
  it('registers the Kun tool bridge only while the Lab switch is on', async () => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-assistant-config-'))
    try {
      const dataDir = join(userDataDir, 'runtime-data')
      const defaults = await new JsonSettingsStore(userDataDir).load()
      expect(defaults.agents.kun.lab.assistantMailbox.enabled).toBe(false)
      const sync = async (enabled: boolean, withUserData = true) => {
        const settings = withAssistants(defaults, dataDir, enabled)
        await syncGuiManagedKunConfig(dataDir, resolveKunRuntimeSettings(settings), {
          scheduleMcp: { settings, launch: { appPath: userDataDir, execPath: process.execPath, isPackaged: false, ...(withUserData ? { userDataDir } : {}) } },
          mcpConfigPath: join(userDataDir, 'missing-mcp.json')
        })
        const config = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8')) as { capabilities: { mcp: { servers: Record<string, { args?: string[] }> } } }
        return config.capabilities.mcp.servers[ASSISTANT_MCP_SERVER_ID]
      }
      const server = await sync(true)
      expect(server?.args).toContain(join(userDataDir, 'assistant-mailbox', 'tools.secret'))
      expect(await sync(false)).toBeUndefined()
      expect(await sync(true, false)).toBeUndefined()
      expect(runtimeSettingsApplyMode(withAssistants(defaults, dataDir, false), withAssistants(defaults, dataDir, true))).toBe('hot')
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})
