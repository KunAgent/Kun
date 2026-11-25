import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ShortcutDetails } from 'electron'
import type { WidgetApp } from '../../../kun/src/contracts/widget-app'
import { widgetAppLaunchUrl } from '../../shared/widget-apps'

export type LauncherHost = {
  platform: NodeJS.Platform
  directory: string
  iconDirectory: string
  executable: string
  appPath?: string
  developmentFlavor?: boolean
  userDataDir?: string
  bundleId: string
  icon: (id: string) => Buffer
  writeShortcut: (path: string, options: ShortcutDetails) => boolean
  readShortcut: (path: string) => ShortcutDetails
}

function displayTitle(input: string): string {
  return input.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim() || 'Kun App'
}

function safeTitle(input: string): string {
  return Array.from(displayTitle(input).replace(/[<>:"/\\|?*]/g, ' ').replace(/^\.+/, '').trim()).slice(0, 48).join('') || 'Kun App'
}

function file(host: LauncherHost, app: WidgetApp): string {
  const extension = host.platform === 'darwin' ? '.app' : host.platform === 'win32' ? '.lnk' : '.desktop'
  return join(host.directory, safeTitle(app.launcherTitle) + ' (' + app.id.slice(-8) + ')' + extension)
}

function xml(value: string): string {
  return value.replace(/[<>&"']/g, char => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char]!)
}

function shellArg(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

function desktopArg(value: string): string {
  return '"' + value.replace(/%/g, '%%').replace(/["`$\\]/g, '\\$&').replace(/\\/g, '\\\\') + '"'
}

const marker = (id: string) => 'X-Kun-Widget=' + id
function launchArguments(host: LauncherHost, id: string): string[] {
  return [...(host.userDataDir ? ['--user-data-dir=' + host.userDataDir] : []),
    ...(host.appPath ? [host.appPath] : []),
    ...(host.developmentFlavor ? ['--kun-app-flavor=development'] : []), widgetAppLaunchUrl(id)]
}
const winArgs = (host: LauncherHost, id: string) => launchArguments(host, id)
  .map(arg => /\s/.test(arg) ? '"' + arg + '"' : arg).join(' ')

async function owned(host: LauncherHost, path: string, id: string): Promise<boolean> {
  const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  if (!stat) return false
  const matches = !stat.isSymbolicLink() && (host.platform === 'darwin'
    ? stat.isDirectory() && (await readFile(join(path, 'Contents', 'Resources', 'widget-id'), 'utf8')) === id
    : host.platform === 'win32'
      ? stat.isFile() && host.readShortcut(path).args === winArgs(host, id)
      : stat.isFile() && (await readFile(path, 'utf8')).split('\n').includes(marker(id)))
  if (!matches) throw new Error('A different item already uses this launcher name.')
  return true
}

export async function installWidgetLauncher(host: LauncherHost, app: WidgetApp): Promise<void> {
  const link = widgetAppLaunchUrl(app.id)
  const destination = file(host, app)
  await mkdir(host.directory, { recursive: true })
  if (await owned(host, destination, app.id)) return
  const staging = await mkdtemp(join(host.directory, '.kun-install-'))
  try {
    const args = launchArguments(host, app.id)
    if (host.platform === 'darwin') {
      const bundle = join(staging, 'launcher.app')
      const contents = join(bundle, 'Contents')
      await mkdir(join(contents, 'Resources'), { recursive: true })
      await mkdir(join(contents, 'MacOS'))
      const plist = { CFBundleName: displayTitle(app.launcherTitle), CFBundleDisplayName: displayTitle(app.launcherTitle),
        CFBundleExecutable: 'launch', CFBundleIdentifier: host.bundleId + '.' + app.id,
        CFBundlePackageType: 'APPL', CFBundleVersion: '1', CFBundleIconFile: 'widget.icns' }
      await writeFile(join(contents, 'Info.plist'), '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>' +
        Object.entries(plist).map(([key, value]) => '<key>' + key + '</key><string>' + xml(value) + '</string>').join('') +
        '<key>LSUIElement</key><true/></dict></plist>')
      const command = host.appPath || host.userDataDir ? [host.executable, ...args] : ['/usr/bin/open', '-b', host.bundleId, link]
      await writeFile(join(contents, 'MacOS', 'launch'), '#!/bin/sh\nexec ' + command.map(shellArg).join(' ') + '\n', { mode: 0o755 })
      await writeFile(join(contents, 'Resources', 'widget-id'), app.id)
      await writeFile(join(contents, 'Resources', 'widget.icns'), host.icon(app.id))
      await rename(bundle, destination)
    } else {
      const windows = host.platform === 'win32'
      const icon = join(host.iconDirectory, app.id + (windows ? '.ico' : '.png'))
      await mkdir(dirname(icon), { recursive: true })
      const temporary = join(staging, windows ? 'launcher.lnk' : 'launcher.desktop')
      if (windows) {
        if (!host.writeShortcut(temporary, { target: host.executable, args: winArgs(host, app.id),
          description: app.launcherTitle, icon, iconIndex: 0, appUserModelId: host.bundleId + '.' + app.id })) {
          throw new Error('Windows could not create the application shortcut.')
        }
      } else {
        await writeFile(temporary, ['[Desktop Entry]', 'Type=Application', 'Name=' + safeTitle(app.launcherTitle),
          'Exec=' + [host.executable, ...args].map(desktopArg).join(' '), 'Icon=' + icon.replace(/\\/g, '\\\\'),
          'Terminal=false', marker(app.id), ''].join('\n'), { mode: 0o755 })
      }
      const createdIcon = await writeFile(icon, host.icon(app.id), { flag: 'wx' })
        .then(() => true)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === 'EEXIST') return false
          throw error
        })
      try {
        await copyFile(temporary, destination, constants.COPYFILE_EXCL)
      } catch (error) {
        if (createdIcon) await rm(icon, { force: true })
        throw error
      }
    }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

export async function removeWidgetLauncher(host: LauncherHost, app: WidgetApp): Promise<void> {
  widgetAppLaunchUrl(app.id)
  const path = file(host, app)
  if (await owned(host, path, app.id)) await rm(path, { recursive: host.platform === 'darwin' })
  if (host.platform !== 'darwin') await rm(join(host.iconDirectory, app.id + (host.platform === 'win32' ? '.ico' : '.png')), { force: true })
}
