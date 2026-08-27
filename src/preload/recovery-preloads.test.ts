import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const FORBIDDEN_PRELOAD_SURFACE = [
  'runtimeRequest',
  'settings:set',
  'credential:reveal',
  'uninstall:',
  'cli-install',
  'schedule:',
  'plugin',
  'skill'
] as const

describe('minimal recovery preloads', () => {
  it('exposes only the storage relocation recovery bridge', async () => {
    const source = await readFile(new URL('./storage-relocation-recovery.ts', import.meta.url), 'utf8')

    expect(source).toContain("exposeInMainWorld('kunStorageRelocationRecovery'")
    expect(source).not.toContain("exposeInMainWorld('kunGui'")
    expect(source).not.toContain("from './index'")
    for (const capability of FORBIDDEN_PRELOAD_SURFACE) expect(source).not.toContain(capability)
  })

  it('exposes only the Runtime data recovery bridge', async () => {
    const source = await readFile(new URL('./runtime-data-recovery.ts', import.meta.url), 'utf8')

    expect(source).toContain("exposeInMainWorld('kunRuntimeDataRecovery'")
    expect(source).not.toContain("exposeInMainWorld('kunGui'")
    expect(source).not.toContain("from './index'")
    for (const capability of FORBIDDEN_PRELOAD_SURFACE) expect(source).not.toContain(capability)
  })
})
