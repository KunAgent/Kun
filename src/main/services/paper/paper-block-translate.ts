import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PAPER_CACHE_DIR_NAME } from '../../../shared/paper/paper-types'
import type { AppSettingsV1 } from '../../../shared/app-settings'
import { oneShotModelRequest } from '../one-shot-model-request'
import { resolvePaperTranslateModel } from './paper-translate-service'

/**
 * R2.2 overlay block translation: the renderer sends pre-masked text blocks
 * (`⟦n⟧` placeholders keep math/URLs/citations opaque). Blocks batch into
 * ≤4500-char requests behind `[[n]]` markers so one model call translates a
 * whole batch; a marker-count mismatch degrades the batch to per-block
 * requests. Translations cache per block (sha1 of the masked source) in
 * `.cache/translate-blocks-<lang>-<modelHash>.json` — same convention as the
 * whole-document translator.
 */

export const BLOCK_BATCH_MAX_CHARS = 4_500
const BLOCK_BATCH_CONCURRENCY = 2
const BLOCK_TRANSLATE_TIMEOUT_MS = 90_000

export type TranslateBlockInput = { id: string; text: string }

type TranslateCache = Record<string, string>

/** Sequential packing: a batch is blocks whose joined text fits `maxChars`. */
export function groupBlocksIntoBatches(
  blocks: readonly TranslateBlockInput[],
  maxChars: number = BLOCK_BATCH_MAX_CHARS
): TranslateBlockInput[][] {
  const batches: TranslateBlockInput[][] = []
  let current: TranslateBlockInput[] = []
  let size = 0
  for (const block of blocks) {
    const blockSize = block.text.length + 8 // `[[n]]` marker + newlines
    if (current.length && size + blockSize > maxChars) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(block)
    size += blockSize
    // An oversized single block still forms its own batch — the fallback path
    // translates it alone when the marker parse fails.
    if (size >= maxChars) {
      batches.push(current)
      current = []
      size = 0
    }
  }
  if (current.length) batches.push(current)
  return batches
}

/** Each block is prefixed `[[index-in-batch]]` on its own line. */
export function buildBlockBatchPrompt(batch: readonly TranslateBlockInput[]): string {
  return batch.map((block, index) => `[[${index}]]\n${block.text}`).join('\n\n')
}

/**
 * Split a reply on `[[n]]` markers back into per-block text. Returns null
 * when any expected marker is missing — the caller then falls back to
 * translating that batch one block at a time.
 */
export function parseBlockBatchReply(
  reply: string,
  batch: readonly TranslateBlockInput[]
): Record<string, string> | null {
  const parts = reply.split(/\[\[\s*(\d+)\s*\]\]/)
  // parts alternates: [prefix, n, text, n, text, …]
  const byIndex = new Map<number, string>()
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const index = Number(parts[i])
    const text = parts[i + 1].trim()
    if (!byIndex.has(index)) byIndex.set(index, text)
  }
  const out: Record<string, string> = {}
  for (const [index, block] of batch.entries()) {
    const text = byIndex.get(index)
    if (text === undefined) return null
    out[block.id] = text
  }
  return out
}

const blockKey = (text: string): string => createHash('sha1').update(text).digest('hex')

function blockTranslateSystemPrompt(targetLanguage: 'zh' | 'en'): string {
  return [
    `You are an academic-paper translator. Translate every [[n]]-marked block into ${targetLanguage === 'zh' ? 'Simplified Chinese' : 'English'}.`,
    'Rules: keep the [[n]] markers, the block order and the block count verbatim; keep ⟦n⟧ tokens,',
    'formulas, citation markers, figure/table numbers and inline code unchanged; on the first',
    'occurrence of a technical term append the original in parentheses; output only the translated',
    'blocks — no explanations, no commentary.'
  ].join(' ')
}

async function readTranslateCache(path: string): Promise<TranslateCache> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as TranslateCache
    }
  } catch {
    // Missing or corrupt cache is fine — retranslate.
  }
  return {}
}

