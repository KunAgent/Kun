'use strict'

const MAX_LOG_BYTES = 256 * 1024
const MAX_SUMMARY_LINES = 3
const MAX_LINE_LENGTH = 512

const PACKAGING_FAILURE_KINDS = Object.freeze([
  'dependency-install',
  'native-rebuild',
  'typescript',
  'unit-test',
  'bundle',
  'electron-package',
  'artifact-layout',
  'runtime-smoke',
  'renderer-smoke',
  'signature',
  'notarization',
  'cleanup',
  'infrastructure'
])

const PATTERNS = [
  ['infrastructure', [
    /failed to resolve action download info/i,
    /service unavailable/i,
    /runner (?:is )?(?:offline|unavailable|failure)/i,
    /github (?:api|actions).*(?:unavailable|failure|timeout)/i
  ]],
  ['notarization', [/notariz/i, /gatekeeper/i]],
  ['signature', [/codesign/i, /code signing/i, /signing credentials/i, /(?:sign|signing).*certificate/i, /developer id/i]],
  ['renderer-smoke', [/smoke.*(?:desktop|chromium|renderer)/i, /guest target/i, /renderer.*(?:did not load|failed to start)/i]],
  ['runtime-smoke', [/smoke.*(?:runtime|backend|health)/i, /health check.*(?:failed|timeout)/i]],
  ['artifact-layout', [/if-no-files-found/i, /artifact.*(?:missing|not found)/i, /no files found/i, /expected artifact/i]],
  ['cleanup', [/cleanup.*failed/i, /failed.*cleanup/i, /unlink.*(?:busy|failed)/i, /EPERM.*(?:remove|rmdir)/i]],
  ['native-rebuild', [/node-gyp/i, /prebuild-install/i, /better-sqlite3.*(?:binding|load)/i, /native.*rebuild/i]],
  ['dependency-install', [/npm (?:ci|install).*failed/i, /npm ERR!/i, /electron failed to install/i, /unable to resolve (?:dependency|package)/i]],
  ['typescript', [/tsc/i, /typecheck/i, /typescript error/i]],
  ['unit-test', [/vitest/i, /jest/i, /(?:unit )?tests?.*(?:failed|failing)/i, /test run.*failed/i]],
  ['bundle', [/electron-vite/i, /vite.*(?:failed|error)/i, /rollup.*(?:failed|error)/i]],
  ['electron-package', [/electron-builder/i, /packaging.*failed/i, /appimage.*failed/i, /nsis.*failed/i]
  ]
]

const REPRO_COMMANDS = {
  package: {
    linux: 'npm run dist:linux',
    darwin: 'npm run dist:mac',
    win32: 'npm.cmd run dist:win',
    unknown: 'npm run dist'
  },
  'renderer-smoke': 'npm run smoke:packaged-extension-desktop',
  'runtime-smoke': 'npm run smoke:packaged-extensions',
  typescript: 'npm run typecheck',
  'unit-test': 'npm test',
  bundle: 'npm run build',
  'electron-package': 'npm run dist',
  'dependency-install': 'npm ci',
  'native-rebuild': 'npm rebuild',
  'artifact-layout': 'npm run dist',
  cleanup: 'npm run dist',
  signature: 'npm run verify:apple',
  notarization: 'npm run verify:apple',
  infrastructure: 'rerun the failed GitHub Actions job after service recovery'
}

function normalizePlatform(platform) {
  if (platform === 'linux') return 'linux'
  if (platform === 'darwin' || platform === 'macos' || platform === 'osx') return 'darwin'
  if (platform === 'win32' || platform === 'windows' || platform === 'win') return 'win32'
  return 'unknown'
}

function boundedLog(log) {
  const text = typeof log === 'string' ? log : ''
  return Buffer.byteLength(text, 'utf8') <= MAX_LOG_BYTES
    ? text
    : text.slice(-MAX_LOG_BYTES)
}

function redact(text) {
  return text
    .replace(/(authorization|bearer|token|password|secret|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
}

function summary(log) {
  const candidates = boundedLog(log)
    .split(/\r?\n/)
    .filter((line) => /error|failed|failure|exception|timed out|missing|unavailable/i.test(line))
    .slice(-MAX_SUMMARY_LINES)
  return candidates.map((line) => redact(line).slice(0, MAX_LINE_LENGTH))
}

function classifyKind(log) {
  for (const [kind, patterns] of PATTERNS) {
    if (patterns.some((pattern) => pattern.test(log))) return kind
  }
  return 'electron-package'
}

function isLikelyCodeFailure(kind) {
  return !['infrastructure', 'dependency-install', 'native-rebuild', 'cleanup', 'signature', 'notarization'].includes(kind)
}

function localReproductionCommand(kind, platform) {
  if (kind === 'infrastructure') return REPRO_COMMANDS.infrastructure
  const commandForPlatform = (command) => platform === 'win32'
    ? command.replace(/^npm /, 'npm.cmd ')
    : command
  if (kind in REPRO_COMMANDS) {
    const command = REPRO_COMMANDS[kind]
    if (typeof command === 'string') return commandForPlatform(command)
  }
  return commandForPlatform(REPRO_COMMANDS.package[platform])
}

function classifyPackagingFailure(input = {}) {
  const platform = normalizePlatform(input.platform)
  const log = boundedLog(input.log)
  const kind = classifyKind(log)
  const artifactPath = typeof input.artifactPath === 'string' && input.artifactPath.length <= 512
    ? input.artifactPath
    : undefined
  return {
    kind,
    platform,
    artifactExists: input.artifactExists === true,
    ...(artifactPath ? { artifactPath } : {}),
    lastSuccessfulStep: typeof input.lastSuccessfulStep === 'string'
      ? redact(input.lastSuccessfulStep).slice(0, MAX_LINE_LENGTH)
      : undefined,
    keyLog: summary(log),
    localReproductionCommand: localReproductionCommand(kind, platform),
    isLikelyCodeFailure: isLikelyCodeFailure(kind)
  }
}

module.exports = {
  MAX_LOG_BYTES,
  PACKAGING_FAILURE_KINDS,
  classifyPackagingFailure
}
