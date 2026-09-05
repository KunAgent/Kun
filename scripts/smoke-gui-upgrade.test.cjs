'use strict'
const assert = require('node:assert/strict')
const { resolve } = require('node:path')
const test = require('node:test')
const { startGui, prepareReleasedGuiUpdate } = require('./smoke-gui-upgrade.cjs')

function fixture(profile, phases = ['ready']) {
  const state = { closed: false, options: undefined, startupReads: 0 }
  let bridgeRead = false
  const page = { evaluate: async () => {
    if (!bridgeRead) { bridgeRead = true; return true }
    state.startupReads++
    return { phase: phases.shift() || 'ready' }
  } }
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

test('GUI acceptance waits for Runtime startup after the preload bridge appears', async () => {
  const profile = resolve('fixture-default-profile')
  const stub = fixture(profile, ['runtime_starting', 'ready'])
  await startGui('fixture-executable', {}, profile, stub.launch)
  assert.equal(stub.state.startupReads, 2)
})

test('startup recovery is reported immediately and the launched fixture is closed', async () => {
  const profile = resolve('fixture-default-profile')
  const stub = fixture(profile, ['recovery_required'])
  await assert.rejects(startGui('fixture-executable', {}, profile, stub.launch), /startup requires recovery/)
  assert.equal(stub.state.closed, true)
  assert.equal(stub.state.startupReads, 1)
})


test('released 0.3.7 uses the real Providers view before requesting an upgrade', async () => {
  const calls = []
  const record = {}
  const page = {
    getByRole: (role, options) => ({ click: async () => calls.push([role, options.name]) }),
    locator: selector => ({ click: async () => calls.push(['click', selector]) }),
    getByTestId: id => ({ waitFor: async options => calls.push(['visible', id, options.state]) }),
    evaluate: async operation => {
      const { runInNewContext } = require('node:vm')
      let frames = 0
      await runInNewContext(`(${operation.toString()})()`, {
        requestAnimationFrame: callback => { frames++; callback() }
      })
      assert.equal(frames, 2)
      calls.push(['effects-settled'])
    }
  }
  assert.equal(await prepareReleasedGuiUpdate(page, '0.3.7', record), true)
  assert.deepEqual(calls, [['button', 'Settings'], ['click', '[data-settings-category="providers"]'],
    ['visible', 'provider-workspace-meta', 'visible'], ['effects-settled']])
  assert.deepEqual(record.legacyUpdatePreparation, { sourceVersion: '0.3.7', settingsCategory: 'providers' })
})

test('new GUI versions do not acquire a legacy settings-view prerequisite', async () => {
  const record = {}
  assert.equal(await prepareReleasedGuiUpdate({}, '0.3.8', record), false)
  assert.deepEqual(record, {})
})

test('failure to open the legacy Providers view fails the upgrade preparation', async () => {
  const record = {}
  const page = { getByRole: () => ({ click: async () => { throw new Error('Settings is unavailable') } }) }
  await assert.rejects(prepareReleasedGuiUpdate(page, '0.3.7', record), /Settings is unavailable/)
  assert.deepEqual(record, {})
})
