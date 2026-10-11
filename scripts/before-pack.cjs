const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

const WHISPER_RESOURCES_DIR = join(__dirname, '..', 'resources', 'whisper')

function normalizePlatform(platform) {
  if (platform === 'mac') return 'darwin'
  if (platform === 'win') return 'win32'
  return platform
}

function normalizeArch(arch) {
  if (arch === 'x64' || arch === 1) return 'x64'
  if (arch === 'arm64' || arch === 3) return 'arm64'
  throw new Error(`[before-pack] Unsupported Whisper runner arch: ${arch}`)
}

async function beforePack(context) {
  const platform = normalizePlatform(context.electronPlatformName)
  const arch = normalizeArch(context.arch)
  if (process.env.KUN_SKIP_WHISPER_RUNNER === '1') {
    console.warn(`[before-pack] Skipping bundled Whisper runner for ${platform}-${arch}.`)
  } else {
    execFileSync(
      process.execPath,
      [
        join(__dirname, 'prepare-whisper-runner.cjs'),
        '--platform',
        platform,
        '--arch',
        arch
      ],
      {
        cwd: join(__dirname, '..'),
        stdio: 'inherit'
      }
    )
  }

  execFileSync(
    process.execPath,
    [
      join(__dirname, 'prepare-officecli.cjs'),
      '--platform',
      platform,
      '--arch',
      arch
    ],
    {
      cwd: join(__dirname, '..'),
      stdio: 'inherit'
    }
  )
}

exports._internals = {
  normalizePlatform,
  normalizeArch
}
exports.default = beforePack
