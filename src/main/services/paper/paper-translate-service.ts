import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  getModelProviderProfile,
  modelProviderModelProfile,
  resolveKunRuntimeSettings,
  resolveProviderProxyUrl,
  type AppSettingsV1
} from '../../../shared/app-settings'
import type { PaperUnitMetaV2 } from '../../../shared/paper/paper-meta-v2'
import { PAPER_CACHE_DIR_NAME, PAPER_TEXT_FILE_NAME } from '../../../shared/paper/paper-types'
import { normalizeWritePaperModeSettings } from '../../../shared/app-settings-paper-mode'
import type { WritePaperModeSettingsPatchV1 } from '../../../shared/app-settings-types-paper-mode'
import { oneShotModelRequest } from '../one-shot-model-request'
import { isPaperJobCanceled } from './paper-jobs'

/**
 * Paper translation (plan §6.4): selection translation is one model request;
 * whole-document translation chunks `paper.md` on `<!-- page N -->` markers,
 * caches chunks under `.cache/translate-<lang>-<modelHash>.json`, and writes
 * `<slug>-译文.md`. Progress/cancel ride the shared paper-jobs channel.
 */

export const PAPER_TRANSLATE_SELECTION_MAX_CHARS = 2000
const TRANSLATE_CHUNK_MAX_CHARS = 4000
const TRANSLATE_TIMEOUT_MS = 60_000

type TranslateTargetLanguage = 'zh' | 'en'

export type PaperTranslateModel = {
  providerId: string
  model: string
  apiKey: string
  baseUrl: string
  endpointFormat: ReturnType<typeof resolveModelFormat>
  responsesMode?: 'lite'
  proxyUrl?: string
}

function resolveModelFormat(settings: AppSettingsV1, providerId: string, model: string) {
  const provider = getModelProviderProfile(settings, providerId)
  const profile = modelProviderModelProfile(provider, model)
  return profile?.endpointFormat ?? provider.endpointFormat
}

/**
 * Translate model resolution: `translate.inheritModel` follows the Kun
 * runtime model; otherwise `translate.providerId`/`model` are used. Returns
 * null when no usable provider/model pair exists.
 */
export function resolvePaperTranslateModel(
  settings: AppSettingsV1,
  override?: { providerId?: string; model?: string }
): PaperTranslateModel | null {
  const runtime = resolveKunRuntimeSettings(settings)
  const translate = normalizeWritePaperModeSettings(
    (settings.write as { paperMode?: WritePaperModeSettingsPatchV1 } | undefined)?.paperMode
  ).translate
  const providerId = (override?.providerId?.trim()
    || (translate.inheritModel ? '' : translate.providerId.trim())
    || runtime.providerId.trim())
  const provider = getModelProviderProfile(settings, providerId)
  const model = override?.model?.trim()
    || (translate.inheritModel ? '' : translate.model.trim())
    || runtime.model.trim()
    || provider.models.map((item) => item.trim()).find(Boolean)
    || ''
  if (!model) return null
  const apiKey = provider.apiKey.trim() || runtime.apiKey.trim()
  if (!apiKey) return null
  return {
    providerId: provider.id,
    model,
    apiKey,
    baseUrl: provider.baseUrl.trim() || runtime.baseUrl.trim() || DEFAULT_DEEPSEEK_BASE_URL,
    endpointFormat: resolveModelFormat(settings, provider.id, model),
    responsesMode: modelProviderModelProfile(provider, model)?.responsesMode,
    proxyUrl: resolveProviderProxyUrl(settings, provider.id)
  }
}

const LANGUAGE_NAME: Record<TranslateTargetLanguage, string> = {
  zh: 'Simplified Chinese',
  en: 'English'
}

function translateSystemPrompt(targetLanguage: TranslateTargetLanguage): string {
  return [
    `You are an academic-paper translator. Translate the user's text into ${LANGUAGE_NAME[targetLanguage]}.`,
    'Rules: keep formulas, citation markers ([12], (Vaswani et al.)), figure/table numbers,',
    'and inline code verbatim; on the first occurrence of a technical term append the original',
    'in parentheses; output only the translation — no explanations, no commentary.'
  ].join(' ')
}

export async function translatePaperSelection(input: {
  settings: AppSettingsV1
  text: string
  targetLanguage: TranslateTargetLanguage
  providerId?: string
  model?: string
}): Promise<
  | { ok: true; translation: string; model: string; providerId: string }
  | { ok: false; code: 'network' | 'config' | 'invalid-input'; message: string }
> {
  const text = input.text.trim()
  if (!text) return { ok: false, code: 'invalid-input', message: 'Nothing to translate.' }
  if (text.length > PAPER_TRANSLATE_SELECTION_MAX_CHARS) {
    return {
      ok: false,
      code: 'invalid-input',
      message: `Selection exceeds ${PAPER_TRANSLATE_SELECTION_MAX_CHARS} characters.`
    }
  }
  const model = resolvePaperTranslateModel(input.settings, {
    providerId: input.providerId,
    model: input.model
  })
  if (!model) {
    return { ok: false, code: 'config', message: 'No translation model configured.' }
  }
  const result = await oneShotModelRequest({
    baseUrl: model.baseUrl,
    apiKey: model.apiKey,
    endpointFormat: model.endpointFormat,
    responsesMode: model.responsesMode,
    model: model.model,
    systemPrompt: translateSystemPrompt(input.targetLanguage),
    userText: text,
    timeoutMs: TRANSLATE_TIMEOUT_MS,
    proxyUrl: model.proxyUrl,
    providerId: model.providerId
  })
  if (!result.ok) {
    return { ok: false, code: 'network', message: result.message }
  }
  return { ok: true, translation: result.text, model: model.model, providerId: model.providerId }
}

