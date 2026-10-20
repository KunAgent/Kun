#!/usr/bin/env node
// Build the built-in canvas MCP App page into out/canvas-app. Development
// starts skip the build when the output is newer than every source file.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const sourceDir = join(root, 'src', 'canvas-app')
const output = join(root, 'out', 'canvas-app', 'index.html')
const inputs = [
  join(root, 'vite.canvas-app.config.ts'),
  join(root, 'package-lock.json')
]

function newestMtime(path) {
  const info = statSync(path)
  if (!info.isDirectory()) return info.mtimeMs
  let newest = info.mtimeMs
  for (const entry of readdirSync(path)) newest = Math.max(newest, newestMtime(join(path, entry)))
  return newest
}

const force = process.argv.includes('--force')
if (!force && existsSync(output)) {
  const sourceTime = Math.max(newestMtime(sourceDir), ...inputs.filter(existsSync).map(newestMtime))
  if (statSync(output).mtimeMs >= sourceTime) {
    console.log('[canvas-app] up to date')
    process.exit(0)
  }
}

const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const result = spawnSync(process.execPath, [vite, 'build', '--config', 'vite.canvas-app.config.ts', '--logLevel', 'warn'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=4096`.trim() }
})
process.exit(result.status ?? 1)
