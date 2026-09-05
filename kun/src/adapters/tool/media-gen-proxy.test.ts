import { mkdirSync } from 'node:fs'
import { describe, expect, it, vi, beforeEach } from 'vitest'

const createProxyFetchMock = vi.fn()

vi.mock('../model/proxy-fetch.js', () => ({
  createProxyFetch: (proxyUrl: string) => createProxyFetchMock(proxyUrl)
}))

const createImageGenClientMock = vi.fn()

vi.mock('./image-gen-clients.js', () => ({
  createImageGenClient: (config: unknown) => createImageGenClientMock(config)
}))

const { createSpeechGenClient, createMusicGenClient } = await import('./media-gen-speech-clients.js')
const { createVideoGenClient } = await import('./media-gen-video-clients.js')
const { createMediaFetch } = await import('./media-gen-client-support.js')
const { buildImageGenToolProviders } = await import('./image-gen-tool-provider.js')
const { buildSpeechGenToolProviders } = await import('./media-gen-tool-provider.js')

const fakeGeneratedImage = {
  // Smallest detectable PNG payload so detectImage() accepts it and the tool
  // reaches its file-write success path during execute().
  data: Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(24)
  ]),
  mimeType: 'image/png'
}

const fakeClient = {
  id: 'fake-image-provider',
  generate: async () => fakeGeneratedImage,
  edit: async () => fakeGeneratedImage
}

const imageGenConfigDefaults = {
  defaultResolution: '1K' as const,
  quality: 'auto' as const,
  timeoutMs: 30_000,
  maxReferenceImages: 4
}

