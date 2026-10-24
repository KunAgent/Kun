import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'

const contextTest = 'src/adapters/hybrid/hybrid-memory-context.test.ts'
const ordinaryTest = 'src/memory/memory-relation-pagination.test.ts'

// Execute the real routing script in an isolated process. Simulate only ABI
// availability and child launches: never rebuild or replace installed addons.
function route(requested, mismatched = true) {
  const runner = new URL('./run-tests.mjs', import.meta.url).href
  const source = `
    import Module, { syncBuiltinESMExports } from 'node:module'
    import cp from 'node:child_process'
    const load = Module._load
    Module._load = function (id, ...args) {
      if (id === 'better-sqlite3') {
        if (${JSON.stringify(mismatched)}) throw new Error('NODE_MODULE_VERSION mismatch')
        return class Database { close() {} }
      }
      if (id === 'electron') return process.execPath
      return load.call(this, id, ...args)
    }
    cp.spawnSync = (executable, args, options) => {
      process.stdout.write(JSON.stringify({ args: args.slice(2), electron: options.env.ELECTRON_RUN_AS_NODE === '1' }) + '\\n')
      return { status: 0 }
    }
    syncBuiltinESMExports()
    process.argv = [process.execPath, 'run-tests.mjs', ...${JSON.stringify(requested)}]
    await import(${JSON.stringify(runner)})
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' }
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim().split('\n').map((line) => JSON.parse(line))
}

test('full ABI-mismatched run excludes Hybrid context from Node and includes it in Electron', () => {
  const calls = route([])
  assert.equal(calls.length, 2)
  assert.equal(calls[0].electron, false)
  const index = calls[0].args.indexOf(contextTest)
  assert.ok(index > 0)
  assert.equal(calls[0].args[index - 1], '--exclude')
  assert.equal(calls[1].electron, true)
  assert.ok(calls[1].args.includes(contextTest))
})

test('explicit mixed requests keep ordinary tests on Node and route Hybrid context to Electron', () => {
  assert.deepEqual(route([contextTest, ordinaryTest, '--reporter=verbose']), [
    { args: [ordinaryTest, '--reporter=verbose'], electron: false },
    { args: [contextTest, '--reporter=verbose'], electron: true }
  ])
})

test('matching Node ABI uses the normal single-run path', () => {
  assert.deepEqual(route([contextTest, ordinaryTest], false), [
    { args: [contextTest, ordinaryTest], electron: false }
  ])
})

test('an ordinary focused request does not launch Electron', () => {
  assert.deepEqual(route([ordinaryTest]), [{ args: [ordinaryTest], electron: false }])
})
