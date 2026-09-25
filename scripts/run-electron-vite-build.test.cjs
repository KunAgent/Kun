'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { heapArgs } = require('./run-electron-vite-build.cjs')

test('electron-vite build wrapper applies the default heap cap', () => {
  assert.deepEqual(heapArgs({}), ['--max-old-space-size=6144'])
  assert.deepEqual(heapArgs({ NODE_OPTIONS: '--inspect' }), ['--max-old-space-size=6144'])
})

test('electron-vite build wrapper respects a caller-provided heap cap', () => {
  assert.deepEqual(heapArgs({ NODE_OPTIONS: '--max-old-space-size=4096' }), [])
  assert.deepEqual(
    heapArgs({ NODE_OPTIONS: '--inspect --max-old-space-size=8192' }),
    []
  )
})
