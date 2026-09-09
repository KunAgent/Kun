'use strict'
const assert = require('node:assert/strict')
const test = require('node:test')
const { assertPackagedPresetMode } = require('./smoke-packaged-manager-preset.cjs')

test('packaged preset smoke writes through the connect route and rereads both modes', async () => {
  const profiles = []
  const calls = []
  await assertPackagedPresetMode({}, async (_runtime, path, init) => {
    calls.push(path)
    if (init) {
      assert.equal(path, '/v1/model-connections/connect')
      const body = JSON.parse(init.body)
      assert.equal(body.probe, false)
      assert.equal(body.select, false)
      profiles.push(body)
    }
    return { revision: profiles.length, providers: profiles }
  })
  assert.deepEqual(profiles.map((profile) => profile.presetMode), ['api', 'token-plan'])
  assert.equal(calls.length, 6)
})

test('packaged preset smoke fails when a compiled contract drops the field', async () => {
  await assert.rejects(assertPackagedPresetMode({}, async () => ({ revision: 0, providers: [] })), /did not preserve/)
})
