'use strict'

const { spawnSync } = require('node:child_process')
const { appendFileSync, statSync } = require('node:fs')
const { join, resolve } = require('node:path')

function chromeSandboxPath(resourcesPath) {
  return join(resolve(resourcesPath), '..', 'chrome-sandbox')
}

function sandboxIdentity(path, stat = statSync(path)) {
  return {
    uid: stat.uid,
    gid: stat.gid,
    mode: stat.mode & 0o7777,
    path
  }
}

function verifyChromeSandbox(path, stat = statSync(path)) {
  const identity = sandboxIdentity(path, stat)
  if (identity.uid !== 0 || identity.gid !== 0 || identity.mode !== 0o4755) {
    throw new Error(
      `chrome-sandbox is not root:root 4755: path=${path} uid=${identity.uid} ` +
      `gid=${identity.gid} mode=${identity.mode.toString(8)}`
    )
  }
  return identity
}

function activateCiFallback(options, error) {
  const env = options.env ?? process.env
  if (env.CI !== 'true' || env.KUN_CI_ALLOW_NO_SANDBOX !== '1') throw error
  const githubEnv = env.GITHUB_ENV
  if (!githubEnv) throw new Error(`Cannot activate CI sandbox fallback without GITHUB_ENV: ${error.message}`)
  ;(options.appendFileSyncCommand ?? appendFileSync)(githubEnv, 'KUN_CI_NO_SANDBOX_ACTIVE=1\n', 'utf8')
  return { fallback: true, reason: error.message }
}

function configureChromeSandbox(resourcesPath, options = {}) {
  const path = chromeSandboxPath(resourcesPath)
  const run = options.spawnSyncCommand ?? spawnSync
  try {
    for (const [command, args] of [
      ['chown', ['root:root', path]],
      ['chmod', ['4755', path]]
    ]) {
      const result = run('sudo', [command, ...args], { encoding: 'utf8' })
      if (result.status !== 0 || result.signal) {
        throw new Error([
          `Failed to configure chrome-sandbox with sudo ${command}`,
          `status=${result.status} signal=${result.signal}`,
          `stdout=${result.stdout ?? ''}`,
          `stderr=${result.stderr ?? ''}`
        ].join('\n'))
      }
    }
    return verifyChromeSandbox(path, options.statSyncCommand?.(path) ?? statSync(path))
  } catch (error) {
    return activateCiFallback(options, error instanceof Error ? error : new Error(String(error)))
  }
}

if (require.main === module) {
  const resourcesIndex = process.argv.indexOf('--resources')
  const resources = resourcesIndex >= 0 ? process.argv[resourcesIndex + 1] : undefined
  if (!resources || resources.startsWith('--')) {
    throw new Error('--resources requires the unpacked application resources path')
  }
  const identity = configureChromeSandbox(resources)
  if ('fallback' in identity) {
    process.stderr.write(`SUID Chromium sandbox unavailable; activated explicit CI fallback: ${identity.reason}\n`)
  } else {
    process.stdout.write(
      `Verified SUID Chromium sandbox: ${identity.path} root:root ${identity.mode.toString(8)}\n`
    )
  }
}

module.exports = {
  activateCiFallback,
  chromeSandboxPath,
  configureChromeSandbox,
  sandboxIdentity,
  verifyChromeSandbox
}
