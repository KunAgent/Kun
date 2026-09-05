'use strict'

const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { execFileSync } = require('node:child_process')

const { RELEASE_VERSION: version, RELEASE_CHANNEL: channel, PREVIOUS_TAG: previous } = process.env
if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || channel !== 'stable') {
  throw new Error('Stable release version and channel are required')
}
const curated = `release/release-v${version}.md`
const notes = existsSync(curated)
  ? readFileSync(curated, 'utf8')
  : execFileSync(process.execPath, ['scripts/generate-release-notes.cjs', ...(previous ? [previous] : [])], {
    encoding: 'utf8'
  })
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
writeFileSync('release-notes.md', notes + [
  '', '---', '', '### Build information', '',
  `- Release version: \`${version}\``,
  `- Release channel: \`${channel}\``,
  '- Branch: `master`',
  `- Commit: \`${commit}\``,
  '- macOS: Developer ID signed and notarized',
  '- Platforms: macOS arm64/x64, Windows x64, Linux arm64/x64 AppImage/deb',
  '- Terminal commands and Kun Runtime: bundled with the desktop app', ''
].join('\n'))
