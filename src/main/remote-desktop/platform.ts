export type DesktopPlatform = 'macos' | 'windows' | 'linux'

export function isDesktopPlatform(value: string): value is DesktopPlatform {
  return value === 'macos' || value === 'windows' || value === 'linux'
}

export function desktopPlatform(platform: NodeJS.Platform = process.platform): DesktopPlatform {
  if (platform === 'darwin') return 'macos'
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return 'linux'
  throw Error('DESKTOP_UNSUPPORTED')
}

export function controllerSupported(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return arch === 'x64'
  return (platform === 'linux' || platform === 'darwin') && (arch === 'x64' || arch === 'arm64')
}
