import {
  modelProviderModelProfile,
  resolveModelEndpointFormat,
  resolveProviderProxyUrl,
  resolveWriteInlineCompletionApiKey,
  resolveWriteInlineCompletionEndpointBaseUrl,
  resolveWriteInlineCompletionEndpointFormat,
  resolveWriteInlineCompletionModel,
  resolveWriteInlineCompletionProviderProfile,
  type AppSettingsV1
} from '../../shared/app-settings'
import type {
  ColabNotebookAssistRequest,
  ColabNotebookAssistResult
} from '../../shared/colab/colab-notebook-types'
import { openCodeSessionRuntimeHeaders } from '../../shared/opencode-session'
import {
  resolveCodexResponsesRequestAuth,
  usesCodexResponsesLite
} from '../codex-responses-lite'
import { fetchWithOptionalProxy } from '../proxy-fetch'
import {
  buildProviderHeaders,
  buildProviderRequestBody,
  compatibleModelEndpointUrl,
  providerTextFromResponse
} from '../services/write-inline-completion-transport'

const ASSIST_TIMEOUT_MS = 45_000
const ASSIST_MAX_TOKENS = 2048

const SYSTEM_PROMPT = [
  'You are Kun, an AI assistant embedded inside a Jupyter/Colab Python notebook.',
  'Generate or revise a single notebook cell satisfying the user instruction.',
  'Default to executable Python 3 code (Colab environment, /content working dir).',
  'For large model weights and training checkpoints (output_dir, LoRA/SFT/RL checkpoints), prefer persisting under Google Drive (/content/drive/MyDrive/...) rather than ephemeral /content.',
  'Only produce Markdown when the user explicitly asks for markdown/notes/documentation.',
  'Return ONLY one fenced block (` ```python ... ``` ` or ` ```markdown ... ``` `) with no prose outside the fence.'
].join('\n')

export function extractNotebookAssistCell(raw: string): { kind: 'code' | 'markdown'; source: string } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const fenced = /^```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)\r?\n?```$/.exec(trimmed)
  if (fenced) {
    const lang = fenced[1].toLowerCase()
    const kind = lang === 'markdown' || lang === 'md' ? 'markdown' : 'code'
    return { kind, source: fenced[2].trimEnd() }
  }
  const inner = /```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/.exec(trimmed)
  if (inner) {
    const lang = inner[1].toLowerCase()
    const kind = lang === 'markdown' || lang === 'md' ? 'markdown' : 'code'
    return { kind, source: inner[2].trimEnd() }
  }
  return { kind: 'code', source: trimmed }
}

function buildContextPrompt(req: ColabNotebookAssistRequest): string {
  const parts: string[] = []
  if (req.cells.length > 0) {
    const summary = req.cells
      .slice(-12)
      .map((cell, idx) => {
        const tag = cell.selected ? `Cell ${idx + 1} (${cell.kind}, SELECTED TARGET)` : `Cell ${idx + 1} (${cell.kind})`
        const out = cell.output?.trim() ? `\nOutput:\n${cell.output.slice(0, 1200)}` : ''
        return `### ${tag}\n${cell.source.slice(0, 2400)}${out}`
      })
      .join('\n\n')
    parts.push(`Notebook context:\n${summary}`)
  }
  parts.push(
    req.mode === 'replace'
      ? `Task (replace the SELECTED TARGET cell): ${req.prompt.trim()}`
      : `Task (write a new cell to append/insert): ${req.prompt.trim()}`
  )
  return parts.join('\n\n')
}

export async function requestColabNotebookAssist(
  settings: AppSettingsV1,
  request: ColabNotebookAssistRequest
): Promise<ColabNotebookAssistResult> {
  const rawApiKey = resolveWriteInlineCompletionApiKey(settings)
  if (!rawApiKey) {
    return { ok: false, message: 'Missing model provider API key in Settings.' }
  }
  const model = resolveWriteInlineCompletionModel(settings)
  const baseUrl = resolveWriteInlineCompletionEndpointBaseUrl(settings)
  const provider = resolveWriteInlineCompletionProviderProfile(settings)
  const responsesLite = usesCodexResponsesLite(
    baseUrl,
    modelProviderModelProfile(provider, model)?.responsesMode
  )
  const auth = resolveCodexResponsesRequestAuth(baseUrl, rawApiKey)
  if (!auth.apiKey) {
    return { ok: false, message: 'Missing model provider API key in Settings.' }
  }
  const configuredFormat = resolveWriteInlineCompletionEndpointFormat(settings)
  const endpointFormat = resolveModelEndpointFormat(configuredFormat, baseUrl)
  if (!endpointFormat) {
    return { ok: false, message: 'Invalid provider endpoint format in Settings.' }
  }
  const url = compatibleModelEndpointUrl(baseUrl, configuredFormat)
  try {
    const body = buildProviderRequestBody({
      responseFormat: endpointFormat,
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildContextPrompt(request) }
      ],
      prompt: '',
      suffix: '',
      maxTokens: ASSIST_MAX_TOKENS,
      responsesLite
    })
    const response = await fetchWithOptionalProxy(
      url,
      {
        method: 'POST',
        headers: {
          ...buildProviderHeaders(auth.apiKey, endpointFormat, auth.headers, responsesLite),
          ...openCodeSessionRuntimeHeaders({
            presetSource: provider.presetSource?.presetId,
            providerId: provider.id,
            baseUrl
          })
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ASSIST_TIMEOUT_MS)
      },
      resolveProviderProxyUrl(settings, provider)
    )
    const text = await response.text()
    if (!response.ok) {
      return { ok: false, message: `Kun assist failed (${response.status}): ${text.slice(0, 240)}` }
    }
    const parsed = extractNotebookAssistCell(providerTextFromResponse(text, endpointFormat))
    if (!parsed || !parsed.source.trim()) {
      return { ok: false, message: 'Model returned an empty response.' }
    }
    return { ok: true, ...parsed }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
