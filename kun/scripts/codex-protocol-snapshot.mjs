#!/usr/bin/env node
/**
 * Regenerate (or verify) the checked-in Codex App Server protocol snapshot.
 *
 *   node scripts/codex-protocol-snapshot.mjs          # --check (default)
 *   node scripts/codex-protocol-snapshot.mjs --write  # refresh snapshot.json
 *
 * The snapshot records the distilled wire surface (method lists + schema
 * bundle digests + detected CLI version) from
 * `codex app-server generate-json-schema`. A vitest contract test asserts the
 * methods Kun consumes are present; bump CODEX_APP_SERVER_MIN_VERSION and
 * refresh this file when a newer CLI changes the protocol.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const snapshotPath = join(
  repoRoot,
  'src/runtime/codex/protocol/snapshot.json'
)

const SURFACE_FILES = [
  'ClientRequest.json',
  'ClientNotification.json',
  'ServerRequest.json',
  'ServerNotification.json'
]

function methodsOf(file) {
  const doc = JSON.parse(readFileSync(file, 'utf8'))
  const methods = []
  for (const variant of doc.oneOf ?? []) {
    const enumValues = variant?.properties?.method?.enum
    if (Array.isArray(enumValues)) methods.push(...enumValues)
  }
  return methods.sort()
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function versionOf(binary) {
  const out = execFileSync(binary, ['--version'], {
    encoding: 'utf8',
    timeout: 15_000
  }).trim()
  const match = out.match(/(\d+\.\d+\.\d+)/)
  return match ? match[1] : out
}

function buildSnapshot(binary) {
  const dir = mkdtempSync(join(tmpdir(), 'codex-schema-'))
  try {
    execFileSync(binary, ['app-server', 'generate-json-schema', '--out', dir], {
      encoding: 'utf8',
      timeout: 60_000
    })
    const [clientRequests] = [methodsOf(join(dir, 'ClientRequest.json'))]
    return {
      tool: 'codex-cli',
      version: versionOf(binary),
      dialect:
        'bare-jsonrpc (no `jsonrpc` envelope field; id+method+params frames)',
      clientRequests,
      clientNotifications: methodsOf(
        join(dir, 'ClientNotification.json')
      ),
      serverRequests: methodsOf(join(dir, 'ServerRequest.json')),
      serverNotifications: methodsOf(join(dir, 'ServerNotification.json')),
      schemaBundlesSha256: Object.fromEntries(
        [
          'codex_app_server_protocol.schemas.json',
          'codex_app_server_protocol.v2.schemas.json'
        ].map((name) => [name, sha256(join(dir, name))])
      )
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const binary = process.env.CODEX_BIN ?? 'codex'
const check = !process.argv.includes('--write')
const snapshot = buildSnapshot(binary)

if (check) {
  const current = JSON.parse(readFileSync(snapshotPath, 'utf8'))
  const diffs = []
  for (const key of Object.keys(snapshot)) {
    const a = JSON.stringify(snapshot[key])
    const b = JSON.stringify(current[key])
    if (a !== b) diffs.push(key)
  }
  if (diffs.length) {
    console.error(`codex protocol drift detected in: ${diffs.join(', ')}`)
    console.error('refresh: node scripts/codex-protocol-snapshot.mjs --write')
    process.exit(1)
  }
  console.log(`codex protocol snapshot OK (${snapshot.version})`)
} else {
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n')
  console.log(`wrote ${snapshotPath} (codex-cli ${snapshot.version})`)
}
