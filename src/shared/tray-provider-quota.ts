import type { AppLocale } from './app-locales'
import type { DarkUiColorsV1 } from './app-settings-types'
import type { ProviderQuotaListResult } from './provider-quota'

export const TRAY_PROVIDER_QUOTA_CHANNELS = {
  list: 'tray-provider-quota:list',
  context: 'tray-provider-quota:context',
  action: 'tray-provider-quota:action',
  openExternal: 'tray-provider-quota:open-external',
  refresh: 'tray-provider-quota:refresh'
} as const

export const TRAY_PROVIDER_QUOTA_ACTIONS = [
  'close',
  'new-chat',
  'open-app'
] as const

export type TrayProviderQuotaAction = (typeof TRAY_PROVIDER_QUOTA_ACTIONS)[number]

export type TrayProviderQuotaPlatform = 'darwin' | 'win32' | 'linux'

export type TrayProviderQuotaContext = {
  locale: AppLocale
  colorMode: 'light' | 'dark'
  platform: TrayProviderQuotaPlatform
  darkUiColors: DarkUiColorsV1
}

export type KunTrayProviderQuotaApi = {
  list: () => Promise<ProviderQuotaListResult>
  context: () => Promise<TrayProviderQuotaContext>
  action: (action: TrayProviderQuotaAction) => Promise<void>
  openExternal: (url: string) => Promise<void>
  onRefresh: (handler: () => void) => () => void
}
