'use strict'
const assert = require('node:assert/strict')
const { resolve } = require('node:path')
const test = require('node:test')
const { startGui } = require('./smoke-gui-upgrade.cjs')

function fixture(profile) {
  const state = { closed: false, options: undefined }
  const page = { evaluate: async () => true }
  const app = {
    evaluate: async (operation) => operation({ app: { getPath: () => profile } }),
    windows: () => [page],
    close: async () => { state.closed = true }
  }
  const launch = async (options) => { state.options = options; return app }
  return { state, launch, app, page }
}

test('GUI acceptance uses the default profile preserved by argument-free installer relaunch', async () => {
  const profile = resolve('fixture-default-profile')
  const stub = fixture(profile)
  const environment = { HOME: 'disposable-ci-account' }
  const opened = await startGui('fixture-executable', environment, profile, stub.launch)
  assert.deepEqual(stub.state.options.args, [])
  assert.equal(stub.state.options.env, environment)
  assert.equal(opened.page, stub.page)
  assert.equal(stub.state.closed, false)
})

test('GUI acceptance rejects and closes an app using another profile', async () => {
  const stub = fixture(resolve('unexpected-profile'))
  await assert.rejects(startGui('fixture-executable', {}, resolve('expected-profile'), stub.launch),
    /same default profile/)
  assert.equal(stub.state.closed, true)
})