describe('media generation proxy fetch wiring', () => {
  beforeEach(() => {
    createProxyFetchMock.mockReset()
    createImageGenClientMock.mockReset()
    createImageGenClientMock.mockReturnValue(fakeClient)
  })

  it('routes media fetch through createProxyFetch when a proxy is configured', () => {
    const proxiedFetch = vi.fn()
    createProxyFetchMock.mockReturnValueOnce(proxiedFetch)

    expect(createMediaFetch('http://proxy.lan:8080')).toBe(proxiedFetch)
    expect(createProxyFetchMock).toHaveBeenCalledWith('http://proxy.lan:8080')
  })

  it('falls back to global fetch when no proxy is configured', () => {
    createProxyFetchMock.mockReturnValue(null)

    expect(createMediaFetch(undefined)).toBe(fetch)
    expect(createMediaFetch('')).toBe(fetch)
    expect(createMediaFetch('   ')).toBe(fetch)
    expect(createProxyFetchMock).toHaveBeenCalledTimes(3)
  })

  it('passes the proxy URL into every speech/music/video client factory', () => {
    const proxyUrl = 'http://proxy.lan:8080'
    const base = { baseUrl: 'https://api.example.test/v1', apiKey: 'sk', proxyUrl }
    createSpeechGenClient({ ...base })
    createSpeechGenClient({ ...base, protocol: 'minimax-t2a' })
    createSpeechGenClient({ ...base, protocol: 'mimo-tts' })
    createMusicGenClient({ ...base })
    createVideoGenClient({ ...base })
    createVideoGenClient({ ...base, protocol: 'grok-imagine-video' })
    createVideoGenClient({ ...base, protocol: 'volcengine-ark-video' })

    expect(createProxyFetchMock).toHaveBeenCalledTimes(7)
    for (const call of createProxyFetchMock.mock.calls) {
      expect(call[0]).toBe(proxyUrl)
    }
  })

  it('forwards the credential proxy URL to the image client factory', async () => {
    const { providers, available } = buildImageGenToolProviders({
      ...imageGenConfigDefaults,
      enabled: true,
      protocol: 'openai-images',
      baseUrl: 'https://images.example.test/v1',
      model: 'test-model',
      providerId: 'prov-1'
    }, {
      resolveCredential: async () => ({
        apiKey: 'sk-test',
        proxyUrl: 'http://proxy.lan:8080'
      })
    })

    expect(available).toBe(true)
    const tool = providers[0].tools.find((candidate) => candidate.name === 'generate_image')
    expect(tool).toBeTruthy()

    const result = await tool!.execute({ prompt: 'a cat' }, minimalContext())
    expect(result.isError).toBeFalsy()

    expect(createImageGenClientMock).toHaveBeenCalledTimes(1)
    const clientConfig = createImageGenClientMock.mock.calls[0][0] as Record<string, unknown>
    expect(clientConfig.proxyUrl).toBe('http://proxy.lan:8080')
    expect(clientConfig.apiKey).toBe('sk-test')
  })

  it('omits proxyUrl when the credential carries no proxy', async () => {
    const { providers } = buildImageGenToolProviders({
      ...imageGenConfigDefaults,
      enabled: true,
      protocol: 'openai-images',
      baseUrl: 'https://images.example.test/v1',
      model: 'test-model',
      providerId: 'prov-1'
    }, {
      resolveCredential: async () => ({ apiKey: 'sk-test' })
    })

    const tool = providers[0].tools.find((candidate) => candidate.name === 'generate_image')
    await tool!.execute({ prompt: 'a cat' }, minimalContext())

    const clientConfig = createImageGenClientMock.mock.calls[0][0] as Record<string, unknown>
    expect(clientConfig).not.toHaveProperty('proxyUrl')
  })

  it('falls back to the provider-level proxy for inline image configs without a providerId', async () => {
    const { providers, available } = buildImageGenToolProviders({
      ...imageGenConfigDefaults,
      enabled: true,
      protocol: 'openai-images',
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'sk-inline',
      model: 'test-model'
    }, {
      proxyUrl: 'http://proxy.lan:8080'
    })

    expect(available).toBe(true)
    const tool = providers[0].tools.find((candidate) => candidate.name === 'generate_image')
    const result = await tool!.execute({ prompt: 'a cat' }, minimalContext())
    expect(result.isError).toBeFalsy()

    const clientConfig = createImageGenClientMock.mock.calls[0][0] as Record<string, unknown>
    expect(clientConfig.proxyUrl).toBe('http://proxy.lan:8080')
    expect(clientConfig.apiKey).toBe('sk-inline')
  })

  it('prefers the resolved credential proxy over the provider-level fallback', async () => {
    const { providers } = buildImageGenToolProviders({
      ...imageGenConfigDefaults,
      enabled: true,
      protocol: 'openai-images',
      baseUrl: 'https://images.example.test/v1',
      model: 'test-model',
      providerId: 'prov-1'
    }, {
      proxyUrl: 'http://fallback.lan:8080',
      resolveCredential: async () => ({
        apiKey: 'sk-test',
        proxyUrl: 'http://proxy.lan:8080'
      })
    })

    const tool = providers[0].tools.find((candidate) => candidate.name === 'generate_image')
    await tool!.execute({ prompt: 'a cat' }, minimalContext())

    const clientConfig = createImageGenClientMock.mock.calls[0][0] as Record<string, unknown>
    expect(clientConfig.proxyUrl).toBe('http://proxy.lan:8080')
  })

  it('honors a connection that explicitly bypasses the proxy instead of falling back', async () => {
    const { providers } = buildImageGenToolProviders({
      ...imageGenConfigDefaults,
      enabled: true,
      protocol: 'openai-images',
      baseUrl: 'https://images.example.test/v1',
      model: 'test-model',
      providerId: 'prov-direct'
    }, {
      proxyUrl: 'http://fallback.lan:8080',
      resolveCredential: async () => ({ apiKey: 'sk-test' })
    })

    const tool = providers[0].tools.find((candidate) => candidate.name === 'generate_image')
    await tool!.execute({ prompt: 'a cat' }, minimalContext())

    const clientConfig = createImageGenClientMock.mock.calls[0][0] as Record<string, unknown>
    expect(clientConfig).not.toHaveProperty('proxyUrl')
  })

  it('falls back to the provider-level proxy for inline speech configs without a providerId', async () => {
    createProxyFetchMock.mockReturnValue(async () => {
      throw new Error('proxied fetch invoked')
    })
    const { providers, available } = buildSpeechGenToolProviders({
      enabled: true,
      protocol: 'openai-speech',
      baseUrl: 'https://speech.example.test/v1',
      apiKey: 'sk-inline',
      model: 'tts-test',
      format: 'mp3',
      timeoutMs: 30_000
    }, {
      proxyUrl: 'http://proxy.lan:8080'
    })

    expect(available).toBe(true)
    const tool = providers[0].tools.find((candidate) => candidate.name === 'generate_speech')
    const result = await tool!.execute({ text: 'hello' }, minimalContext())
    expect(result.isError).toBe(true)

    expect(createProxyFetchMock).toHaveBeenCalledWith('http://proxy.lan:8080')
  })
})

function minimalContext(): Parameters<
  ReturnType<typeof buildImageGenToolProviders>['providers'][number]['tools'][number]['execute']
>[1] {
  // The workspace must actually exist on disk: resolveWorkspacePath() follows
  // symlinks and rejects paths whose root cannot be resolved.
  const workspace = '/tmp/kun-media-proxy-test'
  mkdirSync(workspace, { recursive: true })
  return {
    abortSignal: new AbortController().signal,
    workspace,
    workspaceRoot: workspace,
    workingDirectory: workspace
  } as unknown as Parameters<
    ReturnType<typeof buildImageGenToolProviders>['providers'][number]['tools'][number]['execute']
  >[1]
}
