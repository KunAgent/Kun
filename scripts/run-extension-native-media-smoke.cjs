#!/usr/bin/env node

'use strict'

const { spawnSync } = require('node:child_process')
const { join, resolve } = require('node:path')
const { resolveHostMediaExecutables } = require('./lib/extension-native-media-smoke.cjs')

function createNativeMediaSmokeInvocation({
  root = resolve(__dirname, '..'),
  environment = process.env,
  platform = process.platform
} = {}) {
  const executables = resolveHostMediaExecutables({ environment, platform })
  const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs')
  return {
    command: process.execPath,
    args: [vitest, 'run', 'src/services/extension-media-native-smoke.test.ts'],
    options: {
      cwd: join(root, 'kun'),
      env: {
        ...environment,
        KUN_RUN_MEDIA_SMOKE: '1',
        KUN_FFMPEG_PATH: executables.ffmpeg,
        KUN_FFPROBE_PATH: executables.ffprobe
      },
      shell: false,
      stdio: 'inherit',
      timeout: 180_000,
      killSignal: 'SIGKILL',
      windowsHide: true
    }
  }
}

function runNativeMediaSmoke(options = {}) {
  const invocation = createNativeMediaSmokeInvocation(options)
  const result = (options.spawnSyncCommand ?? spawnSync)(
    invocation.command,
    invocation.args,
    invocation.options
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(
      `Fail-closed native FFmpeg broker smoke failed (${result.signal ?? result.status ?? 'unknown exit'})`
    )
  }
}

module.exports = {
  createNativeMediaSmokeInvocation,
  runNativeMediaSmoke
}

if (require.main === module) {
  try {
    runNativeMediaSmoke()
    process.stdout.write(
      `Extension native FFmpeg broker smoke OK (${process.platform}/${process.arch}): ` +
      'KUN_RUN_MEDIA_SMOKE=1, real ffprobe/FFmpeg proof, H.264, post-probe, and cancellation.\n'
    )
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
