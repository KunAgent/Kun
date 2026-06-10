import { app } from 'electron'

export const LINUX_WAYLAND_IME_SWITCHES = [
  { name: 'ozone-platform-hint', value: 'auto' },
  { name: 'enable-wayland-ime' }
] as const

export function shouldConfigureLinuxWaylandImeSwitches(platform = process.platform): boolean {
  return platform === 'linux'
}

export function configureLinuxWaylandImeSwitches(platform = process.platform): void {
  if (!shouldConfigureLinuxWaylandImeSwitches(platform)) return

  for (const commandLineSwitch of LINUX_WAYLAND_IME_SWITCHES) {
    if (app.commandLine.hasSwitch(commandLineSwitch.name)) continue

    if ('value' in commandLineSwitch) {
      app.commandLine.appendSwitch(commandLineSwitch.name, commandLineSwitch.value)
    } else {
      app.commandLine.appendSwitch(commandLineSwitch.name)
    }
  }
}
