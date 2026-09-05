import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultKunRuntimeSettings,
  normalizeAppSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import { buildRuntimeCapabilityManifest } from '../../../kun/src/contracts/capabilities.js'
import { modelCapabilitiesForModel } from '../../../kun/src/loop/model-context-profile.js'
import { publishRuntimeDiscovery } from '../../../kun/src/server/runtime-discovery.js'
import { KUN_VERSION } from '../../../kun/src/version.js'
import { configureKunManagerDataPlaneForCurrentProcess } from '../kun-process'
import {
  getRuntimeAuthToken,
  kunRuntimeAdapter
} from './kun-adapter'

const servers: Server[] = []

afterEach(async () => {
  await kunRuntimeAdapter.stopAndWait()
  await Promise.all(servers.splice(0).map(closeServer))
})

describe('kunRuntimeAdapter startup readiness', () => {
  it('never adopts a Manager-owned foreign Runtime before or after discovery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-adapter-startup-ready-'))
    const dataDir = join(root, 'data')
    const packageRoot = join(root, 'kun-package')
    const entry = join(packageRoot, 'dist/cli/serve-entry.js')
    const buildId = 'c'.repeat(64)
    const startedAt = '2026-09-02T00:00:00.000Z'
    const instanceId = 'runtime-starting-owner'
    let runtimeResponsive = true
    try {
      await mkdir(join(packageRoot, 'dist/cli'), { recursive: true })
      await writeFile(entry, '', 'utf8')
      await writeFile(
        join(packageRoot, 'dist/runtime-build.json'),
        `${JSON.stringify({ version: 1, buildId })}\n`,
        'utf8'
      )
      const runtimePort = await listen((req, res) => {
        if (req.url !== '/v1/runtime/info' || !runtimeResponsive) {
          res.statusCode = 503
          res.end()
          return
        }
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({
          instanceId,
          serviceVersion: KUN_VERSION,
          buildId,
          launchMode: 'shared',
          host: '127.0.0.1',
          port: runtimePort,
          dataDir,
          model: 'fixture',
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
          insecure: false,
          startedAt,
          pid: process.pid,
          capabilities: buildRuntimeCapabilityManifest({
            model: modelCapabilitiesForModel('fixture')
          })
        }))
      })
      const registration = {
        flavor: 'production' as const,
        instanceId,
        pid: process.pid,
        startedAt,
        host: '127.0.0.1',
        port: runtimePort,
        baseUrl: `http://127.0.0.1:${runtimePort}`,
        runtimeToken: 'runtime-secret',
        buildId
      }
      const managerPort = await listen((req, res) => {
        res.setHeader('content-type', 'application/json')
        if (req.url === '/v1/runtimes/production') {
          res.end(JSON.stringify({ registration }))
          return
        }
        res.statusCode = 404
        res.end()
      })
      configureKunManagerDataPlaneForCurrentProcess({
        discovery: {
          version: 1,
          protocolVersion: 5,
          instanceId: 'manager-startup-readiness',
          pid: process.pid,
          startedAt,
          host: '127.0.0.1',
          port: managerPort,
          baseUrl: `http://127.0.0.1:${managerPort}`,
          managerToken: 'manager-secret',
          serviceVersion: KUN_VERSION,
          buildId,
          dataDir,
          settingsPath: join(dataDir, 'kun-settings.json')
        }
      })
      const settings = runtimeSettings(dataDir, packageRoot)

      await expect(kunRuntimeAdapter.resolveConnection(settings)).resolves.toBe(false)

      await publishRuntimeDiscovery(dataDir, {
        ...registration,
        insecure: false,
        serviceVersion: KUN_VERSION,
        launchMode: 'shared'
      })
      await expect(kunRuntimeAdapter.resolveConnection(settings)).resolves.toBe(false)

      runtimeResponsive = false
      await expect(kunRuntimeAdapter.resolveConnection(settings)).resolves.toBe(false)
      expect(kunRuntimeAdapter.getBaseUrl(settings)).not.toBe(registration.baseUrl)
      expect(getRuntimeAuthToken(settings)).not.toBe(registration.runtimeToken)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function runtimeSettings(dataDir: string, packageRoot: string): AppSettingsV1 {
  const settings = normalizeAppSettings({} as AppSettingsV1)
  return {
    ...settings,
    agents: {
      kun: {
        ...defaultKunRuntimeSettings(),
        dataDir,
        binaryPath: packageRoot,
        autoStart: true
      }
    }
  }
}

function listen(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<number> {
  const server = createServer(handler)
  servers.push(server)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port)
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()))
}