// ---- whole-document translation ---------------------------------------------

type TranslateCache = Record<string, string>

async function readTranslateCache(path: string): Promise<TranslateCache> {
  try {
    const raw = await readFile(path, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as TranslateCache
    }
  } catch {
    // Missing or corrupt cache is fine — retranslate.
  }
  return {}
}

/**
 * Split `paper.md` on `<!-- page N -->` markers; the marker stays attached to
 * the chunk it introduces so the output preserves page boundaries.
 */
export function splitPaperTextIntoChunks(text: string): string[] {
  const parts = text.split(/(?=<!--\s*page\s+\d+\s*-->)/)
  const chunks: string[] = []
  for (const part of parts) {
    if (!part.trim()) continue
    if (part.length <= TRANSLATE_CHUNK_MAX_CHARS) {
      chunks.push(part)
      continue
    }
    // Oversized chunk (dense page): split on paragraph boundaries.
    let remaining = part
    while (remaining.length > TRANSLATE_CHUNK_MAX_CHARS) {
      let cut = remaining.lastIndexOf('\n\n', TRANSLATE_CHUNK_MAX_CHARS)
      if (cut < TRANSLATE_CHUNK_MAX_CHARS / 2) cut = TRANSLATE_CHUNK_MAX_CHARS
      chunks.push(remaining.slice(0, cut))
      remaining = remaining.slice(cut)
    }
    if (remaining.trim()) chunks.push(remaining)
  }
  return chunks
}

function chunkHash(chunk: string): string {
  return createHash('sha1').update(chunk).digest('hex')
}

export async function translatePaperDocument(input: {
  settings: AppSettingsV1
  unitDirAbs: string
  meta: PaperUnitMetaV2
  targetLanguage: TranslateTargetLanguage
  providerId?: string
  model?: string
  signal: AbortSignal
  progress: (done: number, total: number) => void
}): Promise<
  | { ok: true; outputPath: string; cachedChunks: number; translatedChunks: number }
  | { ok: false; code: 'network' | 'config' | 'io' | 'canceled' | 'invalid-unit'; message: string }
> {
  const model = resolvePaperTranslateModel(input.settings, {
    providerId: input.providerId,
    model: input.model
  })
  if (!model) return { ok: false, code: 'config', message: 'No translation model configured.' }

  let source: string
  try {
    source = await readFile(join(input.unitDirAbs, PAPER_TEXT_FILE_NAME), 'utf8')
  } catch {
    return {
      ok: false,
      code: 'invalid-unit',
      message: `${PAPER_TEXT_FILE_NAME} is missing — run preprocessing first.`
    }
  }
  const chunks = splitPaperTextIntoChunks(source)
  if (chunks.length === 0) {
    return { ok: false, code: 'invalid-unit', message: 'paper.md has no translatable text.' }
  }

  const modelHash = createHash('sha1').update(`${model.providerId}/${model.model}`).digest('hex').slice(0, 12)
  const cacheDir = join(input.unitDirAbs, PAPER_CACHE_DIR_NAME)
  const cachePath = join(cacheDir, `translate-${input.targetLanguage}-${modelHash}.json`)
  const cache = await readTranslateCache(cachePath)

  const translated: string[] = []
  let cachedChunks = 0
  let translatedChunks = 0
  try {
    for (const [index, chunk] of chunks.entries()) {
      if (input.signal.aborted) {
        return { ok: false, code: 'canceled', message: 'Translation canceled.' }
      }
      const key = chunkHash(chunk)
      const hit = cache[key]
      if (hit) {
        translated.push(hit)
        cachedChunks += 1
      } else {
        const result = await oneShotModelRequest({
          baseUrl: model.baseUrl,
          apiKey: model.apiKey,
          endpointFormat: model.endpointFormat,
          responsesMode: model.responsesMode,
          model: model.model,
          systemPrompt: translateSystemPrompt(input.targetLanguage),
          userText: chunk,
          timeoutMs: TRANSLATE_TIMEOUT_MS * 2,
          proxyUrl: model.proxyUrl,
          providerId: model.providerId
        })
        if (!result.ok) {
          return { ok: false, code: 'network', message: result.message }
        }
        cache[key] = result.text
        translated.push(result.text)
        translatedChunks += 1
        await mkdir(cacheDir, { recursive: true })
        await writeFile(cachePath, JSON.stringify(cache), 'utf8')
      }
      input.progress(index + 1, chunks.length)
    }
  } catch (error) {
    if (isPaperJobCanceled(input.signal, error)) {
      return { ok: false, code: 'canceled', message: 'Translation canceled.' }
    }
    return { ok: false, code: 'io', message: error instanceof Error ? error.message : String(error) }
  }

  const header = [
    `# ${input.meta.title} — ${LANGUAGE_NAME[input.targetLanguage]} translation`,
    '',
    `> Model: ${model.providerId}/${model.model}. Generated translation; verify before citing.`,
    ''
  ].join('\n')
  const outputName = `${input.meta.slug}-译文.md`
  const outputPath = join(input.unitDirAbs, outputName)
  try {
    await writeFile(outputPath, `${header}\n${translated.join('\n\n')}\n`, 'utf8')
  } catch (error) {
    return { ok: false, code: 'io', message: error instanceof Error ? error.message : String(error) }
  }
  return { ok: true, outputPath: outputName, cachedChunks, translatedChunks }
}
