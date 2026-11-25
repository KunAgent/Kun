import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ExtensionPackageManager } from '../extensions/package-manager.js'
import { makeTreeWritable } from '../extensions/package-manager-support.js'
import { ExtensionPaths } from '../extensions/paths.js'
import { ExtensionRegistry } from '../extensions/registry.js'
import { ExtensionStateStore } from '../extensions/state-store.js'
import { GenUiStore } from './gen-ui-store.js'
import { WidgetAppService } from './widget-app-service.js'

it('installs once, reopens from disk and selects revisions without replacing app data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-widget-app-test-'))
  const paths = new ExtensionPaths({ packageRoot: join(root, 'packages'), dataRoot: join(root, 'state') })
  const widgets = new GenUiStore(join(root, 'widgets'))
  const reopen = () => {
    const registry = new ExtensionRegistry(paths)
    return new WidgetAppService(widgets, registry, new ExtensionPackageManager(paths, registry, {}),
      new ExtensionStateStore(paths))
  }
  try {
    const apps = reopen()
    const original = { threadId: 'chat', title: 'Checklist', widgetId: (await widgets.putWidget('<p>first</p>')).widgetId }
    const saved = { privateContent: { checked: true }, modelContent: null }
    await widgets.writeState(original.threadId, original.widgetId, saved)
    const [{ app: first, created }, { app: retry, created: duplicate }] = await Promise.all([apps.install(original), apps.install(original)])
    expect([created, duplicate]).toEqual([true, false])
    expect(first.id).toBe(retry.id)
    expect(await reopen().page(first.id)).toMatchObject({ html: '<p>first</p>', state: saved })
    const revision = { threadId: 'chat', appKey: 'Checklist', title: 'Release', widgetId: (await widgets.putWidget('<p>second</p>')).widgetId }
    await apps.revise({ ...revision, threadId: 'other' })
    expect((await apps.get(first.id))?.version).toBe(first.version)
    await apps.revise(revision)
    expect(await apps.save(first.id, original.widgetId, {})).toBe(false)
    expect(await reopen().page(first.id)).toMatchObject({ html: '<p>second</p>', state: saved,
      app: { launcherTitle: 'Checklist', title: 'Release', widgetId: revision.widgetId } })
    const registry = new ExtensionRegistry(paths)
    await registry.setGlobalEnabled(first.id, false)
    expect(await apps.page(first.id)).toBeUndefined()
    expect(await apps.save(first.id, revision.widgetId, {})).toBe(false)
    await apps.revise(original)
    expect((await apps.get(first.id))?.widgetId).toBe(revision.widgetId)
    await registry.setGlobalEnabled(first.id, true)
    const latest = { modelContent: { owner: 'Ada' }, privateContent: { checked: false } }
    expect(await apps.save(first.id, revision.widgetId, latest)).toBe(true)
    await apps.uninstall(first.id)
    expect(await reopen().page(first.id)).toBeUndefined()
    expect(await widgets.readWidget(original.widgetId)).toBe('<p>first</p>')
    await reopen().install(original)
    await rm(join(root, 'widgets'), { recursive: true, force: true })
    expect(await reopen().page(first.id)).toMatchObject({ html: '<p>first</p>', state: latest })
  } finally {
    await makeTreeWritable(root)
    await rm(root, { recursive: true, force: true })
  }
})
