import { app } from 'electron'

export const LINUX_WAYLAND_IME_SWITCHES = [
  { name: 'ozone-platform-hint', value: 'auto' },
  { name: 'enable-wayland-ime' },
  // Chromium defaults to text-input-v1 after enable-wayland-ime. wlroots /
  // smithay compositors such as niri, sway and Hyprland need v3 for IME.
  { name: 'wayland-text-input-version', value: '3' }
] as const

type LinuxImeEnv = Record<string, string | undefined>

export function shouldConfigureLinuxWaylandImeSwitches(
  platform = process.platform,
  env: LinuxImeEnv = process.env
): boolean {
  if (platform !== 'linux') return false
  const explicit = env.KUN_LINUX_WAYLAND_IME?.trim().toLowerCase()
  if (explicit === '1' || explicit === 'true' || explicit === 'yes') return true
  if (explicit === '0' || explicit === 'false' || explicit === 'no') return false

  // Do not force Ozone/ANGLE on generic Linux or X11 sessions. Electron's
  // default GPU path is safer there, and forcing Wayland flags can push Intel
  // Mesa systems into SwiftShader/software rendering (#571).
  return Boolean(env.WAYLAND_DISPLAY) && !env.DISPLAY
}

export function configureLinuxWaylandImeSwitches(
  platform = process.platform,
  env: LinuxImeEnv = process.env
): void {
  if (!shouldConfigureLinuxWaylandImeSwitches(platform, env)) return

  for (const commandLineSwitch of LINUX_WAYLAND_IME_SWITCHES) {
    if (app.commandLine.hasSwitch(commandLineSwitch.name)) continue

    if ('value' in commandLineSwitch) {
      app.commandLine.appendSwitch(commandLineSwitch.name, commandLineSwitch.value)
    } else {
      app.commandLine.appendSwitch(commandLineSwitch.name)
    }
  }
}
