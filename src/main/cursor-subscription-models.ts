import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type {
  CursorSubscriptionModel,
  CursorSubscriptionModelParameter,
  CursorSubscriptionModelVariant
} from '../shared/kun-gui-api'

const CURSOR_SDK_PACKAGE = '@cursor/sdk'
const FRAME_MARKER = '<<<KUN_CURSOR_SDK>>>'
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_STDOUT_BYTES = 1024 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const MAX_MODEL_ID_LENGTH = 512
const MAX_MODEL_NAME_LENGTH = 256
const MAX_MODEL_DESCRIPTION_LENGTH = 2_000
const MAX_MODEL_COUNT = 500
const MAX_MODEL_ALIASES = 32
const MAX_MODEL_PARAMETERS = 32
const MAX_MODEL_PARAMETER_VALUES = 64
const MAX_MODEL_VARIANTS = 64
const MAX_ACCOUNT_FIELD_LENGTH = 512

export type CursorSubscriptionAccount = {
  apiKeyName: string
  userEmail?: string
  userFirstName?: string
  userLastName?: string
}

export type CursorSubscriptionDiscovery = {
  account: CursorSubscriptionAccount
  models: CursorSubscriptionModel[]
}

type CursorDiscoveryFrame =
  | { ok: true; account: unknown; models: unknown }
  | { ok: false; code?: unknown; message?: unknown }

export type CursorSubscriptionDiscoveryOptions = {
  apiKey: string
  kunRoots: readonly string[]
  nodePath?: string
  spawnFn?: typeof spawn
  timeoutMs?: number
}

export function resolveCursorSdkKunDir(kunRoots: readonly string[]): string | undefined {
  return kunRoots.find((root) =>
    existsSync(join(root, 'node_modules', '@cursor', 'sdk', 'package.json'))
  )
}

export async function discoverCursorSubscription(
  options: CursorSubscriptionDiscoveryOptions
): Promise<CursorSubscriptionDiscovery> {
  const apiKey = options.apiKey.trim()
  if (!apiKey) throw new Error('Enter a Cursor API key before connecting.')
  const kunDir = resolveCursorSdkKunDir(options.kunRoots)
  if (!kunDir) {
    throw new Error('Cursor SDK is unavailable in the Kun runtime. Reinstall or update Kun.')
  }

  const spawnFn = options.spawnFn ?? spawn
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const nodePath = options.nodePath ?? process.execPath
  const script = cursorDiscoveryScript()

  if (!options.spawnFn) {
    try {
      const result = await runOwnedCommand(nodePath, ['--input-type=module', '-e', script], {
        cwd: kunDir, env: cursorDiscoveryEnvironment(), input: apiKey,
        timeoutMs, maxOutputBytes: MAX_STDOUT_BYTES,
        messages: {
          timeout: `Cursor SDK discovery timed out after ${timeoutMs}ms.`,
          outputLimit: 'Cursor SDK discovery response exceeded the output limit.'
        }
      })
      return parseCursorDiscoveryOutput(result.stdout, apiKey)
    } catch (error) { throw new Error(sanitizeCursorError(error, apiKey)) }
  }

  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn> | undefined
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (
      result?: CursorSubscriptionDiscovery,
      error?: unknown
    ): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try {
        child?.kill()
      } catch {
        // Best effort: the process may have already exited.
      }
      if (error) reject(new Error(sanitizeCursorError(error, apiKey)))
      else if (result) resolve(result)
      else reject(new Error('Cursor SDK discovery failed.'))
    }

    try {
      child = spawnFn(nodePath, ['--input-type=module', '-e', script], {
        cwd: kunDir,
        env: cursorDiscoveryEnvironment(),
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false
      })
    } catch (error) {
      finish(undefined, error)
      return
    }

    timer = setTimeout(() => {
      timedOut = true
      try {
        child?.kill()
      } catch {
        // Best effort.
      }
      finish(undefined, `Cursor SDK discovery timed out after ${timeoutMs}ms.`)
    }, timeoutMs)

    child.stdout?.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
      if (Buffer.byteLength(stdout) > MAX_STDOUT_BYTES) {
        finish(undefined, 'Cursor SDK discovery response exceeded the output limit.')
      }
    })
    child.stderr?.on('data', (chunk: Buffer | string) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-MAX_STDERR_BYTES)
    })
    child.on('error', (error) => finish(undefined, error))
    child.on('exit', (code) => {
      if (settled || timedOut) return
      try {
        finish(parseCursorDiscoveryOutput(stdout, apiKey))
      } catch (error) {
        const detail = stderr.trim()
        finish(undefined, detail || error || `Cursor SDK discovery exited with code ${code ?? 'unknown'}.`)
      }
    })

    try {
      child.stdin?.end(apiKey)
    } catch (error) {
      finish(undefined, error)
    }
  })
}

