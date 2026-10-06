/**
 * Azure OpenAI resources live at the user's own host. Their v1 API takes the
 * key in `api-key`; a Bearer token on Azure is an Entra ID token, so a key
 * sent as Bearer fails with 401.
 */
const AZURE_OPENAI_HOST_SUFFIXES = ['.openai.azure.com', '.cognitiveservices.azure.com', '.services.ai.azure.com']

export function isAzureOpenAiUrl(url: string | undefined): boolean {
  if (!url) return false
  try {
    const host = new URL(url.trim()).hostname.toLowerCase()
    return AZURE_OPENAI_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length)
  } catch {
    return false
  }
}

/** Default key header for a non-Anthropic request to `url`. */
export function defaultKeyHeader(url: string | undefined, apiKey: string): Record<string, string> {
  return isAzureOpenAiUrl(url) ? { 'api-key': apiKey } : { Authorization: `Bearer ${apiKey}` }
}
