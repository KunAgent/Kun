import { asRecord, stringValue } from './model-gateway-core.js'

/**
 * Google Gemini `generateContent` → the gateway's chat-shaped input.
 *
 * Only semantics the canonical model request can carry faithfully are
 * accepted. Function calls without ids (older Gemini clients) are paired with
 * their responses by order and name, and given stable ids so tool results and
 * provider continuation state still line up.
 */
const SUPPORTED_FIELDS = new Set(['contents', 'systemInstruction', 'system_instruction', 'tools', 'toolConfig', 'tool_config',
  'generationConfig', 'generation_config', 'safetySettings', 'safety_settings', 'cachedContent', 'labels'])

export function geminiToChatInput(model: string, raw: Record<string, unknown>, stream: boolean): Record<string, unknown> {
  for (const field of Object.keys(raw)) {
    if (!SUPPORTED_FIELDS.has(field)) throw new Error(`Gemini ${field} is not supported by the local gateway`)
  }
  if (raw.cachedContent != null) throw new Error('Gemini cachedContent is not supported by the local gateway')
  const messages: Record<string, unknown>[] = []
  const system = asRecord(raw.systemInstruction ?? raw.system_instruction)
  const systemText = partsText(system.parts, 'systemInstruction')
  if (systemText) messages.push({ role: 'system', content: systemText })
  if (!Array.isArray(raw.contents) || raw.contents.length === 0) throw new Error('contents is required')
  const pending: { id: string; name: string }[] = []
  let generated = 0
  for (const entry of raw.contents) {
    const content = asRecord(entry)
    const role = stringValue(content.role) || 'user'
    if (role !== 'user' && role !== 'model' && role !== 'function') throw new Error(`Gemini role '${role}' is not supported`)
    if (!Array.isArray(content.parts)) throw new Error('Gemini content parts must be an array')
    const textParts: Record<string, unknown>[] = []
    const reasoning: string[] = []
    const toolCalls: Record<string, unknown>[] = []
    const results: Record<string, unknown>[] = []
    for (const value of content.parts) {
      const part = asRecord(value)
      if (typeof part.text === 'string') {
        if (part.thought === true) {
          if (role !== 'model') throw new Error('Gemini thought parts are supported only in model content')
          if (part.text) reasoning.push(part.text)
        } else textParts.push({ type: 'text', text: part.text })
        continue
      }
      if (part.inlineData || part.inline_data) {
        if (role !== 'user') throw new Error('Gemini inline data is supported only in user content')
        const inline = asRecord(part.inlineData ?? part.inline_data)
        const mime = stringValue(inline.mimeType ?? inline.mime_type)
        if (!mime.startsWith('image/') || !stringValue(inline.data)) throw new Error('Gemini inline data must be a base64 image')
        textParts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${String(inline.data)}` } })
        continue
      }
      if (part.functionCall || part.function_call) {
        if (role !== 'model') throw new Error('Gemini functionCall parts are supported only in model content')
        const call = asRecord(part.functionCall ?? part.function_call)
        const name = stringValue(call.name)
        if (!name) throw new Error('Gemini functionCall requires a name')
        const args = call.args ?? {}
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Gemini functionCall args must be an object')
        const id = stringValue(call.id) || `gemini_call_${generated++}_${name}`
        pending.push({ id, name })
        toolCalls.push({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
        continue
      }
      if (part.functionResponse || part.function_response) {
        if (role === 'model') throw new Error('Gemini functionResponse parts must come from the user or function role')
        const response = asRecord(part.functionResponse ?? part.function_response)
        const name = stringValue(response.name)
        const explicit = stringValue(response.id)
        const index = explicit ? pending.findIndex((call) => call.id === explicit) : pending.findIndex((call) => call.name === name)
        if (index < 0) throw new Error('Gemini functionResponse must answer a preceding functionCall')
        const [call] = pending.splice(index, 1)
        results.push({ role: 'tool', tool_call_id: call!.id, name: call!.name, content: JSON.stringify(response.response ?? {}) })
        continue
      }
      if (part.thoughtSignature !== undefined && Object.keys(part).length === 1) continue
      throw new Error(`Gemini part '${Object.keys(part)[0] ?? 'empty'}' is not supported by the local gateway`)
    }
    if (role === 'model') {
      if (textParts.length || toolCalls.length || reasoning.length) {
        messages.push({ role: 'assistant', content: textParts, ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          ...(reasoning.length ? { reasoning_content: reasoning.join('\n') } : {}) })
      }
    } else {
      messages.push(...results)
      if (textParts.length) messages.push({ role: 'user', content: textParts })
    }
  }
  const tools = geminiTools(raw.tools)
  const config = asRecord(raw.generationConfig ?? raw.generation_config)
  const toolConfig = asRecord(asRecord(raw.toolConfig ?? raw.tool_config).functionCallingConfig ??
    asRecord(raw.toolConfig ?? raw.tool_config).function_calling_config)
  const mode = stringValue(toolConfig.mode).toUpperCase()
  const allowed = Array.isArray(toolConfig.allowedFunctionNames) ? toolConfig.allowedFunctionNames : []
  if (mode && !['AUTO', 'ANY', 'NONE', 'VALIDATED'].includes(mode)) throw new Error(`Gemini function calling mode '${mode}' is not supported`)
  if (mode === 'ANY' && allowed.length !== 1) throw new Error('Gemini function calling mode ANY requires exactly one allowed function')
  // topK is a sampling hint Gemini CLI sends on every request; providers without it sample as usual.
  if (config.topK != null && (typeof config.topK !== 'number' || config.topK < 1)) throw new Error('Gemini generationConfig.topK must be a positive number')
  for (const field of ['stopSequences', 'candidateCount', 'responseSchema', 'responseJsonSchema', 'presencePenalty', 'frequencyPenalty', 'seed']) {
    if (config[field] != null && !(field === 'candidateCount' && config[field] === 1)) {
      throw new Error(`Gemini generationConfig.${field} is not supported by the local gateway`)
    }
  }
  const mime = stringValue(config.responseMimeType)
  if (mime && mime !== 'text/plain' && mime !== 'application/json') throw new Error(`Gemini responseMimeType '${mime}' is not supported`)
  return {
    model,
    messages,
    stream,
    tools: mode === 'NONE' ? [] : tools,
    ...(mode === 'ANY' ? { tool_choice: { type: 'function', function: { name: String(allowed[0]) } } } : {}),
    ...(typeof config.maxOutputTokens === 'number' ? { max_tokens: config.maxOutputTokens } : {}),
    ...(typeof config.temperature === 'number' ? { temperature: config.temperature } : {}),
    ...(typeof config.topP === 'number' ? { top_p: config.topP } : {}),
    ...(mime === 'application/json' ? { response_format: { type: 'json_object' } } : {}),
    ...geminiReasoning(asRecord(config.thinkingConfig ?? config.thinking_config))
  }
}

function partsText(parts: unknown, location: string): string {
  if (parts == null) return ''
  if (!Array.isArray(parts)) throw new Error(`Gemini ${location} parts must be an array`)
  return parts.map((value) => {
    const part = asRecord(value)
    if (typeof part.text !== 'string') throw new Error(`Only text parts are supported in Gemini ${location}`)
    return part.text
  }).join('\n')
}

function geminiTools(value: unknown): Record<string, unknown>[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error('Gemini tools must be an array')
  const out: Record<string, unknown>[] = []
  for (const entry of value) {
    const tool = asRecord(entry)
    const keys = Object.keys(tool)
    if (keys.some((key) => key !== 'functionDeclarations' && key !== 'function_declarations')) {
      throw new Error(`Gemini tool '${keys.find((key) => key !== 'functionDeclarations')}' is not supported by the local gateway`)
    }
    const declarations = tool.functionDeclarations ?? tool.function_declarations
    if (!Array.isArray(declarations)) throw new Error('Gemini functionDeclarations must be an array')
    for (const raw of declarations) {
      const declaration = asRecord(raw)
      const parameters = declaration.parametersJsonSchema ?? declaration.parameters ?? { type: 'object', properties: {} }
      out.push({ type: 'function', function: { name: declaration.name, description: declaration.description,
        parameters: normalizeGeminiSchema(parameters) } })
    }
  }
  return out
}

/** Gemini's OpenAPI subset spells types in upper case (`OBJECT`); JSON Schema wants lower case. */
export function normalizeGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeGeminiSchema)
  if (!value || typeof value !== 'object') return value
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = key === 'type' && typeof entry === 'string' ? entry.toLowerCase() : normalizeGeminiSchema(entry)
  }
  return out
}

function geminiReasoning(thinking: Record<string, unknown>): { reasoning_effort?: string } {
  const level = stringValue(thinking.thinkingLevel ?? thinking.thinking_level).toLowerCase()
  if (level) {
    const mapped = ({ minimal: 'low', low: 'low', medium: 'medium', high: 'high' } as Record<string, string>)[level]
    if (!mapped) throw new Error(`Gemini thinkingLevel '${level}' is not supported`)
    return { reasoning_effort: mapped }
  }
  const budget = thinking.thinkingBudget ?? thinking.thinking_budget
  if (typeof budget !== 'number') return {}
  if (budget === 0) return { reasoning_effort: 'off' }
  if (budget < 0) return { reasoning_effort: 'auto' }
  return { reasoning_effort: budget <= 4_096 ? 'low' : budget <= 16_384 ? 'medium' : budget <= 32_768 ? 'high' : 'max' }
}

/** Whether the client asked to see thought summaries. */
export function geminiIncludeThoughts(raw: Record<string, unknown>): boolean {
  const config = asRecord(raw.generationConfig ?? raw.generation_config)
  const thinking = asRecord(config.thinkingConfig ?? config.thinking_config)
  return thinking.includeThoughts === true || thinking.include_thoughts === true
}
