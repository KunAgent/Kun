#!/usr/bin/env node

'use strict'

const { mkdir, writeFile } = require('node:fs/promises')
const { createServer } = require('node:http')
const { join } = require('node:path')

function argument(name) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

async function main() {
  const dataDir = argument(process.argv.includes('--fixture-data-dir')
    ? '--fixture-data-dir'
    : '--data-dir')
  const scenario = argument('--scenario')
  const buildId = argument('--build-id')
  const discoveryPath = join(dataDir, 'runtime.json')
  const instanceId = `unsafe-${scenario}`
  const startedAt = new Date().toISOString()
  await mkdir(dataDir, { recursive: true })

  let record
  const server = createServer(async (request, response) => {
    if (request.url === '/v1/runtime/info') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        instanceId: record.instanceId,
        pid: process.pid,
        startedAt,
        oldCapabilityShape: { intentionally: 'unknown-to-candidate' }
      }))
      return
    }
    if (request.url === '/v1/runtime/shutdown' && request.method === 'POST') {
      if (scenario === 'changed-discovery-identity') {
        record = { ...record, instanceId: `${instanceId}-changed` }
        await writeFile(discoveryPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
      }
      response.writeHead(503, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ code: 'fixture_refuses_shutdown' }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true }))
  })
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('fixture did not bind TCP')
  record = {
    version: 1,
    instanceId,
    pid: process.pid,
    startedAt,
    host: '127.0.0.1',
    port: address.port,
    baseUrl: `http://127.0.0.1:${address.port}`,
    runtimeToken: 'unsafe-fixture-token',
    flavor: 'production',
    buildId,
    legacyUnknownField: true
  }
  await writeFile(discoveryPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`KUN_UNSAFE_OWNER_READY ${JSON.stringify(record)}\n`)
  await new Promise((resolvePromise) => {
    const stop = () => server.close(resolvePromise)
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
  })
}

main().then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exit(70)
  }
)
