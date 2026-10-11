import type { CustomScheme } from 'electron'
export const ART_SCHEME: CustomScheme = {
  scheme: 'kun-asset',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
}
