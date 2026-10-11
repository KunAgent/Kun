import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  SanottsRussianDictionary, sanottsLengthScale, type SanottsDictionaryModule
} from './local-sanotts-worker-language'

vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }))

function dictionaryFixture(): {
  module: SanottsDictionaryModule
  compile: ReturnType<typeof vi.fn>
  dictionary: SanottsRussianDictionary
} {
  const compile = vi.fn(() => 0)
  const module: SanottsDictionaryModule = {
    FS: { mkdirTree: vi.fn(), writeFile: vi.fn(), unlink: vi.fn() },
    cwrap: vi.fn(() => compile)
  }
  return { module, compile, dictionary: new SanottsRussianDictionary(module) }
}

describe('sanoTTS offline Russian dictionary', () => {
  beforeEach(() => { vi.mocked(readFile).mockResolvedValue(Buffer.from('dictionary source')) })
  afterEach(() => { vi.resetAllMocks() })

  it('stages all four sources, compiles once, and releases the source buffers', async () => {
    const { module, compile, dictionary } = dictionaryFixture()
    await dictionary.prepare('/voices/russian')
    await dictionary.prepare('/voices/russian')

    expect(readFile).toHaveBeenCalledTimes(4)
    expect(readFile).toHaveBeenCalledWith(join('/voices/russian', 'ru_listx'))
    expect(module.FS.writeFile).toHaveBeenCalledTimes(4)
    expect(module.cwrap).toHaveBeenCalledWith(
      'espeak_ng_CompileDictionary', 'number', ['string', 'string', 'number', 'number', 'number']
    )
    expect(compile).toHaveBeenCalledExactlyOnceWith('/kun-russian-dictionary/', 'ru', 0, 0, 0)
    expect(module.FS.unlink).toHaveBeenCalledTimes(4)
  })

  it('compiles again for a replacement runtime or a different voice directory', async () => {
    const { module, compile, dictionary } = dictionaryFixture()
    await dictionary.prepare('/voices/russian')
    await dictionary.prepare('/replacement/russian')
    await new SanottsRussianDictionary(module).prepare('/replacement/russian')
    expect(compile).toHaveBeenCalledTimes(3)
  })

  it('fails closed if a dictionary source is missing, and permits a later retry', async () => {
    const { module, compile, dictionary } = dictionaryFixture()
    vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'))
    await expect(dictionary.prepare('/voices/russian')).rejects.toThrow(
      'Russian pronunciation dictionary is not downloaded: ru_rules'
    )
    expect(compile).not.toHaveBeenCalled()
    expect(module.FS.unlink).toHaveBeenCalledTimes(4)
    await dictionary.prepare('/voices/russian')
    expect(compile).toHaveBeenCalledTimes(1)
  })

  it('does not cache failed compilation or retain its staged source files', async () => {
    const { module, compile, dictionary } = dictionaryFixture()
    compile.mockReturnValueOnce(7)
    await expect(dictionary.prepare('/voices/russian')).rejects.toThrow('compilation failed: 7')
    expect(module.FS.unlink).toHaveBeenCalledTimes(4)
    await dictionary.prepare('/voices/russian')
    expect(compile).toHaveBeenCalledTimes(2)
  })
})

describe('sanoTTS speed conversion', () => {
  it('shortens higher-speed speech while preserving the voice base length', () => {
    expect(sanottsLengthScale(1, 1.2)).toBe(1.2)
    expect(sanottsLengthScale(2, 1.2)).toBe(0.6)
    expect(sanottsLengthScale(0.5, 1.2)).toBe(2.4)
    expect(sanottsLengthScale(1.5, 1)).toBeLessThan(sanottsLengthScale(0.8, 1))
  })

  it('clamps speeds and defaults missing length metadata', () => {
    expect(sanottsLengthScale(0.1, undefined)).toBe(2)
    expect(sanottsLengthScale(8, undefined)).toBe(0.5)
  })
})
