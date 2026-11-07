const { spawnSync } = require('node:child_process')
// Public publisher identity, shared by existing production Kun permissions.
const DEFAULT_MAC_SIGNING_TEAM_ID = 'YBR76S5LNP'

function macSigningEnabled(env = process.env, flavor = env.KUN_APP_FLAVOR || 'production') {
  const explicit = Boolean(env.CSC_LINK || env.CSC_NAME || env.CSC_KEY_PASSWORD || env.MAC_SIGN === '1')
  if (env.KUN_MAC_ALLOW_ADHOC === '1' && explicit) {
    throw new Error('KUN_MAC_ALLOW_ADHOC conflicts with Developer ID signing credentials.')
  }
  return explicit || (flavor !== 'development' && env.KUN_MAC_ALLOW_ADHOC !== '1')
}

function assertMacSigningConfiguration(context, env = process.env) {
  if (!['darwin', 'mac'].includes(context.electronPlatformName)) return
  const config = context.packager?.config ?? {}
  const flavor = config.extraMetadata?.kunAppFlavor || env.KUN_APP_FLAVOR || 'production'
  if (!macSigningEnabled(env, flavor)) return
  const mac = config.mac ?? {}
  if (mac.identity === null || mac.identity === '-' || mac.forceCodeSigning === false || mac.hardenedRuntime === false) {
    throw new Error('Production Kun requires Developer ID signing to preserve macOS permissions. Use the development flavor for disposable ad-hoc builds.')
  }
  if (env.CSC_IDENTITY_AUTO_DISCOVERY === 'false' && !env.CSC_NAME && !env.CSC_LINK) {
    throw new Error('Developer ID discovery is disabled. Set CSC_NAME or enable discovery; production Kun must not silently fall back to ad-hoc signing.')
  }
}

function validateMacSignature(details, requirement, bundleId, expectedTeam) {
  const team = /^TeamIdentifier=(.+)$/m.exec(details)?.[1]
  const designatedRequirement = /^designated => .+$/m.exec(requirement)?.[0] || ''
  if (!/^Authority=Developer ID Application:/m.test(details) || !team || team === 'not set' || /^Signature=adhoc$/m.test(details)) {
    throw new Error('Kun has no stable Developer ID signature; installing this package can invalidate saved macOS permissions.')
  }
  if (expectedTeam && team !== expectedTeam) throw new Error('Kun signing Team ID does not match KUN_MAC_SIGNING_TEAM_ID.')
  if (!/^Timestamp=/m.test(details)) throw new Error('Kun Developer ID signature must include a secure timestamp.')
  if (bundleId && !details.split(/\r?\n/).includes(`Identifier=${bundleId}`)) throw new Error('Kun signing bundle identifier does not match the package configuration.')
  if (/\bcdhash\b/.test(designatedRequirement) || !designatedRequirement.includes('identifier ') ||
      !designatedRequirement.includes('anchor apple generic') || !designatedRequirement.includes(`certificate leaf[subject.OU] = ${team}`)) {
    throw new Error('Kun designated requirement is not stable across builds.')
  }
  return { team, requirement: designatedRequirement }
}

function verifyMacAppSigning(appPath, { bundleId, flavor, env = process.env } = {}) {
  if (!macSigningEnabled(env, flavor)) return null
  const run = args => {
    const result = spawnSync('/usr/bin/codesign', args, { encoding: 'utf8' })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`Kun code signature verification failed: ${result.stderr || result.stdout}`)
    return `${result.stdout || ''}${result.stderr || ''}`
  }
  run(['--verify', '--deep', '--strict', appPath])
  return validateMacSignature(run(['--display', '--verbose=4', appPath]), run(['-d', '-r-', appPath]), bundleId,
    env.KUN_MAC_SIGNING_TEAM_ID || DEFAULT_MAC_SIGNING_TEAM_ID)
}

module.exports = { macSigningEnabled, assertMacSigningConfiguration, validateMacSignature, verifyMacAppSigning }
