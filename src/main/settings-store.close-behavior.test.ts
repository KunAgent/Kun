import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JsonSettingsStore } from './settings-store'

describe('desktop close behavior migration', () => {
  it.each([
    { closeAction: 'ask' }, { closeAction: 'tray' }, { closeToTray: true }, { closeToTray: false }
  ])('migrates legacy %j to quit and preserves other preferences', async (legacy) => {
    const userDataDir = await mkdtemp(join(tmpdir(), 'kun-close-migration-'))
    try {
      const settingsPath = join(userDataDir, 'kun-settings.json')
      const store = new JsonSettingsStore(userDataDir)
      const original = await store.load()
      await writeFile(settingsPath, JSON.stringify({
        ...original,
        locale: 'zh',
        appBehavior: { openAtLogin: true, startMinimized: true, keepAwake: true, useSystemTitleBar: true, ...legacy }
      }))
      const migrated = await new JsonSettingsStore(userDataDir).load()
      expect(migrated.locale).toBe('zh')
      expect(migrated.appBehavior).toEqual({
        openAtLogin: true, startMinimized: true, keepAwake: true, useSystemTitleBar: true,
        closeAction: 'quit', closeToTray: false
      })
      expect((await new JsonSettingsStore(userDataDir).load()).appBehavior).toEqual(migrated.appBehavior)
      expect(JSON.parse(await readFile(settingsPath, 'utf8')).appBehavior).toEqual(migrated.appBehavior)
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })
})
