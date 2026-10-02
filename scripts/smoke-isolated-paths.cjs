'use strict'
const { posix, win32 } = require('node:path')

// Discovery canonicalizes Windows profile paths to lowercase. Match the same
// absolute directory, never a prefix, sibling, ambient cwd or another drive.
function isolatedPathIdentity(value, platform = process.platform) {
  if (typeof value !== 'string' || !value || /[\0\r\n]/u.test(value)) return undefined
  const paths = platform === 'win32' ? win32 : posix
  if (!paths.isAbsolute(value)) return undefined
  if (platform === 'win32' && !/^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/u.test(value)) return undefined
  const absolute = paths.resolve(value)
  return platform === 'win32' ? absolute.replace(/\\/gu, '/').toLowerCase() : absolute
}
function sameIsolatedDataDirectory(left, right, platform = process.platform) {
  const expected = isolatedPathIdentity(right, platform)
  return expected !== undefined && isolatedPathIdentity(left, platform) === expected
}
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

function isVerifiedIsolatedKunCommand({ command, kind, expectedDataDir, discoveryDataDir, platform = process.platform }) {
  const expected = isolatedPathIdentity(expectedDataDir, platform)
  if (typeof command !== 'string' || !command || !expected || /[\0\r\n]/u.test(command)) return false
  const normalized = platform === 'win32' ? command.replace(/\\/gu, '/').toLowerCase() : command
  const entry = kind === 'runtime' ? 'serve-entry.js' : kind === 'manager' ? 'manager-entry.js' : undefined
  if (!entry || !new RegExp(`(?:^|[\\s/"'])${escapeRegex(entry)}(?=$|[\\s"'])`, 'u').test(normalized)) return false
  if (kind === 'manager') return sameIsolatedDataDirectory(discoveryDataDir, expectedDataDir, platform)
  if (discoveryDataDir !== undefined && !sameIsolatedDataDirectory(discoveryDataDir, expectedDataDir, platform)) return false
  // ps can omit quotes around a path containing spaces, so compare the known
  // complete argument, bounded by the next option/end, rather than splitting it.
  // Multiple declarations and sibling/prefix matches always fail closed.
  if ((normalized.match(/(?:^|\s)--data-dir(?==|\s|$)/gu) ?? []).length !== 1) return false
  const path = escapeRegex(expected)
  return new RegExp(`(?:^|\\s)--data-dir(?:=|\\s+)(?:"${path}"|'${path}'|${path})(?=$|\\s+--)`, 'u').test(normalized)
}
module.exports = { isolatedPathIdentity, sameIsolatedDataDirectory, isVerifiedIsolatedKunCommand }
