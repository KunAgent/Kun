import { tmpdir } from 'node:os'
import { claudeCodeSdkExecutable } from '../harness/claude-code-executable.js'
import { raceProbeAbort } from '../harness/probe-abort.js'
import { spawnOwnedSdkProcess } from '../runtime/agent-sdk/owned-sdk-process.js'
import { sdkProcessBaseEnv } from '../runtime/agent-sdk/sdk-process-environment.js'
import { buildScopedEnv } from '../runtime/agent-sdk/sdk-options-builder.js'
import type { SdkApi } from '../runtime/agent-sdk/sdk-protocol.js'
import { buildHarnessEnv } from '../harness/harness-env.js'
import { spawnOwnedProcess, stopOwnedProcess } from '../process/owned-process.js'
import { cursorModelMetadata, type NativeCursorCatalogModel } from './native-cursor-model-metadata.js'
import { parseProviderModelDescriptor, type ModelDiscoveryResult } from './provider-model-descriptors.js'

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown, max = 512): string | undefined => typeof value === 'string' && value.trim() && value.length <= max ? value.trim() : undefined
async function* emptyPrompt(): AsyncIterable<never> {}

export async function discoverClaudeSdkModels(input: { apiKey: string; proxyUrl?: string; signal?: AbortSignal; loadSdk?: () => Promise<SdkApi> }): Promise<ModelDiscoveryResult> {
  const signal = input.signal ?? AbortSignal.timeout(30_000)
  const sdk = await raceProbeAbort(input.loadSdk ? input.loadSdk() : import('@anthropic-ai/claude-agent-sdk').then((value) => value as unknown as SdkApi), signal)
  signal.throwIfAborted()
  const proxy = input.proxyUrl ? { HTTPS_PROXY: input.proxyUrl, HTTP_PROXY: input.proxyUrl } : {}
  const binary = claudeCodeSdkExecutable()
  const query = sdk.query({ prompt: emptyPrompt(), options: { spawnClaudeCodeProcess: spawnOwnedSdkProcess,
    cwd: tmpdir(), env: buildScopedEnv({ ...sdkProcessBaseEnv(), ...proxy }, input.apiKey),
    ...(binary ? { pathToClaudeCodeExecutable: binary } : {}) } })
  try {
    if (!query.supportedModels) throw new Error('Claude SDK does not expose model discovery; update the installed SDK.')
    return parseClaudeSdkModelRows(await raceProbeAbort(query.supportedModels(), signal))
  } finally { query.close?.() }
}

export function parseClaudeSdkModelRows(rows: unknown): ModelDiscoveryResult {
  if (!Array.isArray(rows)) throw new Error('Claude SDK returned an invalid model catalog')
  const modelProfiles: ModelDiscoveryResult['modelProfiles'] = Object.create(null)
  const modelDetails: NonNullable<ModelDiscoveryResult['modelDetails']> = Object.create(null)
  for (const value of rows.slice(0, 2_000)) {
    const row = record(value), id = text(row.resolvedModel) ?? text(row.modelId) ?? text(row.id) ?? text(row.value)
    if (!id || modelProfiles[id]) continue
    modelDetails[id] = { displayName: text(row.displayName, 256), description: text(row.description, 2000),
      ...(text(row.value) && row.value !== id ? { aliases: [text(row.value)!] } : {}) }
    modelProfiles[id] = parseProviderModelDescriptor({ ...row, name: row.displayName,
      reasoning_efforts: row.supportsEffort === false ? undefined : row.supportedEffortLevels,
      default_reasoning_effort: row.defaultEffort }, 'anthropic-thinking')
  }
  return { models: Object.keys(modelProfiles), modelProfiles, modelDetails, source: 'provider', lastAttemptStatus: 'success' }
}

