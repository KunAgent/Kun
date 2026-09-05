import type { AppSettingsV1, KunComputerUseSettingsV1 } from '../../shared/app-settings'
import { resolveKunRuntimeSettings } from '../../shared/app-settings'
import { CuaDriverController } from './cua-driver-controller'
import {
  ComputerUseBridgeService,
  type ComputerUseBridgeLaunch
} from './computer-use-bridge-service'

let currentSettings: KunComputerUseSettingsV1 | undefined
let bridge: ComputerUseBridgeService | undefined
let bridgeMaxImageDimension: number | undefined
let lifecycleQueue: Promise<void> = Promise.resolve()

export function configureComputerUseHost(options: { settings: AppSettingsV1 }): void {
  currentSettings = resolveKunRuntimeSettings(options.settings).computerUse
}

export function updateComputerUseHostSettings(settings: AppSettingsV1): void {
  const next = resolveKunRuntimeSettings(settings).computerUse
  const mustRecreate = bridgeMaxImageDimension !== undefined &&
    bridgeMaxImageDimension !== next.maxImageDimension
  currentSettings = next
  if (!next.enabled || mustRecreate) {
    void queueLifecycle(async () => {
      await stopCurrentBridge()
    })
  }
}

export async function prepareComputerUseHostForKunLaunch(): Promise<
  ComputerUseBridgeLaunch | undefined
> {
  return queueLifecycle(async () => {
    const settings = currentSettings
    if (!settings?.enabled) {
      await stopCurrentBridge()
      return undefined
    }
    if (!bridge || bridgeMaxImageDimension !== settings.maxImageDimension) {
      await stopCurrentBridge()
      bridgeMaxImageDimension = settings.maxImageDimension
      bridge = new ComputerUseBridgeService(new CuaDriverController({
        maxImageDimension: settings.maxImageDimension
      }))
    }
    return bridge.start()
  })
}

export async function stopComputerUseHost(): Promise<void> {
  await queueLifecycle(stopCurrentBridge)
}

async function stopCurrentBridge(): Promise<void> {
  const current = bridge
  bridge = undefined
  bridgeMaxImageDimension = undefined
  await current?.stop()
}

function queueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const task = lifecycleQueue.catch(() => undefined).then(operation)
  lifecycleQueue = task.then(() => undefined, () => undefined)
  return task
}
