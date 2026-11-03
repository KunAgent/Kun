#!/usr/bin/env node
// Lists node_modules packages that the Electron main process loads eagerly,
// i.e. reachable from the desktop entry through static imports or require()
// calls (dynamic import() edges are treated as lazy). Packages listed in
// MAIN_LAZY_PACKAGES must stay off that list; a regression fails the check.
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entry = resolve(root, 'src/main/main-desktop-entry.ts')

/** Heavy packages that only specific features need. */
export const MAIN_LAZY_PACKAGES = [
  '@larksuiteoapi/node-sdk',
  'html-to-docx',
  'react-dom',
  'katex',
  'rehype-katex',
  'ssh2',
  'node-pty',
  'sharp',
  'electron-updater',
  'pdfjs-dist',
  'xlsx',
  'tesseract.js',
  '@napi-rs/canvas',
  '@trycua/cua-driver',
  '@modelcontextprotocol/sdk',
  '@google/design.md',
  'tar-stream',
  'yauzl',
  'yazl'
]

function packageName(path) {
  if (path.startsWith('node:') || !/^[@a-z0-9]/iu.test(path)) return null
  const parts = path.split('/')
  return path.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

const result = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  metafile: true,
  logLevel: 'silent',
  packages: 'external',
  external: ['electron'],
  loader: { '.node': 'empty', '.png': 'empty', '.webp': 'empty', '.svg': 'empty', '.html': 'text', '.md': 'text' },
  alias: { '@shared': resolve(root, 'src/shared') }
})

const inputs = result.metafile.inputs
const relEntry = Object.keys(inputs).find((key) => resolve(root, key) === entry)
const seen = new Set([relEntry])
const queue = [relEntry]
const eager = new Map()
while (queue.length) {
  const current = queue.pop()
  for (const edge of inputs[current]?.imports ?? []) {
    if (edge.kind === 'dynamic-import') continue
    if (edge.external) {
      const name = packageName(edge.path)
      if (name && name !== 'electron') {
        if (!eager.has(name)) eager.set(name, current)
      }
      continue
    }
    if (!seen.has(edge.path)) { seen.add(edge.path); queue.push(edge.path) }
  }
}

const verbose = process.argv.includes('--list')
if (verbose) {
  console.log(`main eager closure: ${seen.size} source files, ${eager.size} packages`)
  for (const [name, via] of [...eager.entries()].sort()) console.log(`  ${name.padEnd(36)} via ${via}`)
}
const violations = MAIN_LAZY_PACKAGES.filter((name) => eager.has(name))
if (violations.length) {
  console.error('Heavy packages are loaded eagerly by the Electron main process:')
  for (const name of violations) console.error(`  ${name} (first imported by ${eager.get(name)})`)
  console.error('Load them with a dynamic import() at the feature that needs them.')
  process.exit(1)
}
if (!verbose) console.log(`main eager dependency check passed (${eager.size} packages, ${seen.size} files)`)
