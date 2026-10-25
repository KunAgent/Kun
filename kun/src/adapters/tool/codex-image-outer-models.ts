import { codexProviderCatalogUrl } from '../model/codex-provider-catalog.js'
import { codexCliUserAgent } from '../model/provider-cli-identity.js'
import {
  parseCodexResponsesImageEvents,
  readLimitedResponseText
} from './image-gen-client-codecs.js'

/**
 * Outer Responses models with maintained evidence that they host the native
 * `image_generation` tool. Order is the maintained preference; the account
 * catalog decides which of them this plan may actually call.
 */
export const CODEX_IMAGE_RESPONSES_MODELS = ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'] as const

/**
 * Catalog models tried after the maintained list, in catalog order (newest
 * first). They cost a request only after the provider explicitly rejected an
 * earlier outer model, so plan changes cannot strand image generation on a
 * stale hardcoded name.
 */
const MAX_OUTER_MODEL_ATTEMPTS = 4

const CATALOG_TIMEOUT_MS = 10_000
const MAX_CATALOG_BYTES = 2_000_000
const MAX_DETAIL_CHARS = 400

/** The provider rejected the outer model, not the image model or a tool field. */
export class CodexOuterModelRejectedError extends Error {
  constructor(
    readonly outerModel: string,
    readonly detail: string
  ) {
    super(detail)
    this.name = 'CodexOuterModelRejectedError'
  }
}

/**
 * The account catalog is readable only when this call already holds a ChatGPT
 * subscription credential, because the catalog lives at its issuer. A plain
 * relay API key must never be forwarded there, so that case keeps the
 * maintained order and never contacts chatgpt.com.
 */
export function shouldUseCodexAccountCatalog(input: {
  baseUrl: string
  headers: Record<string, string> | undefined
}): boolean {
  if (hasChatGptAccountHeader(input.headers)) return true
  return isOfficialCodexBaseUrl(input.baseUrl)
}

function hasChatGptAccountHeader(headers: Record<string, string> | undefined): boolean {
  return Object.keys(headers ?? {}).some((key) => key.toLowerCase() === 'chatgpt-account-id')
}

function isOfficialCodexBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl.trim())
    return url.protocol === 'https:' &&
      url.hostname.toLowerCase() === 'chatgpt.com' &&
      /^\/backend-api\/codex(?:\/|$)/iu.test(url.pathname)
  } catch {
    return false
  }
}

/**
 * Outer-model candidates for one image call, plus whether the account catalog
 * produced them. A ChatGPT subscription resolves them from its own catalog, so
 * a model the plan does not offer is never sent first. A connection without a
 * ChatGPT credential keeps the original single-attempt behavior, because
 * without account evidence a swap would only spend the user's quota.
 */
export type CodexImageOuterModelPlan = {
  models: string[]
  accountCatalog: boolean
}

export async function resolveCodexImageOuterModels(input: {
  baseUrl: string
  apiKey: string
  headers: Record<string, string> | undefined
  fetchImpl: typeof fetch
  signal: AbortSignal
}): Promise<CodexImageOuterModelPlan> {
  if (!shouldUseCodexAccountCatalog(input)) {
    return { models: [CODEX_IMAGE_RESPONSES_MODELS[0]], accountCatalog: false }
  }
  const catalog = await fetchAccountModelIds(input)
  if (!catalog) {
    throw new Error(
      'codex image generation could not read the ChatGPT account model catalog, ' +
      `so no image-capable outer model can be confirmed (image model unchanged). ` +
      `Expected a JSON model list from ${codexProviderCatalogUrl().split('?')[0]}`
    )
  }
  const maintained = CODEX_IMAGE_RESPONSES_MODELS.filter((model) => catalog.has(model))
  const others = [...catalog].filter((model) => !CODEX_IMAGE_RESPONSES_MODELS.includes(
    model as (typeof CODEX_IMAGE_RESPONSES_MODELS)[number]
  ))
  const candidates = [...maintained, ...others].slice(0, MAX_OUTER_MODEL_ATTEMPTS)
  if (candidates.length === 0) {
    throw new Error(
      'codex image generation found no usable outer model on this ChatGPT account ' +
      '(image model unchanged). The account catalog may need a newer Kun build.'
    )
  }
  return { models: candidates, accountCatalog: true }
}

