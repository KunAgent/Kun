import test from 'node:test'
import assert from 'node:assert/strict'
import { npmBuildSettings } from './npm-version.mjs'

test('npm prerelease identity overrides inherited build metadata without changing the source version', () => {
  const inherited = { KUN_APP_VERSION: '9.9.9', KUN_UPDATE_CHANNEL: 'stable', HOME: '/unchanged' }
  const result = npmBuildSettings({ version: '0.4.5-rc.1' }, '0.4.5', inherited)
  assert.equal(result.version, '0.4.5-rc.1')
  assert.equal(result.runtimeSourceVersion, '0.4.5')
  assert.equal(result.channel, 'frontier')
  for (const name of ['KUN_APP_VERSION', 'KUN_RELEASE_VERSION', 'KUN_ARTIFACT_VERSION'])
    assert.equal(result.env[name], result.version)
  assert.equal(result.env.HOME, inherited.HOME)
  assert.equal(inherited.KUN_APP_VERSION, '9.9.9')
})

test('legacy stable candidates retain the source version and invalid or unrelated release lines fail', () => {
  assert.equal(npmBuildSettings({}, '0.4.5', {}).version, '0.4.5')
  for (const version of ['0.4.6-rc.1', '0.4.5-01', '0.4.5-rc..1', 'invalid'])
    assert.throws(() => npmBuildSettings({ version }, '0.4.5', {}))
})
