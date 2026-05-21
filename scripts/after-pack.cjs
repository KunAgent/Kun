const { createHash } = require('node:crypto')
const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { chmod, mkdir, readFile, rename, unlink, writeFile } = require('node:fs/promises')
const { join, dirname } = require('node:path')

const deepseekTuiPkg = require('../node_modules/deepseek-tui/package.json')
const artifacts = require('../node_modules/deepseek-tui/scripts/artifacts.js')

const ARCH_BY_VALUE = new Map([
  [0, 'ia32'],
  [1, 'x64'],
  [2, 'armv7l'],
  [3, 'arm64'],
  [4, 'universal']
])

const TARGET_MATRIX = {
  darwin: {
    x64: {
      deepseekAsset: 'deepseek-macos-x64',
      tuiAsset: 'deepseek-tui-macos-x64',
      deepseekLocal: 'deepseek',
      tuiLocal: 'deepseek-tui'
    },
    arm64: {
      deepseekAsset: 'deepseek-macos-arm64',
      tuiAsset: 'deepseek-tui-macos-arm64',
      deepseekLocal: 'deepseek',
      tuiLocal: 'deepseek-tui'
    }
  },
  linux: {
    x64: {
      deepseekAsset: 'deepseek-linux-x64',
      tuiAsset: 'deepseek-tui-linux-x64',
      deepseekLocal: 'deepseek',
      tuiLocal: 'deepseek-tui'
    }
  },
  win32: {
    x64: {
      deepseekAsset: 'deepseek-windows-x64.exe',
      tuiAsset: 'deepseek-tui-windows-x64.exe',
      deepseekLocal: 'deepseek.exe',
      tuiLocal: 'deepseek-tui.exe'
    }
  }
}

function normalizePlatform(platform) {
  if (platform === 'win') return 'win32'
  return platform
}

function resolveTargetArch(context) {
  if (typeof context.arch === 'string' && context.arch.trim()) {
    return context.arch.trim()
  }
  if (typeof context.arch === 'number' && ARCH_BY_VALUE.has(context.arch)) {
    return ARCH_BY_VALUE.get(context.arch)
  }
  const outDir = String(context.appOutDir || '')
  if (outDir.includes('arm64')) return 'arm64'
  if (outDir.includes('x64')) return 'x64'
  return process.arch
}

function resolveTarget(context) {
  const platform = normalizePlatform(context.electronPlatformName)
  const arch = resolveTargetArch(context)
  const entry = TARGET_MATRIX[platform]?.[arch]
  if (!entry) {
    throw new Error(
      `[after-pack] Unsupported packaged runtime target ${platform}/${arch}. Add it to TARGET_MATRIX first.`
    )
  }
  return { platform, arch, ...entry }
}

function resolveResourcesRoot(context) {
  if (normalizePlatform(context.electronPlatformName) === 'darwin') {
    return join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources'
    )
  }
  return join(context.appOutDir, 'resources')
}

function releaseVersion() {
  return String(deepseekTuiPkg.deepseekBinaryVersion || deepseekTuiPkg.version).trim()
}

function releaseRepo() {
  return process.env.DEEPSEEK_TUI_GITHUB_REPO || process.env.DEEPSEEK_GITHUB_REPO || 'Hmbown/DeepSeek-TUI'
}

async function sha256File(path) {
  const content = await readFile(path)
  return createHash('sha256').update(content).digest('hex')
}

function parseChecksumManifest(text) {
  const checksums = new Map()
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = trimmed.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)
    if (!match) {
      throw new Error(`[after-pack] Invalid checksum manifest line: ${trimmed}`)
    }
    checksums.set(match[2], match[1].toLowerCase())
  }
  return checksums
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { Accept: 'text/plain' },
    signal: AbortSignal.timeout(60_000)
  })
  if (!res.ok) {
    throw new Error(`[after-pack] Fetch failed (${res.status}) for ${url}`)
  }
  return res.text()
}

async function downloadToFile(url, destination) {
  const res = await fetch(url, {
    headers: { Accept: 'application/octet-stream' },
    signal: AbortSignal.timeout(300_000)
  })
  if (!res.ok) {
    throw new Error(`[after-pack] Download failed (${res.status}) for ${url}`)
  }
  const tmp = `${destination}.${process.pid}.${Date.now()}.tmp`
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(tmp, Buffer.from(await res.arrayBuffer()))
  await rename(tmp, destination)
}

