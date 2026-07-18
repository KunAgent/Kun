import { isExtensionViewSafeMethod } from '@kun/extension-api'

/** Stable, fail-closed methods exposed to sandboxed extension Webviews. */
export function isAllowedExtensionViewMethod(method: string): boolean {
  return isExtensionViewSafeMethod(method)
}
