import { describe, expect, it } from 'vitest'
import type { ServiceManagerConnection } from '../../../kun/src/manager/manager-client.js'
import { kunManagerLaunchEnvironment } from './kun-manager-launch-environment'

describe('Kun Manager launch environment', () => {
  it('passes the exact selected Manager authority to a GUI-owned Runtime', () => {
    const manager = {
      discovery: {
        instanceId: 'manager-current',
        baseUrl: 'http://127.0.0.1:17777',
        managerToken: 'manager-secret',
        dataDir: '/tmp/kun-manager-data',
        settingsPath: '/tmp/electron-user-data/kun-settings.json'
      }
    } as ServiceManagerConnection

    expect(kunManagerLaunchEnvironment({ manager, controlDir: '/tmp/kun-control' })).toEqual({
      KUN_MANAGER_CONTROL_DIR: '/tmp/kun-control',
      KUN_MANAGER_BASE_URL: manager.discovery.baseUrl,
      KUN_MANAGER_INSTANCE_ID: manager.discovery.instanceId,
      KUN_MANAGER_TOKEN: manager.discovery.managerToken,
      KUN_MANAGER_DATA_DIR: manager.discovery.dataDir,
      KUN_MANAGER_SETTINGS_PATH: manager.discovery.settingsPath
    })
  })

  it('keeps the canonical settings path before a Manager binding is available', () => {
    expect(kunManagerLaunchEnvironment({
      controlDir: '/tmp/kun-control',
      settingsPath: '/tmp/electron-user-data/kun-settings.json'
    })).toEqual({
      KUN_MANAGER_SETTINGS_PATH: '/tmp/electron-user-data/kun-settings.json'
    })
  })
})
