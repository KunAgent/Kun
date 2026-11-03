import { app, type RelaunchOptions } from 'electron'
import { posix } from 'node:path'

const LINUX_REAL_EXECUTABLE_SUFFIX = '.electron-bin'

type RelaunchEnvironment = {
  platform: NodeJS.Platform
  isPackaged: boolean
  execPath: string
  argv: string[]
  appImage?: string
}

export function resolveRelaunchOptions(input: RelaunchEnvironment): RelaunchOptions | undefined {
  if (input.platform !== 'linux' || !input.isPackaged) return undefined

  let execPath: string
  if (input.appImage) {
    if (!posix.isAbsolute(input.appImage) || input.appImage.includes('\0')) {
      throw new Error('The AppImage path is not a valid absolute path for relaunch.')
    }
    execPath = input.appImage
  } else if (input.execPath.endsWith(LINUX_REAL_EXECUTABLE_SUFFIX)) {
    execPath = input.execPath.slice(0, -LINUX_REAL_EXECUTABLE_SUFFIX.length)
  } else {
    return undefined
  }

  // Supplying execPath replaces Electron's entire argv; keep the original
  // arguments, including the sandbox flag, when re-entering the launcher.
  return { execPath, args: input.argv.slice(1) }
}

export function relaunchApp(): void {
  const options = resolveRelaunchOptions({
    platform: process.platform,
    isPackaged: app.isPackaged,
    execPath: process.execPath,
    argv: process.argv,
    appImage: process.env.APPIMAGE
  })
  if (options) app.relaunch(options)
  else app.relaunch()
}