async function readTrimmed(path) {
  try {
    return (await readFile(path, 'utf8')).trim()
  } catch {
    return ''
  }
}

async function bundledBinaryMatches(filePath, markerPath, version, expectedSha) {
  if (!existsSync(filePath) || !existsSync(markerPath)) return false
  if ((await readTrimmed(markerPath)) !== version) return false
  return (await sha256File(filePath)) === expectedSha
}

async function replaceBundledBinary(
  destination,
  markerPath,
  version,
  assetName,
  expectedSha,
  repo,
  platform
) {
  const url = artifacts.releaseAssetUrl(assetName, version, repo)
  await downloadToFile(url, destination)
  const actualSha = await sha256File(destination)
  if (actualSha !== expectedSha) {
    await unlink(destination).catch(() => {})
    throw new Error(
      `[after-pack] Checksum mismatch for ${assetName}: expected ${expectedSha}, got ${actualSha}`
    )
  }
  if (platform !== 'win32') {
    await chmod(destination, 0o755)
  }
  await writeFile(markerPath, `${version}\n`, 'utf8')
}

function assertBundledPackageShape(packageRoot) {
  const required = [
    'package.json',
    'bin/deepseek.js',
    'bin/deepseek-tui.js',
    'scripts/install.js',
    'scripts/artifacts.js',
    'scripts/preflight-glibc.js'
  ]
  for (const relativePath of required) {
    const fullPath = join(packageRoot, relativePath)
    if (!existsSync(fullPath)) {
      throw new Error(`[after-pack] Packaged deepseek-tui file missing: ${fullPath}`)
    }
  }
}

async function ensureBundledRuntime(context) {
  const target = resolveTarget(context)
  const resourcesRoot = resolveResourcesRoot(context)
  const packageRoot = join(resourcesRoot, 'app.asar.unpacked', 'node_modules', 'deepseek-tui')
  const downloadsDir = join(packageRoot, 'bin', 'downloads')

  assertBundledPackageShape(packageRoot)
  await mkdir(downloadsDir, { recursive: true })
  // The GUI launches only the DeepSeek CLI, so keep the larger TUI binary out
  // of packaged resources and avoid extra Windows scanning/signing work.
  await Promise.all([
    unlink(join(downloadsDir, target.tuiLocal)).catch(() => {}),
    unlink(join(downloadsDir, `${target.tuiLocal}.version`)).catch(() => {})
  ])

  const version = releaseVersion()
  const repo = releaseRepo()
  const checksums = parseChecksumManifest(
    await fetchText(artifacts.checksumManifestUrl(version, repo))
  )

  const binaries = [
    {
      assetName: target.deepseekAsset,
      filePath: join(downloadsDir, target.deepseekLocal),
      markerPath: join(downloadsDir, `${target.deepseekLocal}.version`)
    }
  ]

  for (const binary of binaries) {
    const expectedSha = checksums.get(binary.assetName)
    if (!expectedSha) {
      throw new Error(`[after-pack] Checksum manifest is missing ${binary.assetName}`)
    }
    const matches = await bundledBinaryMatches(
      binary.filePath,
      binary.markerPath,
      version,
      expectedSha
    )
    if (matches) {
      console.log(`[after-pack] Bundled ${binary.assetName} already matches ${target.platform}/${target.arch}.`)
      continue
    }
    console.log(`[after-pack] Bundling ${binary.assetName} for ${target.platform}/${target.arch}...`)
    await replaceBundledBinary(
      binary.filePath,
      binary.markerPath,
      version,
      binary.assetName,
      expectedSha,
      repo,
      target.platform
    )
  }
}

function maybeAdhocSignMacApp(context) {
  if (normalizePlatform(context.electronPlatformName) !== 'darwin') {
    return
  }

  if (
    process.env.CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.CSC_KEY_PASSWORD ||
    process.env.MAC_SIGN === '1'
  ) {
    console.log('[after-pack] Developer ID signing is enabled, skipping ad-hoc signing.')
    return
  }

  const appBundle = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  if (!existsSync(appBundle)) {
    throw new Error(`[after-pack] App bundle not found for ad-hoc signing: ${appBundle}`)
  }

  execFileSync(
    'codesign',
    ['--force', '--deep', '--sign', '-', '--timestamp=none', appBundle],
    { stdio: 'inherit' }
  )
}

exports.ensureBundledRuntime = ensureBundledRuntime

exports.default = async function afterPack(context) {
  await ensureBundledRuntime(context)
  maybeAdhocSignMacApp(context)
}
