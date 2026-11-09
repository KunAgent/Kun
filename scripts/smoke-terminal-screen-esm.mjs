#!/usr/bin/env node
// Run: node scripts/smoke-terminal-screen-esm.mjs
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { transform } from 'esbuild'
import { TERMINAL_LIMITS } from '@kun/remote-protocol'

const root = fileURLToPath(new URL('../', import.meta.url))

await test('native Node ESM loads full-screen terminal and replays real emulator state', { timeout: 10000 }, async () => {
  // Strip TypeScript only: do not bundle/rewrite dynamic imports through CJS interop.
  // Keep the temporary module under the project so Node resolves installed packages.
  const temporary = await mkdtemp(join(root, '.terminal-screen-esm-'))
  let screen
  let restored
  try {
    const source = await readFile(join(root, 'src/main/remote-terminal/screen.ts'), 'utf8')
    const { code } = await transform(source, { loader: 'ts', format: 'esm', target: 'node20' })
    const entry = join(temporary, 'screen.mjs')
    await writeFile(entry, code)
    const { loadTerminalScreens } = await import(pathToFileURL(entry).href)
    const factory = await loadTerminalScreens()
    assert.equal(factory.fullScreen, true, 'installed xterm dependencies must not silently fall back')
    screen = factory.create(40, 10)
    screen.write('normal buffer')
    screen.write('\u001b[?1049h\u001b[2J\u001b[Htop output\r\nrow two')
    screen.resize(50, 12)
    screen.write('\u001b[H\u001b[2Kedited top')
    const boundary = screen.capture()
    screen.write('\u001b[3;1Hlater output')
    const snapshot = await boundary
    assert.ok(Buffer.byteLength(snapshot, 'utf8') <= TERMINAL_LIMITS.snapshotBytes)
    assert.ok(snapshot.includes('edited top'))
    assert.ok(snapshot.includes('row two'))
    assert.ok(!snapshot.includes('top output'), 'capture must serialize interpreted cursor/erase operations')
    assert.ok(!snapshot.includes('later output'), 'capture excludes later queued writes')
    await screen.flush()
    assert.ok((await screen.capture()).includes('later output'))

    const headless = await import('@xterm/headless')
    const Terminal = headless.Terminal ?? headless.default?.Terminal
    assert.equal(typeof Terminal, 'function')
    restored = new Terminal({ cols: 50, rows: 12, allowProposedApi: true })
    await new Promise(resolve => restored.write(snapshot, resolve))
    assert.equal(restored.buffer.active.type, 'alternate')
    assert.equal(restored.buffer.active.getLine(0).translateToString(true), 'edited top')
    assert.equal(restored.buffer.active.getLine(1).translateToString(true), 'row two')
    await new Promise(resolve => restored.write('\u001b[?1049l', resolve))
    assert.equal(restored.buffer.active.type, 'normal')
    assert.equal(restored.buffer.active.getLine(0).translateToString(true), 'normal buffer')
  } finally {
    screen?.dispose()
    restored?.dispose()
    await rm(temporary, { recursive: true, force: true })
  }
})
