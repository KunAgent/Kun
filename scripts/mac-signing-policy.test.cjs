const { test } = require('node:test')
const assert = require('node:assert/strict')
const { macSigningEnabled, assertMacSigningConfiguration, validateMacSignature } = require('./mac-signing-policy.cjs')

test('ordinary production builds require a stable Developer ID without extra environment flags', () => {
  assert.equal(macSigningEnabled({}), true)
  assert.equal(macSigningEnabled({ MAC_SIGN: '0' }), true)
  assert.equal(macSigningEnabled({ CSC_IDENTITY_AUTO_DISCOVERY: 'false' }), true)
})

test('only explicit CI opt-out or the separate development flavor allows ad-hoc signing', () => {
  assert.equal(macSigningEnabled({ KUN_MAC_ALLOW_ADHOC: '1' }), false)
  assert.equal(macSigningEnabled({ KUN_APP_FLAVOR: 'development' }), false)
  assert.equal(macSigningEnabled({ CSC_NAME: 'Publisher', KUN_APP_FLAVOR: 'development' }), true)
  assert.throws(() => macSigningEnabled({ CSC_NAME: 'Publisher', KUN_MAC_ALLOW_ADHOC: '1' }), /conflicts/)
})

const context = mac => ({ electronPlatformName: 'darwin', packager: { config: { mac } } })
test('rejects accidental disabled signing before packaging starts', () => {
  for (const mac of [{ identity: null }, { identity: '-' }, { forceCodeSigning: false }, { hardenedRuntime: false }]) {
    assert.throws(() => assertMacSigningConfiguration(context(mac), {}), /requires Developer ID/)
  }
  assert.throws(() => assertMacSigningConfiguration(context({}), { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }), /discovery is disabled/)
  assert.doesNotThrow(() => assertMacSigningConfiguration(context({}), { CSC_NAME: 'Publisher', CSC_IDENTITY_AUTO_DISCOVERY: 'false' }))
  assert.doesNotThrow(() => assertMacSigningConfiguration(context({ identity: null }), { KUN_MAC_ALLOW_ADHOC: '1' }))
  assert.doesNotThrow(() => assertMacSigningConfiguration({ electronPlatformName: 'win32' }, {}))
})

const details = 'Identifier=com.example.kun\nAuthority=Developer ID Application: Publisher (TEAM123)\nTeamIdentifier=TEAM123\nTimestamp=Nov 5, 2026\n'
const requirement = 'designated => identifier "com.example.kun" and anchor apple generic and certificate leaf[subject.OU] = TEAM123'
test('accepts a Developer ID identity that can survive a rebuild', () => {
  assert.equal(validateMacSignature(details, requirement, 'com.example.kun', 'TEAM123').team, 'TEAM123')
  assert.equal(validateMacSignature(details, `${requirement}\nExecutable=/a/different/path/Kun`, 'com.example.kun').requirement, requirement)
})

test('rejects ad-hoc, wrong team, missing timestamp and hash-pinned artifacts', () => {
  assert.throws(() => validateMacSignature('Signature=adhoc\nTeamIdentifier=not set', 'cdhash H"123"'), /no stable/)
  assert.throws(() => validateMacSignature(details, requirement, 'com.example.kun', 'OTHERTEAM'), /Team ID/)
  assert.throws(() => validateMacSignature(details.replace(/Timestamp=.*\n/, ''), requirement), /timestamp/)
  assert.throws(() => validateMacSignature(details, 'designated => cdhash H"123"'), /stable across/)
  assert.throws(() => validateMacSignature(details, 'identifier "com.example.kun" and info[team] = TEAM123'), /stable across/)
  assert.throws(() => validateMacSignature(details, requirement, 'com.example.other'), /bundle identifier/)
})
