import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { ShortcutDetails } from 'electron'
import type { WidgetApp } from '../../../kun/src/contracts/widget-app'
import { widgetAppFromArg, widgetAppLaunchUrl } from '../../shared/widget-apps'
import { installWidgetLauncher, removeWidgetLauncher, type LauncherHost } from './launcher'

const item: WidgetApp = { id: 'kun-widget.app-' + 'a'.repeat(32), threadId: 'chat', title: 'My Checklist',
  launcherTitle: '清单 & <demo> / project', widgetId: 'gw_' + '0'.repeat(64), version: '1.0.1', enabled: true }
let root: string
const host = (platform: NodeJS.Platform): LauncherHost => ({
  platform, directory: join(root, 'launchers'), iconDirectory: join(root, 'icons'), executable: '/bin/echo',
  appPath: "/test's workspace", bundleId: 'com.test.kun', icon: () => Buffer.from('icon'),
  writeShortcut: () => false, readShortcut: () => { throw new Error('Unexpected shortcut') }
})
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'kun-widget-launcher-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

it('creates an idempotent Mac application bundle and passes only the fixed launcher arguments', async () => {
  const mac = host('darwin')
  await installWidgetLauncher(mac, item)
  await installWidgetLauncher(mac, { ...item, title: 'Revised title' })
  const names = await readdir(mac.directory)
  expect(names).toHaveLength(1)
  const contents = join(mac.directory, names[0]!, 'Contents')
  expect(await readFile(join(contents, 'Info.plist'), 'utf8')).toContain('&amp; &lt;demo&gt;')
  if (process.platform !== 'win32') {
    const { stdout } = await promisify(execFile)('/bin/sh', [join(contents, 'MacOS', 'launch')], { timeout: 10000 })
    expect(stdout.trim()).toBe(mac.appPath + ' ' + widgetAppLaunchUrl(item.id))
  }
  await removeWidgetLauncher(mac, item)
  expect(await readdir(mac.directory)).toEqual([])
}, 20000)

it('creates a Windows Start menu link targeting the selected host and removes its icon', async () => {
  const win = host('win32')
  let shortcut: ShortcutDetails = { target: '' }
  win.writeShortcut = (name, details) => {
    shortcut = details
    writeFileSync(name, 'shortcut')
    return true
  }
  win.readShortcut = () => shortcut
  await installWidgetLauncher(win, item)
  expect(shortcut).toMatchObject({ target: win.executable, args: '"' + win.appPath + '" ' + widgetAppLaunchUrl(item.id) })
  expect((await readdir(win.directory))[0]).toMatch(/\.lnk$/)
  await removeWidgetLauncher(win, item)
  expect(await readdir(win.iconDirectory)).toEqual([])
})

it('writes a Linux application entry and keeps a foreign replacement', async () => {
  const linux = host('linux')
  await installWidgetLauncher(linux, item)
  const path = join(linux.directory, (await readdir(linux.directory))[0]!)
  expect(await readFile(path, 'utf8')).toContain('Exec="/bin/echo"')
  await writeFile(path, 'Someone else owns this file')
  await expect(removeWidgetLauncher(linux, item)).rejects.toThrow(/different item/)
  expect(await readFile(path, 'utf8')).toBe('Someone else owns this file')
})

it('removes staging and leaves no icon when Windows rejects a shortcut', async () => {
  const win = host('win32')
  await expect(installWidgetLauncher(win, item)).rejects.toThrow('could not create')
  expect(await readdir(win.directory)).toEqual([])
  expect(await readdir(win.iconDirectory)).toEqual([])
})

it('accepts an exact installed app ID on cold and warm protocol activation', () => {
  const url = widgetAppLaunchUrl(item.id)
  expect(widgetAppFromArg('"' + url + '"')).toBe(item.id)
  for (const arg of [url + '?run=x', url + '/other', 'kun://apps/../etc', 'kun://import', 'https://apps/' + item.id]) {
    expect(widgetAppFromArg(arg)).toBeUndefined()
  }
})
