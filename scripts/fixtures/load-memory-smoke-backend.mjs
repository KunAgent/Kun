import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

export async function loadMemorySmokeBackend(entry, directory) {
  const output = join(directory, 'backend.mjs')
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    banner: {
      js: 'import { createRequire as createBundleRequire } from "node:module"; const require = createBundleRequire(import.meta.url);'
    },
    outfile: output
  })
  return import(pathToFileURL(output).href)
}