export function cursorDiscoveryEnvironment(
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...source, ELECTRON_RUN_AS_NODE: '1' }
  delete env.CURSOR_API_KEY
  return env
}

export function cursorDiscoveryScript(): string {
  return [
    `import { readFileSync } from 'node:fs';`,
    `import { Cursor } from ${JSON.stringify(CURSOR_SDK_PACKAGE)};`,
    `const marker = ${JSON.stringify(FRAME_MARKER)};`,
    `const apiKey = readFileSync(0, 'utf8').trim();`,
    `const redact = (value) => String(value ?? '').split(apiKey).join('[REDACTED]');`,
    `try {`,
    `  if (!apiKey) throw new Error('Cursor API key is required.');`,
    `  const [account, models] = await Promise.all([`,
    `    Cursor.me({ apiKey }),`,
    `    Cursor.models.list({ apiKey })`,
    `  ]);`,
    `  process.stdout.write(marker + JSON.stringify({ ok: true, account, models }) + marker);`,
    `} catch (error) {`,
    `  process.stdout.write(marker + JSON.stringify({`,
    `    ok: false,`,
    `    code: typeof error?.code === 'string' ? error.code : error?.name,`,
    `    message: redact(error?.message || error)`,
    `  }) + marker);`,
    `}`,
    `process.exit(0);`
  ].join('\n')
}

export function parseCursorDiscoveryOutput(
  stdout: string,
  apiKey: string
): CursorSubscriptionDiscovery {
  const start = stdout.indexOf(FRAME_MARKER)
  const end = start < 0 ? -1 : stdout.indexOf(FRAME_MARKER, start + FRAME_MARKER.length)
  if (start < 0 || end <= start) throw new Error('Cursor SDK returned an invalid response.')

  let frame: CursorDiscoveryFrame
  try {
    frame = JSON.parse(stdout.slice(start + FRAME_MARKER.length, end)) as CursorDiscoveryFrame
  } catch {
    throw new Error('Cursor SDK returned malformed JSON.')
  }
  if (!frame || typeof frame !== 'object') throw new Error('Cursor SDK returned an invalid response.')
  if (frame.ok !== true) {
    const code = boundedString(frame.code, 128)
    const message = boundedString(frame.message, 2_000) || 'Cursor rejected the API key.'
    throw new Error(sanitizeCursorError(code ? `${code}: ${message}` : message, apiKey))
  }

  const models = normalizeCursorModels(frame.models)
  if (models.length === 0) {
    throw new Error('Cursor connected successfully but returned no available models.')
  }
  return {
    account: normalizeCursorAccount(frame.account),
    models
  }
}

export function sanitizeCursorError(error: unknown, apiKey: string): string {
  const message = error instanceof Error ? error.message : String(error)
  const secret = apiKey.trim()
  const redacted = secret ? message.split(secret).join('[REDACTED]') : message
  return redacted.slice(0, 2_000) || 'Cursor SDK request failed.'
}

