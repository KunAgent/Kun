import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)

test('packages managed expert and design resources under kun-extensions', () => {
  const config = require('../electron-builder.config.cjs')
  const resources = Array.isArray(config.extraResources) ? config.extraResources : []
  const targets = resources
    .map((entry) => entry?.to)
    .filter((value) => typeof value === 'string')

  assert.ok(targets.includes('kun-extensions/experts'))
  assert.ok(targets.includes('kun-extensions/design'))

  const experts = resources.find((entry) => entry?.to === 'kun-extensions/experts')
  const design = resources.find((entry) => entry?.to === 'kun-extensions/design')
  assert.deepEqual(experts?.filter, ['plugins/**/*'])
  assert.deepEqual(design?.filter, [
    'design_libraries/**/*',
    'runtime-skills/**/*',
    'skills/**/*'
  ])
})
