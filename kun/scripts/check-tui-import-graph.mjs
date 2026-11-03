#!/usr/bin/env node
// The terminal UI runs `dist/cli/serve-entry.js tui` on a separate Node 26
// interpreter (opentui needs node:ffi). Packaged native addons are compiled
// for Electron's ABI, so nothing reachable through static imports from that
// entry may load one; such modules must stay behind dynamic imports on the
// Runtime side.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const kunRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entries = ['dist/cli/serve-entry.js', 'dist/tui/app/main.js']
const NATIVE_PACKAGES = [/^better-sqlite3$/u, /^node-pty$/u, /^@computer-use\//u, /^@napi-rs\//u, /^sharp$/u, /^bindings$/u]
const IMPORT = /(?:^|[;\n}])\s*(?:import|export)\s*(?:[^'"\n;]*?\sfrom\s*)?['"]([^'"]+)['"]/gu

const visited = new Set()
const violations = []

function visit(file) {
  if (visited.has(file)) return
  visited.add(file)
  for (const match of readFileSync(file, 'utf8').matchAll(IMPORT)) {
    const specifier = match[1]
    if (specifier.startsWith('.')) {
      const target = resolve(dirname(file), specifier)
      if (existsSync(target)) visit(target)
    } else if (NATIVE_PACKAGES.some((pattern) => pattern.test(specifier))) {
      violations.push(`${relative(kunRoot, file)} imports ${specifier}`)
    }
  }
}

for (const entry of entries) {
  const path = join(kunRoot, entry)
  if (!existsSync(path)) {
    console.error(`[tui-import-graph] missing ${entry}; run the kun build first`)
    process.exit(1)
  }
  visit(path)
}

if (violations.length) {
  console.error('[tui-import-graph] native addons are statically reachable from the TUI entry:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}
console.log(`[tui-import-graph] ${visited.size} modules checked; no native addons reachable from the TUI entry.`)
