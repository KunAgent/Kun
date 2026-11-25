import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { parseGenUiWidgetState } from '../contracts/gen-ui.js'
import { WidgetAppId, WidgetAppSource, type WidgetApp } from '../contracts/widget-app.js'
import { FIRST_WIDGET_APP_VERSION, widgetAppId } from './widget-app-identity.js'
import { packKunx } from '../extensions/archive.js'
import type { ExtensionPackageManager } from '../extensions/package-manager.js'
import type { ExtensionRegistry } from '../extensions/registry.js'
import type { ExtensionStateStore } from '../extensions/state-store.js'
import type { ExtensionRegistryEntry, JsonValue } from '../extensions/types.js'
import type { GenUiStore } from './gen-ui-store.js'

const SOURCE_PREFIX = 'kun:installed-widget:'
const PageSource = WidgetAppSource.extend({ launcherTitle: z.string().min(1).max(120) })
const PAGE_FILE = 'widget.html'
const STATE_KEY = 'widget-state'

function describe(entry?: ExtensionRegistryEntry): WidgetApp | undefined {
  if (!entry || !WidgetAppId.safeParse(entry.id).success || entry.useDevelopment || !entry.selectedVersion) return
  const installed = entry.versions[entry.selectedVersion]
  if (installed?.source.type !== 'local' || !installed.source.locator.startsWith(SOURCE_PREFIX) ||
    installed.manifest.main || installed.manifest.browser !== PAGE_FILE) return
  let source: z.infer<typeof PageSource>
  try { source = PageSource.parse(JSON.parse(installed.source.locator.slice(SOURCE_PREFIX.length))) }
  catch { return undefined }
  if (widgetAppId(source) !== entry.id) return
  return { ...source, id: entry.id, version: installed.version,
    enabled: entry.globallyEnabled && installed.grantedPermissions.includes('webview') }
}

export class WidgetAppService {
  private readonly operations = new Map<string, Promise<void>>()

  constructor(
    private readonly widgets: GenUiStore,
    private readonly registry: ExtensionRegistry,
    private readonly packages: ExtensionPackageManager,
    private readonly state: ExtensionStateStore
  ) {}

  async list(): Promise<WidgetApp[]> {
    return Object.values((await this.registry.read()).extensions)
      .map(describe).filter((app): app is WidgetApp => Boolean(app))
      .sort((a, b) => a.title.localeCompare(b.title))
  }

  async get(id: string): Promise<WidgetApp | undefined> {
    return describe(await this.registry.get(WidgetAppId.parse(id)))
  }

  async page(id: string) {
    return this.serial(id, async () => {
      const entry = await this.registry.get(WidgetAppId.parse(id))
      const app = describe(entry)
      if (!entry || !app?.enabled) return undefined
      const html = await readFile(join(entry.versions[app.version]!.packagePath, PAGE_FILE), 'utf8')
      if ('gw_' + createHash('sha256').update(html).digest('hex') !== app.widgetId) throw new Error('Widget package integrity check failed')
      return { app, html, state: await this.state.getGlobal(id, STATE_KEY) ?? null }
    })
  }

  async save(id: string, widgetId: string, value: unknown): Promise<boolean> {
    const snapshot = parseGenUiWidgetState(value)
    return this.serial(id, async () => {
      const app = await this.get(id)
      if (!app?.enabled || app.widgetId !== widgetId) return false
      await this.state.setGlobal(id, STATE_KEY, snapshot as JsonValue)
      return true
    })
  }

  install(source: WidgetAppSource): Promise<{ app: WidgetApp; created: boolean }> {
    const id = widgetAppId(source)
    return this.serial(id, async () => {
      const entry = await this.registry.get(id)
      const current = describe(entry)
      if (current) return { app: current, created: false }
      if (entry && (entry.useDevelopment || Object.keys(entry.versions).length)) throw new Error('App identity already in use')
      const snapshot = (await this.widgets.readState(source.threadId)).find(item => item.widgetId === source.widgetId)
      // An interrupted install or reinstall may already have durable user data.
      if (snapshot && await this.state.getGlobal(id, STATE_KEY) === undefined) {
        await this.state.setGlobal(id, STATE_KEY, snapshot.state as JsonValue)
      }
      return { app: await this.publish(source, source.title, FIRST_WIDGET_APP_VERSION), created: true }
    })
  }

  revise(source: WidgetAppSource): Promise<void> {
    const id = widgetAppId(source)
    return this.serial(id, async () => {
      const entry = await this.registry.get(id)
      const current = describe(entry)
      if (!entry || !current?.enabled || (current.widgetId === source.widgetId && current.title === source.title)) return
      const patch = Math.max(...Object.keys(entry.versions).map(version => Number(version.split('.')[2]))) + 1
      await this.publish(source, current.launcherTitle, '1.0.' + patch)
    })
  }

  uninstall(id: string): Promise<void> {
    return this.serial(id, async () => {
      if (await this.get(id)) await this.packages.uninstall(id)
    })
  }

  private async publish(source: WidgetAppSource, launcherTitle: string, version: string): Promise<WidgetApp> {
    const html = await this.widgets.readWidget(source.widgetId)
    if (html === null) throw new Error('Widget snapshot is unavailable')
    const id = widgetAppId(source)
    const manifest = {
      manifestVersion: 1, apiVersion: '1.0.0', publisher: 'kun-widget', name: id.split('.')[1],
      displayName: source.title, version, engines: { kun: '>=0.1.0' }, browser: PAGE_FILE,
      permissions: ['webview'], activationEvents: [], contributes: {}, stateSchemaVersion: 0
    }
    const work = await mkdtemp(join(tmpdir(), 'kun-widget-package-'))
    try {
      const directory = join(work, 'source')
      const archive = join(work, 'widget.kunx')
      await mkdir(directory)
      await Promise.all([
        writeFile(join(directory, 'kun-extension.json'), JSON.stringify(manifest)),
        writeFile(join(directory, PAGE_FILE), html),
        writeFile(join(directory, 'README.md'), source.title + '\n'),
        writeFile(join(directory, 'LICENSE'), 'Private local widget.\n')
      ])
      await packKunx(directory, archive)
      await this.packages.installArchive(archive, {
        grantedPermissions: ['webview'], enable: true, select: true,
        source: { type: 'local', locator: SOURCE_PREFIX + JSON.stringify({ ...source, launcherTitle }) }
      })
      return { ...source, launcherTitle, id, version, enabled: true }
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }

  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.operations.get(id) ?? Promise.resolve()).then(fn)
    const settled = next.then(() => undefined, () => undefined)
    this.operations.set(id, settled)
    void settled.then(() => { if (this.operations.get(id) === settled) this.operations.delete(id) })
    return next
  }
}