function normalizeCursorModels(value: unknown): CursorSubscriptionModel[] {
  if (!Array.isArray(value)) return []
  const models: CursorSubscriptionModel[] = []
  const seen = new Set<string>()
  for (const entry of value.slice(0, MAX_MODEL_COUNT)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const model = entry as Record<string, unknown>
    const id = safeModelString(model.id, MAX_MODEL_ID_LENGTH)
    const key = id.toLowerCase()
    if (!id || seen.has(key)) continue
    seen.add(key)
    const displayName = safeModelString(model.displayName, MAX_MODEL_NAME_LENGTH) || id
    const description = safeModelString(model.description, MAX_MODEL_DESCRIPTION_LENGTH)
    const aliases = normalizeStringList(model.aliases, MAX_MODEL_ALIASES, MAX_MODEL_ID_LENGTH)
      .filter((alias) => alias.toLowerCase() !== key)
    const parameters = normalizeCursorModelParameters(model.parameters)
    const variants = normalizeCursorModelVariants(model.variants)
    models.push({
      id,
      displayName,
      ...(description ? { description } : {}),
      ...(aliases.length ? { aliases } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(variants.length ? { variants } : {})
    })
  }
  return models
}

function normalizeCursorModelParameters(value: unknown): CursorSubscriptionModelParameter[] {
  if (!Array.isArray(value)) return []
  const parameters: CursorSubscriptionModelParameter[] = []
  const seen = new Set<string>()
  for (const entry of value.slice(0, MAX_MODEL_PARAMETERS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const parameter = entry as Record<string, unknown>
    const id = safeModelString(parameter.id, MAX_MODEL_ID_LENGTH)
    const key = id.toLowerCase()
    if (!id || seen.has(key)) continue
    seen.add(key)
    const displayName = safeModelString(parameter.displayName, MAX_MODEL_NAME_LENGTH)
    const values = Array.isArray(parameter.values)
      ? parameter.values.slice(0, MAX_MODEL_PARAMETER_VALUES).flatMap((raw) => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
          const item = raw as Record<string, unknown>
          const itemValue = safeModelString(item.value, MAX_MODEL_ID_LENGTH)
          if (!itemValue) return []
          const itemDisplayName = safeModelString(item.displayName, MAX_MODEL_NAME_LENGTH)
          return [{
            value: itemValue,
            ...(itemDisplayName ? { displayName: itemDisplayName } : {})
          }]
        })
      : []
    if (values.length === 0) continue
    parameters.push({
      id,
      ...(displayName ? { displayName } : {}),
      values
    })
  }
  return parameters
}

function normalizeCursorModelVariants(value: unknown): CursorSubscriptionModelVariant[] {
  if (!Array.isArray(value)) return []
  const variants: CursorSubscriptionModelVariant[] = []
  for (const entry of value.slice(0, MAX_MODEL_VARIANTS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const variant = entry as Record<string, unknown>
    const displayName = safeModelString(variant.displayName, MAX_MODEL_NAME_LENGTH)
    if (!displayName) continue
    const description = safeModelString(variant.description, MAX_MODEL_DESCRIPTION_LENGTH)
    const params = Array.isArray(variant.params)
      ? variant.params.slice(0, MAX_MODEL_PARAMETERS).flatMap((raw) => {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
          const item = raw as Record<string, unknown>
          const id = safeModelString(item.id, MAX_MODEL_ID_LENGTH)
          const itemValue = safeModelString(item.value, MAX_MODEL_ID_LENGTH)
          return id && itemValue ? [{ id, value: itemValue }] : []
        })
      : []
    variants.push({
      displayName,
      ...(description ? { description } : {}),
      ...(variant.isDefault === true ? { isDefault: true } : {}),
      params
    })
  }
  return variants
}

function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  const seen = new Set<string>()
  for (const entry of value.slice(0, maxItems)) {
    const item = safeModelString(entry, maxLength)
    const key = item.toLowerCase()
    if (!item || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function safeModelString(value: unknown, maxLength: number): string {
  const text = boundedString(value, maxLength)
  return Array.from(text).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 0x1f || codePoint === 0x7f
  })
    ? ''
    : text
}

function normalizeCursorAccount(value: unknown): CursorSubscriptionAccount {
  const account = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {}
  const apiKeyName = boundedString(account.apiKeyName, MAX_ACCOUNT_FIELD_LENGTH) || 'Cursor API key'
  const userEmail = boundedString(account.userEmail, MAX_ACCOUNT_FIELD_LENGTH)
  const userFirstName = boundedString(account.userFirstName, MAX_ACCOUNT_FIELD_LENGTH)
  const userLastName = boundedString(account.userLastName, MAX_ACCOUNT_FIELD_LENGTH)
  return {
    apiKeyName,
    ...(userEmail ? { userEmail } : {}),
    ...(userFirstName ? { userFirstName } : {}),
    ...(userLastName ? { userLastName } : {})
  }
}

function boundedString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''
}
import { runOwnedCommand } from './owned-command'
