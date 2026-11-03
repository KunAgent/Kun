export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
}
export function modifierLabel(): string { return isMacPlatform() ? '⌘' : 'Ctrl+' }