async function fetchAccountModelIds(input: {
  apiKey: string
  headers: Record<string, string> | undefined
  fetchImpl: typeof fetch
  signal: AbortSignal
}): Promise<Set<string> | null> {
  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(input.headers ?? {})) {
    if (key.toLowerCase() === 'user-agent') continue
    headers[key] = value
  }
  headers.Accept = 'application/json'
  headers['User-Agent'] = codexCliUserAgent()
  if (!input.apiKey.trim()) return null
  headers.Authorization = `Bearer ${input.apiKey}`
  let response: Response
  try {
    response = await input.fetchImpl(codexProviderCatalogUrl(), {
      method: 'GET',
      redirect: 'error',
      headers,
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(CATALOG_TIMEOUT_MS)])
    })
  } catch (error) {
    if (input.signal.aborted) throw error
    return null
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  let text: string
  try {
    text = await readLimitedResponseText(response, MAX_CATALOG_BYTES)
  } catch {
    return null
  }
  return parseModelSlugs(text)
}

function parseModelSlugs(text: string): Set<string> | null {
  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    return null
  }
  const rows = (root as { models?: unknown } | null)?.models
  if (!Array.isArray(rows)) return null
  const slugs = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as { slug?: unknown; id?: unknown }
    const slug = typeof record.slug === 'string' ? record.slug : record.id
    if (typeof slug === 'string' && slug.trim()) slugs.add(slug.trim().toLowerCase())
  }
  return slugs
}

const OUTER_MODEL_REJECTION =
  /is not supported|not supported when using|unsupported model|model[_ ]not[_ ]found|model is not available|does not have access to (?:the |this )?model|model_not_available/iu
/**
 * Some plans answer with a capability error instead of naming the plan limit.
 * It still means this outer model cannot host the tool, so another candidate
 * is worth exactly one request.
 */
const IMAGE_TOOL_UNSUPPORTED =
  /image[_ ]generation.{0,160}(?:not supported|unsupported|is not available|unavailable|not enabled)|(?:not supported|unsupported|not available|unavailable|not enabled).{0,160}image[_ ]generation/isu
const IMAGE_TOOL_PARAMETER_ERROR = /tool[_ ]choice|allowed_tools|input_fidelity/iu

/**
 * The provider rejected this outer model, not the image model and not a tool
 * parameter. A rejection that names the image model, a tool field, or both
 * models stays with the existing error paths instead of spending a request on
 * another model.
 */
export function isCodexOuterModelRejection(input: {
  status?: number
  text: string
  outerModel: string
  imageModel: string
}): boolean {
  const text = input.text.trim()
  if (!text) return false
  if (input.status !== undefined && ![400, 404, 422].includes(input.status)) return false
  if (IMAGE_TOOL_PARAMETER_ERROR.test(text)) return false
  if (input.imageModel.trim() && namesModel(text, input.imageModel)) return false
  if (namesModel(text, input.outerModel) && OUTER_MODEL_REJECTION.test(text)) return true
  return IMAGE_TOOL_UNSUPPORTED.test(text)
}

function namesModel(text: string, model: string): boolean {
  const id = model.trim()
  if (!id) return false
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(^|[^a-z0-9._-])${escaped}([^a-z0-9._-]|$)`, 'iu').test(text)
}

/**
 * True once the response shows image work under way. Switching outer models
 * after that point would spend the account's quota twice for one request.
 */
export function codexImageGenerationStarted(body: string): boolean {
  let events
  try {
    events = parseCodexResponsesImageEvents(body)
  } catch {
    return true
  }
  return events.some((event) =>
    Boolean(event.partial_image_b64) || event.item?.type === 'image_generation_call'
  )
}

/** Bounded, single-line provider text safe to surface in a tool error. */
export function codexProviderDetail(body: string): string {
  const text = body.replace(/\s+/gu, ' ').trim()
  return text.length > MAX_DETAIL_CHARS ? `${text.slice(0, MAX_DETAIL_CHARS)}...` : text
}
