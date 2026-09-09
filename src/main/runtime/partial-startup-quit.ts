import type { AppSettingsV1 } from '../../shared/app-settings'

/** Early startup failures have neither a settings store nor Browser authority to revoke. */
export async function revokeBrowserBindingBeforeQuit(input: {
  store?: { load(): Promise<AppSettingsV1> }
  hasBinding: boolean
  runtimeIsLive: boolean
  revoke(settings: AppSettingsV1): Promise<unknown>
}): Promise<void> {
  if (!input.store || !input.hasBinding || !input.runtimeIsLive) return
  await input.revoke(await input.store.load())
}
