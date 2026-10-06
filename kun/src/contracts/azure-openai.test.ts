import { describe, expect, it } from 'vitest'
import { buildCompatRequestHeaders } from '../adapters/model/compat-http-diagnostics.js'
import { providerAuthenticationHeaders } from '../services/provider-request-security.js'
import { isAzureOpenAiUrl } from './azure-openai.js'

describe('Azure OpenAI key header', () => {
  it('recognizes resource hosts only', () => {
    expect(isAzureOpenAiUrl('https://acme.openai.azure.com/openai/v1')).toBe(true)
    expect(isAzureOpenAiUrl('https://acme.cognitiveservices.azure.com/openai/v1')).toBe(true)
    expect(isAzureOpenAiUrl('https://openai.azure.com/openai/v1')).toBe(false)
    expect(isAzureOpenAiUrl('https://evil.example/openai.azure.com')).toBe(false)
    expect(isAzureOpenAiUrl('not a url')).toBe(false)
  })
  it('replaces Bearer with api-key for inference and discovery', () => {
    const inference = buildCompatRequestHeaders({ apiKey: 'k', stream: true, endpointFormat: 'responses',
      requestUrl: 'https://acme.openai.azure.com/openai/v1' })
    expect(inference['api-key']).toBe('k')
    expect(inference.Authorization).toBeUndefined()
    const discovery = providerAuthenticationHeaders({ apiKey: 'k', protocol: 'responses', purpose: 'discovery',
      requestUrl: 'https://acme.openai.azure.com/openai/v1/models', fallbackUrls: ['https://acme.openai.azure.com/openai/v1'] })
    expect(discovery).toEqual({ 'api-key': 'k' })
    expect(buildCompatRequestHeaders({ apiKey: 'k', stream: true, endpointFormat: 'chat_completions' }).Authorization).toBe('Bearer k')
  })
})