export async function translatePaperBlocks(input: {
  settings: AppSettingsV1
  unitDirAbs: string
  blocks: TranslateBlockInput[]
  targetLanguage: 'zh' | 'en'
  providerId?: string
  model?: string
}): Promise<
  | { ok: true; translations: Record<string, string>; cachedBlocks: number; translatedBlocks: number }
  | { ok: false; code: 'network' | 'timeout' | 'config' | 'io' | 'invalid-unit' | 'invalid-input'; message: string }
> {
  const model = resolvePaperTranslateModel(input.settings, {
    providerId: input.providerId,
    model: input.model
  })
  if (!model) return { ok: false, code: 'config', message: 'No translation model configured.' }
  if (!input.blocks.length) {
    return { ok: false, code: 'invalid-input', message: 'No blocks to translate.' }
  }

  const modelHash = createHash('sha1')
    .update(`${model.providerId}/${model.model}`)
    .digest('hex')
    .slice(0, 12)
  const cacheDir = join(input.unitDirAbs, PAPER_CACHE_DIR_NAME)
  const cachePath = join(cacheDir, `translate-blocks-${input.targetLanguage}-${modelHash}.json`)
  const cache = await readTranslateCache(cachePath)

  const translations: Record<string, string> = {}
  const pending = input.blocks.filter((block) => {
    const hit = cache[blockKey(block.text)]
    if (hit) {
      translations[block.id] = hit
      return false
    }
    return true
  })
  const cachedBlocks = input.blocks.length - pending.length
  if (!pending.length) {
    return { ok: true, translations, cachedBlocks, translatedBlocks: 0 }
  }

  const request = async (text: string) =>
    oneShotModelRequest({
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      endpointFormat: model.endpointFormat,
      responsesMode: model.responsesMode,
      model: model.model,
      systemPrompt: blockTranslateSystemPrompt(input.targetLanguage),
      userText: text,
      timeoutMs: BLOCK_TRANSLATE_TIMEOUT_MS,
      proxyUrl: model.proxyUrl,
      providerId: model.providerId
    })

  let cacheDirty = false
  const flushCache = async (): Promise<void> => {
    if (!cacheDirty) return
    cacheDirty = false
    await mkdir(cacheDir, { recursive: true })
    await writeFile(cachePath, JSON.stringify(cache), 'utf8')
  }

  const batches = groupBlocksIntoBatches(pending)
  let cursor = 0
  const worker = async (): Promise<{ ok: boolean; message?: string }> => {
    while (cursor < batches.length) {
      const batch = batches[cursor]
      cursor += 1
      const result = await request(buildBlockBatchPrompt(batch))
      if (result.ok) {
        const parsed = parseBlockBatchReply(result.text, batch)
        if (parsed) {
          for (const block of batch) {
            cache[blockKey(block.text)] = parsed[block.id]
            translations[block.id] = parsed[block.id]
          }
          cacheDirty = true
          await flushCache().catch(() => undefined)
          continue
        }
      }
      // Marker mismatch or request failure → per-block fallback.
      for (const block of batch) {
        const single = await request(block.text)
        if (!single.ok) {
          return { ok: false, message: result.ok ? single.message : result.message }
        }
        cache[blockKey(block.text)] = single.text
        translations[block.id] = single.text
        cacheDirty = true
      }
      await flushCache().catch(() => undefined)
    }
    return { ok: true }
  }

  try {
    const workers = Array.from({ length: Math.min(BLOCK_BATCH_CONCURRENCY, batches.length) }, worker)
    const results = await Promise.all(workers)
    const failed = results.find((r) => !r.ok)
    await flushCache().catch(() => undefined)
    if (failed) {
      return { ok: false, code: 'network', message: failed.message ?? 'Translation failed.' }
    }
  } catch (error) {
    await flushCache().catch(() => undefined)
    return {
      ok: false,
      code: 'io',
      message: error instanceof Error ? error.message : String(error)
    }
  }
  return {
    ok: true,
    translations,
    cachedBlocks,
    translatedBlocks: pending.length
  }
}
