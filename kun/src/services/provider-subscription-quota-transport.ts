import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ProviderQuotaMetric } from '../contracts/provider-quota.js'
import { GeminiCliOAuthSource } from '../adapters/model/gemini-cli-oauth.js'
import {
  codexCliUserAgent,
  geminiCliRequestHeaders
} from '../adapters/model/provider-cli-identity.js'
import {
  isStoredCodexCredentialExpired,
  parseStoredCodexOAuthCredentials,
  refreshStoredCodexOAuthCredentials,
  type StoredCodexOAuthCredentials
} from './codex-oauth-credential-refresher.js'
import {
  isStoredGrokCredentialExpired,
  parseStoredGrokOAuthCredentials,
  refreshStoredGrokOAuthCredentials,
  type StoredGrokOAuthCredentials
} from './grok-oauth-credential-refresher.js'
import {
  readOpenCodeGoLocalQuota,
  type OpenCodeGoLocalQuotaResult
} from './opencode-go-local-quota.js'
import {
  fetchOpenCodeGoWebQuota as fetchOpenCodeGoWebQuotaImpl,
  filterOpenCodeGoCookieHeader,
  OpenCodeGoWebQuotaError,
  type OpenCodeGoWebQuotaResult
} from './opencode-go-web-quota.js'
import {
  listChromiumCookieDatabaseCandidates,
  readChromiumCookiesForDomainsWithDiagnosis,
  type ChromiumCookieDatabaseCandidate
} from './chromium-browser-cookies.js'
import { type CodexCredential, MAX_RESPONSE_BYTES, type ProbeContext, ProviderQuotaAuthorizationError, QUOTA_TIMEOUT_MS } from './provider-subscription-quota-service.js'

export async function requestJson(
  url: string,
  input: {
    method?: string
    headers: Record<string, string>
    body?: string
  },
  context: ProbeContext
): Promise<unknown> {
  let response: Response
  try {
    response = await context.fetcher(url, {
      method: input.method ?? 'GET',
      redirect: 'error',
      headers: input.headers,
      ...(input.body === undefined ? {} : { body: input.body }),
      signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS)
    }, context.proxyUrl)
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || /abort|timeout/iu.test(error.message))) {
      throw new Error('The subscription quota request timed out.')
    }
    throw new Error('The subscription quota request could not reach the provider.')
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ProviderQuotaAuthorizationError(response.status)
    }
    throw new Error(`The provider quota endpoint returned HTTP ${response.status}.`)
  }
  const text = await boundedResponseText(response)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('The provider returned malformed quota data.')
  }
}

