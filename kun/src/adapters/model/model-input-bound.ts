type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value)
  ? value as RecordValue : {}
const media = new Set(['image_url', 'input_image', 'input_audio', 'image', 'audio', 'file', 'input_file', 'document', 'computer_screenshot'])

/** Inspect wire content, never arbitrary function arguments or JSON schemas. */
export function modelInputHasNoTextBound(body: RecordValue): boolean {
  if (body.previous_response_id !== undefined || body.encrypted_content !== undefined) return true
  const content = (value: unknown): boolean => {
    if (!Array.isArray(value)) return false
    return value.some((item) => {
      const part = record(item)
      if (media.has(String(part.type)) || part.encrypted_content !== undefined) return true
      if (part.type === 'message' || part.type === 'tool_result') return content(part.content)
      if (part.type === 'function_call_output') return content(part.output)
      return false
    })
  }
  if (content(body.input)) return true
  if (Array.isArray(body.messages) && body.messages.some((message) => content(record(message).content))) return true
  return Array.isArray(body.tools) && body.tools.some((tool) => {
    const type = String(record(tool).type ?? '')
    return /^(?:web_search|computer|code_interpreter|code_execution|image_generation)/.test(type)
  })
}
