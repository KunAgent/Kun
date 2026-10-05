import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type SanottsDictionaryModule = {
  FS: {
    mkdirTree: (path: string) => void
    writeFile: (path: string, data: Uint8Array) => void
    unlink: (path: string) => void
  }
  cwrap: (ident: string, returnType: string, argTypes: string[]) => (...args: unknown[]) => number
}

const RUSSIAN_DICTIONARY_FILES = ['ru_rules', 'ru_list', 'ru_emoji', 'ru_listx'] as const

/** One instance belongs to one G2P runtime; resetting the runtime discards it. */
export class SanottsRussianDictionary {
  private loadedDir: string | null = null

  constructor(private readonly g2p: SanottsDictionaryModule) {}

  /** Compile the complete, pinned eSpeak 1.52 dictionary once for offline Russian. */
  async prepare(voiceDir: string): Promise<void> {
    if (this.loadedDir === voiceDir) return
    const sourceDir = '/kun-russian-dictionary/'
    this.g2p.FS.mkdirTree(sourceDir)
    try {
      for (const fileName of RUSSIAN_DICTIONARY_FILES) {
        const source = await readFile(join(voiceDir, fileName)).catch(() => {
          throw new Error(`Russian pronunciation dictionary is not downloaded: ${fileName}`)
        })
        this.g2p.FS.writeFile(`${sourceDir}${fileName}`, source)
      }
      const compile = this.g2p.cwrap(
        'espeak_ng_CompileDictionary', 'number', ['string', 'string', 'number', 'number', 'number']
      )
      const rc = compile(sourceDir, 'ru', 0, 0, 0)
      if (rc !== 0) throw new Error(`Russian pronunciation dictionary compilation failed: ${rc}`)
      this.loadedDir = voiceDir
    } finally {
      // Keep the compiled dictionary, but release its 23 MB source from the WASM filesystem.
      for (const fileName of RUSSIAN_DICTIONARY_FILES) {
        try { this.g2p.FS.unlink(`${sourceDir}${fileName}`) } catch { /* Not staged if loading failed. */ }
      }
    }
  }
}

/** Duration is inverse to playback speed: 2x must use half the base length. */
export function sanottsLengthScale(speed: number, baseLengthScale: unknown): number {
  return (Number(baseLengthScale) || 1) / Math.min(2, Math.max(0.5, speed))
}
