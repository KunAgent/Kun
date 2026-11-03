import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fuzzyFilter, SlashPathAutocompleteProvider } from './autocomplete.js'

const signal = new AbortController().signal
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('fuzzyFilter', () => {
  it('ranks prefix and word-boundary matches first and prefers shorter names on ties', () => {
    const names = ['continue', 'connect', 'context', 'compact']
    expect(fuzzyFilter(names, 'con', (name) => name).slice(0, 3)).toEqual(['connect', 'context', 'continue'])
    expect(fuzzyFilter(names, 'cpt', (name) => name)).toEqual(['compact'])
    expect(fuzzyFilter(names, 'zzz', (name) => name)).toEqual([])
  })
})

describe('SlashPathAutocompleteProvider', () => {
  const commands = [{ name: 'connect', description: 'add a provider' }, { name: 'rename', argumentHint: '<title>' }]

  it('offers slash commands only at the start of the first line', async () => {
    const provider = new SlashPathAutocompleteProvider(commands, '/tmp')
    const suggestions = await provider.getSuggestions(['/con'], 0, 4, { signal })
    expect(suggestions?.items[0]).toMatchObject({ value: 'connect', description: 'add a provider' })
    expect(await provider.getSuggestions(['/connect now'], 0, 12, { signal })).toBeNull()
    expect(await provider.getSuggestions(['text', '/con'], 1, 4, { signal })).toBeNull()

    const applied = provider.applyCompletion(['/con'], 0, 4, suggestions!.items[0]!, '/con')
    expect(applied).toEqual({ lines: ['/connect '], cursorLine: 0, cursorCol: 9 })
  })

  it('completes relative paths, listing directories first', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-autocomplete-'))
    roots.push(root)
    await mkdir(join(root, 'src'))
    await writeFile(join(root, 'setup.md'), '')
    const provider = new SlashPathAutocompleteProvider(commands, root)
    const suggestions = await provider.getSuggestions(['open ./s'], 0, 8, { signal })
    expect(suggestions?.items.map((item) => item.label)).toEqual(['src/', 'setup.md'])
    const applied = provider.applyCompletion(['open ./s'], 0, 8, suggestions!.items[0]!, suggestions!.prefix)
    expect(applied.lines).toEqual(['open ./src/'])
  })
})