export function requestCodexSubscriptionQuota(
  credential: CodexCredential,
  context: ProbeContext
): Promise<unknown> {
  return requestJson(
    'https://chatgpt.com/backend-api/wham/usage',
    {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${credential.accessToken}`,
        'User-Agent': codexCliUserAgent(),
        ...(credential.accountId ? { 'ChatGPT-Account-Id': credential.accountId } : {})
      }
    },
    context
  )
}

export async function requestResponse(
  url: string,
  input: {
    method?: string
    headers: Record<string, string>
    body?: BodyInit
  },
  context: ProbeContext
): Promise<Response> {
  let response: Response
  try {
    response = await context.fetcher(url, {
      method: input.method ?? 'GET',
      redirect: 'error',
      headers: input.headers,
      ...(input.body === undefined ? {} : { body: input.body }),
      signal: AbortSignal.timeout(QUOTA_TIMEOUT_MS)
    }, context.proxyUrl)
  } catch (error) {
    if (error instanceof Error && (error.name === 'AbortError' || /abort|timeout/iu.test(error.message))) {
      throw new Error('The subscription quota request timed out.')
    }
    throw new Error('The subscription quota request could not reach the provider.')
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ProviderQuotaAuthorizationError(response.status)
    }
    throw new Error(`The provider quota endpoint returned HTTP ${response.status}.`)
  }
  return response
}

export async function boundedResponseBytes(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('The provider quota response was too large.')
  }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('The provider quota response was too large.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

export async function boundedResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error('The provider quota response was too large.')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let output = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel()
        throw new Error('The provider quota response was too large.')
      }
      output += decoder.decode(value, { stream: true })
    }
    return output + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

export type ProtobufScan = {
  fixed32Fields: Array<{ path: number[]; value: number; order: number }>
  varintFields: Array<{ path: number[]; value: number }>
}

export function scanProtobuf(
  input: Uint8Array,
  depth: number,
  path: number[],
  order: { value: number }
): ProtobufScan {
  const scan: ProtobufScan = { fixed32Fields: [], varintFields: [] }
  let index = 0
  while (index < input.length) {
    const fieldStart = index
    const key = readUnsignedVarint(input, index)
    if (!key || key.value === 0) {
      index = fieldStart + 1
      continue
    }
    index = key.offset
    const fieldNumber = Math.floor(key.value / 8)
    const wireType = key.value % 8
    const fieldPath = [...path, fieldNumber]
    if (wireType === 0) {
      const value = readUnsignedVarint(input, index)
      if (!value) {
        index = fieldStart + 1
        continue
      }
      index = value.offset
      scan.varintFields.push({ path: fieldPath, value: value.value })
      continue
    }
    if (wireType === 1) {
      if (index + 8 > input.length) break
      index += 8
      continue
    }
    if (wireType === 2) {
      const length = readUnsignedVarint(input, index)
      if (!length || length.value > input.length - length.offset) {
        index = fieldStart + 1
        continue
      }
      const start = length.offset
      const end = start + length.value
      if (depth < 4) {
        mergeProtobufScan(
          scan,
          scanProtobuf(input.subarray(start, end), depth + 1, fieldPath, order)
        )
      }
      index = end
      continue
    }
    if (wireType === 5) {
      if (index + 4 > input.length) break
      const view = new DataView(input.buffer, input.byteOffset + index, 4)
      scan.fixed32Fields.push({
        path: fieldPath,
        value: view.getFloat32(0, true),
        order: order.value
      })
      order.value += 1
      index += 4
      continue
    }
    index = fieldStart + 1
  }
  return scan
}

export function mergeProtobufScan(target: ProtobufScan, source: ProtobufScan): void {
  target.fixed32Fields.push(...source.fixed32Fields)
  target.varintFields.push(...source.varintFields)
}

export function readUnsignedVarint(
  input: Uint8Array,
  initialOffset: number
): { value: number; offset: number } | undefined {
  let value = 0
  let multiplier = 1
  let offset = initialOffset
  for (let count = 0; count < 8 && offset < input.length; count += 1) {
    const byte = input[offset]!
    offset += 1
    value += (byte & 0x7f) * multiplier
    if ((byte & 0x80) === 0) {
      return Number.isSafeInteger(value) ? { value, offset } : undefined
    }
    multiplier *= 128
  }
  return undefined
}

export function grpcWebDataFrames(input: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = []
  let index = 0
  while (index < input.length) {
    if (index + 5 > input.length) return []
    const flags = input[index]!
    const length =
      input[index + 1]! * 0x1000000 +
      input[index + 2]! * 0x10000 +
      input[index + 3]! * 0x100 +
      input[index + 4]!
    const start = index + 5
    const end = start + length
    if (end > input.length) return []
    if ((flags & 0x80) === 0) frames.push(input.subarray(start, end))
    index = end
  }
  return frames
}

export function grpcWebTrailerFields(input: Uint8Array): Record<string, string> {
  const fields: Record<string, string> = {}
  let index = 0
  while (index + 5 <= input.length) {
    const flags = input[index]!
    const length =
      input[index + 1]! * 0x1000000 +
      input[index + 2]! * 0x10000 +
      input[index + 3]! * 0x100 +
      input[index + 4]!
    const start = index + 5
    const end = start + length
    if (end > input.length) break
    if ((flags & 0x80) !== 0) {
      const text = new TextDecoder().decode(input.subarray(start, end))
      for (const line of text.split(/\r?\n/u)) {
        const separator = line.indexOf(':')
        if (separator <= 0) continue
        const key = line.slice(0, separator).trim().toLowerCase()
        const rawValue = line.slice(separator + 1).trim()
        try {
          fields[key] = decodeURIComponent(rawValue)
        } catch {
          fields[key] = rawValue
        }
      }
    }
    index = end
  }
  return fields
}

export function looksLikeProtobufPayload(input: Uint8Array): boolean {
  const first = input[0]
  if (first === undefined) return false
  const fieldNumber = first >> 3
  const wireType = first & 0x07
  return fieldNumber > 0 && [0, 1, 2, 5].includes(wireType)
}

export function assertGrokGrpcStatus(
  rawStatus: string | null | undefined,
  rawMessage: string | null | undefined
): void {
  if (!rawStatus) return
  const status = Number(rawStatus)
  if (!Number.isFinite(status) || status === 0) return
  const message = rawMessage?.trim() ?? ''
  if (status === 7 || status === 16) {
    throw new Error(
      'Grok billing rejected the existing login. Reconnect Grok or run `grok login`; some accounts also require a grok.com browser session.'
    )
  }
  if (status === 9 && /^no personal team\.?$/iu.test(message)) {
    throw new Error('Grok team quota is unavailable from the current billing API.')
  }
  throw new Error(`Grok billing RPC returned status ${status}${message ? `: ${message}` : '.'}`)
}

export function sameNumberPath(left: number[], right: number[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index])
}

export function startsWithNumberPath(path: number[], prefix: number[]): boolean {
  return prefix.length <= path.length &&
    prefix.every((value, index) => value === path[index])
}
