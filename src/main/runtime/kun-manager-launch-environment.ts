import type { ServiceManagerConnection } from '../../../kun/src/manager/manager-client.js'

export function kunManagerLaunchEnvironment(input: {
  manager?: ServiceManagerConnection
  controlDir: string
  settingsPath?: string
}): NodeJS.ProcessEnv {
  const discovery = input.manager?.discovery
  if (!discovery) {
    return input.settingsPath
      ? { KUN_MANAGER_SETTINGS_PATH: input.settingsPath }
      : {}
  }
  return {
    KUN_MANAGER_CONTROL_DIR: input.controlDir,
    KUN_MANAGER_BASE_URL: discovery.baseUrl,
    KUN_MANAGER_INSTANCE_ID: discovery.instanceId,
    KUN_MANAGER_TOKEN: discovery.managerToken,
    KUN_MANAGER_DATA_DIR: discovery.dataDir,
    KUN_MANAGER_SETTINGS_PATH: discovery.settingsPath
  }
}
