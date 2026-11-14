import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, relative, resolve, sep } from 'node:path'
import { runtimeFile } from './npm-files.mjs'

const { init, parse } = createRequire(import.meta.url)('es-module-lexer')

// These entrypoints are launched by worker_threads/spawn, not module import.
export const runtimeRoots = [
  'cli/serve-entry.js', 'manager/manager-entry.js', 'tui/app/main.js',
  'cli/runtime-heartbeat-worker.js', 'process/owned-process-guard.js',
  'manager/usage-query-worker.js', 'extensions/host-runner.js'
]

export async function runtimeClosure(directory, roots = runtimeRoots) {
  const root = resolve(directory)
  const paths = new Set(['runtime-build.json'])
  const queue = [...roots]
  await init
  while (queue.length) {
    const path = queue.shift()
    if (paths.has(path)) continue
    assert(runtimeFile(path, false), `Runtime imports development-only file: ${path}`)
    const source = await readFile(resolve(root, path), 'utf8')
    paths.add(path)
    const imports = parse(source)[0].filter((entry) => entry.n?.startsWith('.')).map((entry) => entry.n)
    const urls = [...source.matchAll(/new URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)]
      .map((match) => match[1]).filter((value) => value.startsWith('.') && /\.(?:js|mjs|cjs|json|wasm|node|exe)$/.test(value))
    for (const specifier of [...imports, ...urls]) {
      const target = resolve(dirname(resolve(root, path)), specifier)
      if (target === resolve(root, '../package.json')) continue
      assert(target.startsWith(root + sep), `Runtime resource escapes dist: ${path} -> ${specifier}`)
      const label = relative(root, target).split(sep).join('/')
      const exists = await access(target).then(() => true, (error) => {
        if (error.code === 'ENOENT') return false
        throw error
      })
      // OAuth client resources are optional and can be absent in API-key builds.
      if (!exists && /resources\/(?:gmail-native-client|github-app-client)\.json$/.test(label)) continue
      assert(exists, `Missing emitted Runtime resource: ${path} -> ${specifier}`)
      if (/\.(?:js|mjs|cjs)$/.test(label)) queue.push(label)
      else if (!paths.has(label)) paths.add(label)
    }
  }
  return paths
}
