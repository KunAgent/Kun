import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { expect, it } from 'vitest'

it.each(['out/main', 'out/main/chunks'].flatMap((layout) =>
  [{ tampered: false, packaged: false }, { tampered: true, packaged: false }, { tampered: false, packaged: true }]
    .map((scenario) => ({ layout, ...scenario }))))(
  'validates $layout helpers (tampered=$tampered, packaged=$packaged)', async ({ layout, tampered, packaged }) => {
  const root = await mkdtemp(join(tmpdir(), 'kun-startup-layout-'))
  const resources = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  try {
    if (packaged) {
      const resourcesPath = join(root, 'resources')
      await mkdir(resourcesPath, { recursive: true })
      await writeFile(join(resourcesPath, 'app.asar'), 'packaged-app')
      Object.defineProperty(process, 'resourcesPath', { value: resourcesPath, configurable: true })
    }
    const native = join(root, 'kun', 'dist', 'native', `win32-${process.arch}`)
    await mkdir(native, { recursive: true })
    const hashes: Record<string, string> = {}
    for (const name of ['kun_windows_startup.node', 'kun-owned-launcher.exe']) {
      await writeFile(join(native, name), name)
      hashes[name] = createHash('sha256').update(name).digest('hex')
    }
    await writeFile(join(native, 'manifest.json'), JSON.stringify({ version: 1, arch: process.arch, files: hashes }))
    if (tampered) await writeFile(join(native, 'kun_windows_startup.node'), 'tampered')
    const output = join(root, layout, 'windows-startup.mjs')
    await mkdir(dirname(output), { recursive: true })
    // Exercise the actual bundled import.meta directory, not source-module path arithmetic.
    await build({ entryPoints: [fileURLToPath(new URL('./windows-startup-native.ts', import.meta.url))],
      outfile: output, platform: 'node', format: 'esm', bundle: true, logLevel: 'silent' })
    const loader = await import(/* @vite-ignore */ pathToFileURL(output).href) as { windowsStartupDirectory: () => string }
    if (tampered || packaged) expect(loader.windowsStartupDirectory).toThrow('Repair or reinstall')
    else expect(loader.windowsStartupDirectory()).toBe(native)
  } finally {
    if (resources) Object.defineProperty(process, 'resourcesPath', resources)
    else delete (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    await rm(root, { recursive: true, force: true })
  }
})
