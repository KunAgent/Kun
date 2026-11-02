import type { Protocol } from 'electron'
import { PET_ASSET_SCHEME } from '../shared/pets'
import { ART_SCHEME } from './art-assets/protocol-scheme'
const scheme = (name: string) => ({ scheme: name,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false, bypassCSP: false, stream: true } })
export const KUN_EXTENSION_PRIVILEGED_SCHEME = scheme('kun-extension')
export const KUN_MEDIA_PRIVILEGED_SCHEME = scheme('kun-media')
export const KUN_WORKSPACE_PREVIEW_PRIVILEGED_SCHEME = scheme('kun-workspace-preview')
/** Gen UI / MCP App sandbox pages; each instance gets its own standard origin. */
export const KUN_APP_SANDBOX_PRIVILEGED_SCHEME = scheme('kun-app')
/**
 * Pet spritesheets are CSS background images on `kun-pet://asset/...`.
 * Electron only honors this registration once, before app ready. Without it,
 * Chromium drops the image request and both the settings preview and the
 * transparent desktop overlay render empty.
 */
export const KUN_PET_PRIVILEGED_SCHEME = {
  scheme: PET_ASSET_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: false, stream: true }
}
/** Must run in the synchronous entry, before any session or BrowserWindow is created. */
export function registerAppSchemes(protocol: Pick<Protocol, 'registerSchemesAsPrivileged'>): void {
  protocol.registerSchemesAsPrivileged([KUN_EXTENSION_PRIVILEGED_SCHEME, KUN_MEDIA_PRIVILEGED_SCHEME,
    KUN_WORKSPACE_PREVIEW_PRIVILEGED_SCHEME, KUN_APP_SANDBOX_PRIVILEGED_SCHEME, ART_SCHEME,
    KUN_PET_PRIVILEGED_SCHEME])
}
