import { shellQuote } from '@shared/gateway-client-setup'
import type { TFunction } from 'i18next'
import {
  buildGatewayCurlExample,
  buildGatewayMessagesCurlExample,
  buildGatewayResponsesCurlExample
} from './settings-section-model-routes-support'

export type GatewayConnectFormat = 'chat' | 'responses' | 'anthropic' | 'gemini'
export type GatewayExampleKind = 'shell' | 'curl' | 'python' | 'node'

export const GATEWAY_CONNECT_FORMATS: readonly GatewayConnectFormat[] = ['chat', 'responses', 'anthropic', 'gemini']
export const GATEWAY_EXAMPLE_KINDS: readonly GatewayExampleKind[] = ['shell', 'curl', 'python', 'node']

/** The key is never in the renderer; every snippet names where to paste it. */
export const GATEWAY_KEY_PLACEHOLDER = '<LOCAL_GATEWAY_API_KEY>'

/** The variables a tool of this family reads for its address and key. */
export function gatewayConnectEnv(format: GatewayConnectFormat): { baseUrl: string; key: string } {
  switch (format) {
    case 'anthropic': return { baseUrl: 'ANTHROPIC_BASE_URL', key: 'ANTHROPIC_AUTH_TOKEN' }
    case 'gemini': return { baseUrl: 'GOOGLE_GEMINI_BASE_URL', key: 'GEMINI_API_KEY' }
    default: return { baseUrl: 'OPENAI_BASE_URL', key: 'OPENAI_API_KEY' }
  }
}

/**
 * The base URL a client of this family expects: OpenAI clients take the `/v1`
 * prefix, Anthropic and Gemini clients append their own versioned paths.
 */
export function gatewayConnectBaseUrl(origin: string, format: GatewayConnectFormat): string {
  const root = origin.replace(/\/+$/, '').replace(/\/v1$/, '')
  return format === 'chat' || format === 'responses' ? `${root}/v1` : root
}

function quoted(value: string): string {
  return JSON.stringify(value)
}

function shellExample(format: GatewayConnectFormat, baseUrl: string, modelId: string): string {
  const env = gatewayConnectEnv(format)
  const lines = [`export ${env.baseUrl}=${shellQuote(baseUrl)}`, `export ${env.key}=${shellQuote(GATEWAY_KEY_PLACEHOLDER)}`]
  if (format === 'anthropic') lines.push(`export ANTHROPIC_MODEL=${shellQuote(modelId)}`)
  return lines.join('\n')
}

function geminiCurl(baseUrl: string, modelId: string): string {
  return [`curl --request POST ${shellQuote(`${baseUrl}/v1beta/models/${modelId}:generateContent`)}`,
    `  --header ${shellQuote(`x-goog-api-key: ${GATEWAY_KEY_PLACEHOLDER}`)}`,
    "  --header 'Content-Type: application/json'",
    `  --data ${shellQuote(JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Hello' }] }] }, null, 2))}`].join(' \\\n')
}

function pythonExample(format: GatewayConnectFormat, baseUrl: string, modelId: string): string {
  const key = quoted(GATEWAY_KEY_PLACEHOLDER)
  const model = quoted(modelId)
  switch (format) {
    case 'chat': return ['from openai import OpenAI', '',
      `client = OpenAI(base_url=${quoted(baseUrl)}, api_key=${key})`,
      'reply = client.chat.completions.create(',
      `    model=${model},`,
      '    messages=[{"role": "user", "content": "Hello"}],',
      ')', 'print(reply.choices[0].message.content)'].join('\n')
    case 'responses': return ['from openai import OpenAI', '',
      `client = OpenAI(base_url=${quoted(baseUrl)}, api_key=${key})`,
      `reply = client.responses.create(model=${model}, input="Hello")`,
      'print(reply.output_text)'].join('\n')
    case 'anthropic': return ['from anthropic import Anthropic', '',
      `client = Anthropic(base_url=${quoted(baseUrl)}, api_key=${key})`,
      'reply = client.messages.create(',
      `    model=${model},`,
      '    max_tokens=256,',
      '    messages=[{"role": "user", "content": "Hello"}],',
      ')', 'print(reply.content[0].text)'].join('\n')
    case 'gemini': return ['from google import genai', 'from google.genai import types', '',
      `client = genai.Client(api_key=${key}, http_options=types.HttpOptions(base_url=${quoted(baseUrl)}))`,
      `reply = client.models.generate_content(model=${model}, contents="Hello")`,
      'print(reply.text)'].join('\n')
  }
}

function nodeExample(format: GatewayConnectFormat, baseUrl: string, modelId: string): string {
  const key = quoted(GATEWAY_KEY_PLACEHOLDER)
  const model = quoted(modelId)
  switch (format) {
    case 'chat': return ["import OpenAI from 'openai'", '',
      `const client = new OpenAI({ baseURL: ${quoted(baseUrl)}, apiKey: ${key} })`,
      'const reply = await client.chat.completions.create({',
      `  model: ${model},`,
      "  messages: [{ role: 'user', content: 'Hello' }]",
      '})', 'console.log(reply.choices[0].message.content)'].join('\n')
    case 'responses': return ["import OpenAI from 'openai'", '',
      `const client = new OpenAI({ baseURL: ${quoted(baseUrl)}, apiKey: ${key} })`,
      `const reply = await client.responses.create({ model: ${model}, input: 'Hello' })`,
      'console.log(reply.output_text)'].join('\n')
    case 'anthropic': return ["import Anthropic from '@anthropic-ai/sdk'", '',
      `const client = new Anthropic({ baseURL: ${quoted(baseUrl)}, apiKey: ${key} })`,
      'const reply = await client.messages.create({',
      `  model: ${model},`,
      '  max_tokens: 256,',
      "  messages: [{ role: 'user', content: 'Hello' }]",
      '})', 'console.log(reply.content)'].join('\n')
    case 'gemini': return ["import { GoogleGenAI } from '@google/genai'", '',
      `const ai = new GoogleGenAI({ apiKey: ${key}, httpOptions: { baseUrl: ${quoted(baseUrl)} } })`,
      `const reply = await ai.models.generateContent({ model: ${model}, contents: 'Hello' })`,
      'console.log(reply.text)'].join('\n')
  }
}

/** A copyable snippet that points one kind of client at the gateway. */
export function buildGatewayConnectExample(input: {
  format: GatewayConnectFormat
  kind: GatewayExampleKind
  origin: string
  modelId: string
  t: TFunction
}): string {
  const baseUrl = gatewayConnectBaseUrl(input.origin, input.format)
  const v1 = gatewayConnectBaseUrl(input.origin, 'chat')
  switch (input.kind) {
    case 'shell': return shellExample(input.format, baseUrl, input.modelId)
    case 'python': return pythonExample(input.format, baseUrl, input.modelId)
    case 'node': return nodeExample(input.format, baseUrl, input.modelId)
    case 'curl':
      if (input.format === 'anthropic') return buildGatewayMessagesCurlExample(v1, input.modelId)
      if (input.format === 'responses') return buildGatewayResponsesCurlExample(v1, input.modelId, input.t)
      if (input.format === 'gemini') return geminiCurl(baseUrl, input.modelId)
      return buildGatewayCurlExample(v1, input.modelId, input.t)
  }
}
