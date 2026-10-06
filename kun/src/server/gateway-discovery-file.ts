import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Read-only rendezvous for external agents: `~/.kun/gateway.json` says where
 * Kun's local model gateway listens. It never contains a credential; a client
 * confirms the endpoint with `GET /api/hello` before using it, so a stale
 * file from a crashed process is harmless.
 */
export type GatewayDiscoveryRecord = {
  name: 'kun'
  version: string
  pid: number
  instanceId: string
  baseUrl: string
  /** OpenAI-compatible base (`…/v1`). */
  v1: string
  /** Anthropic-compatible base (root). */
  anthropic: string
  hello: string
  updatedAt: string
}

export function gatewayDiscoveryFilePath(): string {
  return process.env.KUN_GATEWAY_DISCOVERY_FILE?.trim() || join(homedir(), '.kun', 'gateway.json')
}

export async function publishGatewayDiscovery(input: { baseUrl: string; version: string; instanceId: string }): Promise<string> {
  const file = gatewayDiscoveryFilePath()
  const base = input.baseUrl.replace(/\/+$/, '')
  const record: GatewayDiscoveryRecord = {
    name: 'kun', version: input.version, pid: process.pid, instanceId: input.instanceId,
    baseUrl: base, v1: `${base}/v1`, anthropic: base, hello: `${base}/api/hello`, updatedAt: new Date().toISOString()
  }
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(record, null, 2) + '\n', { mode: 0o644 })
  await rename(temp, file)
  return file
}

/** Removes the file only while it still names this process incarnation. */
export async function removeGatewayDiscovery(instanceId: string): Promise<void> {
  const file = gatewayDiscoveryFilePath()
  try {
    const current = JSON.parse(await readFile(file, 'utf8')) as Partial<GatewayDiscoveryRecord>
    if (current.instanceId === instanceId) await rm(file, { force: true })
  } catch {
    // Missing or foreign files are left alone.
  }
}
