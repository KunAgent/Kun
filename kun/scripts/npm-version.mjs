import assert from 'node:assert/strict'

export function npmBuildSettings(descriptor, sourceVersion, inherited = process.env) {
  const version = descriptor.version ?? sourceVersion
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(version)
  assert(match && (!match[4] || match[4].split('.').every(part =>
    !/^\d+$/.test(part) || part === '0' || !part.startsWith('0'))), 'Invalid npm candidate version')
  assert.equal(version.split('-')[0], sourceVersion.split('-')[0],
    'The npm candidate must use the current Runtime source release line')
  const channel = descriptor.channel ?? (match[4] ? 'frontier' : 'stable')
  assert(['stable', 'frontier'].includes(channel), 'Invalid npm candidate channel')
  return { version, runtimeSourceVersion: sourceVersion, channel, env: { ...inherited,
    KUN_APP_VERSION: version, KUN_RELEASE_VERSION: version, KUN_ARTIFACT_VERSION: version,
    KUN_UPDATE_CHANNEL: channel, RELEASE_CHANNEL: channel } }
}
