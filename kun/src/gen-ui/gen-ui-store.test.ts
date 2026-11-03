import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GenUiStore } from './gen-ui-store.js'

describe('GenUiStore', () => {
  let root: string
  let store: GenUiStore

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'kun-gen-ui-'))
    store = new GenUiStore(root, () => '2026-10-19T00:00:00.000Z')
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('stores widgets content-addressed and immutable', async () => {
    const first = await store.putWidget('<p>hello</p>')
    const again = await store.putWidget('<p>hello</p>')
    expect(first).toEqual(again)
    expect(first.widgetId).toMatch(/^gw_[a-f0-9]{64}$/)
    expect(await store.readWidget(first.widgetId)).toBe('<p>hello</p>')
    expect(await store.readWidget(`gw_${'0'.repeat(64)}`)).toBeNull()
    expect(await store.readWidget('gw_../../secret')).toBeNull()
    await expect(store.putWidget('')).rejects.toThrow(/empty or too large/)
  })

  it('keeps one state entry per widget, isolated per thread, copied on fork and removed on delete', async () => {
    const { widgetId } = await store.putWidget('<p>w</p>')
    await store.writeState('thread-a', widgetId, { modelContent: { step: 1 } })
    await store.writeState('thread-a', widgetId, { modelContent: { step: 2 }, privateContent: 'view' })
    expect(await store.readState('thread-a')).toEqual([{
      widgetId,
      state: { modelContent: { step: 2 }, privateContent: 'view' },
      updatedAt: '2026-10-19T00:00:00.000Z'
    }])
    expect(await store.readState('thread-b')).toEqual([])
    await store.copyThreadState('thread-a', 'thread-b')
    expect((await store.readState('thread-b'))[0]?.state.modelContent).toEqual({ step: 2 })
    await store.deleteThreadState('thread-a')
    expect(await store.readState('thread-a')).toEqual([])
    await expect(store.writeState('thread-a', 'bad', {})).rejects.toThrow(/invalid widget id/)
    await expect(store.writeState('thread-a', widgetId, { modelContent: () => 1 })).rejects.toThrow()
  })

  it('serializes concurrent writes without losing entries', async () => {
    const widgets = await Promise.all(['a', 'b', 'c', 'd'].map((name) => store.putWidget(`<p>${name}</p>`)))
    await Promise.all(widgets.map((widget, index) =>
      store.writeState('thread', widget.widgetId, { modelContent: index })))
    expect((await store.readState('thread')).map((entry) => entry.state.modelContent).sort()).toEqual([0, 1, 2, 3])
  })
})
