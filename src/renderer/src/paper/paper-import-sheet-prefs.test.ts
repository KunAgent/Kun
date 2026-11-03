import { afterEach, describe, expect, it } from 'vitest'

import { readImportSheetPrefs, writeImportSheetPrefs } from './paper-import-sheet-prefs'

function stubStorage(initial: Record<string, string>): void {
  const data = new Map(Object.entries(initial))
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value)
  }
  Object.defineProperty(globalThis, 'window', { value: { localStorage: storage }, configurable: true })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
})

describe('import sheet prefs', () => {
  it('defaults to a topic folder at the top of the library', () => {
    stubStorage({})
    expect(readImportSheetPrefs()).toEqual({ parent: '', topicFolder: true, byGroup: true, owned: 'keep' })
  })

  it('round-trips the saved choice', () => {
    stubStorage({})
    writeImportSheetPrefs({ parent: 'qa', topicFolder: false, byGroup: false, owned: 'move' })
    expect(readImportSheetPrefs()).toEqual({ parent: 'qa', topicFolder: false, byGroup: false, owned: 'move' })
  })

  it('reads the v1 new/existing choice', () => {
    stubStorage({ 'kun.paper.importSheet.v1': JSON.stringify({ mode: 'existing', existing: 'nlp/agents', owned: 'move' }) })
    expect(readImportSheetPrefs()).toMatchObject({ parent: 'nlp/agents', topicFolder: false, owned: 'move' })
    stubStorage({ 'kun.paper.importSheet.v1': JSON.stringify({ mode: 'new', existing: 'ignored' }) })
    expect(readImportSheetPrefs()).toMatchObject({ parent: '', topicFolder: true })
  })
})