/** The Cursor SDK has no abort option on list; isolate it in an owned, bounded worker. */
export async function discoverCursorSdkModels(input: { apiKey: string; proxyUrl?: string; signal?: AbortSignal }): Promise<ModelDiscoveryResult> {
  const signal = input.signal ?? AbortSignal.timeout(30_000)
  signal.throwIfAborted()
  const sdkUrl = import.meta.resolve('@cursor/sdk')
  const script = `import { Cursor } from ${JSON.stringify(sdkUrl)};
let key = ''; for await (const part of process.stdin) key += part;
try { const [models, account] = await Promise.all([Cursor.models.list({apiKey:key}), Cursor.me({apiKey:key})]);
process.stdout.write(JSON.stringify({models,account})); } catch { process.exitCode=1; }`
  const env = buildHarnessEnv({ base: sdkProcessBaseEnv(), add: { ELECTRON_RUN_AS_NODE: '1',
    ...(input.proxyUrl ? { HTTPS_PROXY: input.proxyUrl, HTTP_PROXY: input.proxyUrl } : {}) } })
  const child = await spawnOwnedProcess(process.execPath, ['--input-type=module', '-e', script], { cwd: tmpdir(), env, stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    const body = await new Promise<string>((resolve, reject) => {
      let output = '', size = 0
      const abort = () => reject(signal.reason ?? new Error('Cursor model discovery cancelled'))
      signal.addEventListener('abort', abort, { once: true })
      child.once('error', reject)
      child.stdout?.on('data', (value: Buffer) => {
        size += value.length
        if (size > 2_000_000) reject(new Error('Cursor model catalog exceeded its size limit'))
        else output += value.toString('utf8')
      })
      child.stderr?.resume()
      child.once('close', (code) => { signal.removeEventListener('abort', abort); if (code !== 0) reject(new Error('Cursor SDK model discovery failed; check the account credential and SDK installation.')); else resolve(output) })
      child.stdin?.once('error', reject)
      child.stdin?.end(input.apiKey)
      if (signal.aborted) abort()
    })
    const payload = record(JSON.parse(body))
    return parseCursorSdkModelRows(payload.models, payload.account)
  } finally { await stopOwnedProcess(child).catch(() => undefined) }
}

export function parseCursorSdkModelRows(rows: unknown, account?: unknown): ModelDiscoveryResult {
  if (!Array.isArray(rows)) throw new Error('Cursor SDK returned an invalid model catalog')
  const modelProfiles: ModelDiscoveryResult['modelProfiles'] = Object.create(null)
  const modelDetails: NonNullable<ModelDiscoveryResult['modelDetails']> = Object.create(null)
  for (const value of rows.slice(0, 2_000)) {
    const row = record(value), id = text(row.id)
    if (!id || modelProfiles[id]) continue
    const variants: NativeCursorCatalogModel['variants'] = Array.isArray(row.variants) ? row.variants.slice(0, 64).map((raw) => {
      const variant = record(raw)
      return { displayName: text(variant.displayName, 256) ?? 'Variant', isDefault: variant.isDefault === true,
        params: Array.isArray(variant.params) ? variant.params.slice(0, 32).flatMap((raw) => {
          const param = record(raw), id = text(param.id, 64), value = text(param.value, 64)
          return id && value ? [{ id, value }] : []
        }) : [] }
    }) : []
    const parameters: NativeCursorCatalogModel['parameters'] = Array.isArray(row.parameters) ? row.parameters.slice(0, 32).flatMap((raw) => {
      const parameter = record(raw), parameterId = text(parameter.id, 64)
      if (!parameterId) return []
      return [{ id: parameterId, displayName: text(parameter.displayName, 256), values: Array.isArray(parameter.values)
        ? parameter.values.slice(0, 64).flatMap((rawValue) => {
          const entry = record(rawValue), value = text(entry.value, 64)
          return value ? [{ value, displayName: text(entry.displayName, 256) }] : []
        }) : [] }]
    }) : []
    const name = text(row.displayName, 256) ?? id
    const aliases = Array.isArray(row.aliases) ? row.aliases.slice(0, 32).flatMap((alias) => text(alias) ? [text(alias)!] : []) : []
    modelDetails[id] = { displayName: name, description: text(row.description, 2000), aliases, parameters, variants }
    modelProfiles[id] = { ...cursorModelMetadata({ id, displayName: name, parameters, variants }, row), name }
  }
  const rawAccount = record(account)
  const safeAccount = Object.fromEntries(['apiKeyName', 'userEmail', 'userFirstName', 'userLastName'].flatMap((key) => {
    const value = text(rawAccount[key]); return value ? [[key, value]] : []
  }))
  return { models: Object.keys(modelProfiles), modelProfiles, modelDetails, source: 'provider', lastAttemptStatus: 'success', account: safeAccount }
}
