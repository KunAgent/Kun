import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import {
  configureWeixinBridgeRuntimeContextProvider,
  weixinBridgeRuntimeInternals
} from './weixin-bridge-runtime'

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/tmp/deepseek-gui-test-user-data',
    getVersion: () => '0.2.0-test'
  }
}))

const requireFromTest = createRequire(import.meta.url)

describe('weixin bridge runtime', () => {
  it('builds WeChat base_info from the bundled WeChat plugin package', () => {
    const pkg = requireFromTest('@tencent-weixin/openclaw-weixin/package.json') as {
      version: string
    }
    const baseInfo = weixinBridgeRuntimeInternals.buildBaseInfo()

    expect(baseInfo).toMatchObject({
      channel_version: pkg.version,
      bot_agent: 'Kun/0.2.0-test'
    })
  })

  it('keeps OpenClaw-compatible account id normalization for existing WeChat state files', () => {
    const { normalizeAccountId } = weixinBridgeRuntimeInternals

    expect(normalizeAccountId('b0f5860fdecb@im.bot')).toBe('b0f5860fdecb-im-bot')
    expect(normalizeAccountId('ABC@IM.WECHAT')).toBe('abc-im-wechat')
    expect(normalizeAccountId('')).toBe('default')
    expect(normalizeAccountId('__proto__')).toBe('default')
  })

  it('does not expose the removed OpenClaw adapter builders', () => {
    expect(Object.keys(weixinBridgeRuntimeInternals)).not.toContain('buildGuiManagedOpenClawConfig')
    expect(Object.keys(weixinBridgeRuntimeInternals)).not.toContain('buildWeixinBridgeAdapterSource')
    expect(Object.keys(weixinBridgeRuntimeInternals)).not.toContain('parseNodeVersion')
  })

  it('extracts webhook generated files for WeChat media delivery, capped at three', () => {
    const { webhookGeneratedFiles } = weixinBridgeRuntimeInternals

    expect(webhookGeneratedFiles({
      ok: true,
      reply: 'done',
      files: [
        { path: '/ws/.deepseekgui-images/cat.png', fileName: 'cat.png' },
        { path: '/ws/out/report.pdf' },
        { unrelated: true },
        { path: '/ws/a.png' },
        { path: '/ws/b.png' }
      ]
    })).toEqual([
      { path: '/ws/.deepseekgui-images/cat.png', fileName: 'cat.png' },
      { path: '/ws/out/report.pdf', fileName: 'report.pdf' },
      { path: '/ws/a.png', fileName: 'a.png' }
    ])

    expect(webhookGeneratedFiles({ ok: true, reply: 'no files' })).toEqual([])
    expect(webhookGeneratedFiles({ files: 'not-an-array' })).toEqual([])
  })

  it('keeps a webhook failure reply deliverable for WeChat', async () => {
    configureWeixinBridgeRuntimeContextProvider(async () => ({
      webhookUrl: 'http://127.0.0.1:18787/claw/im',
      webhookSecret: 'secret',
      channelId: 'channel_weixin'
    }))
    const responseBody = {
      ok: false,
      message: 'Kun: model request failed: fetch failed',
      reply: 'Kun: model request failed: fetch failed'
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody)
    } as Response)

    try {
      await expect(weixinBridgeRuntimeInternals.postToDeepSeekGuiWebhook({
        message_id: 'wx_msg_1',
        from_user_id: 'wx_user_1',
        item_list: [{ type: 1, text_item: { text: '你好' } }]
      }, 'wx_account_1')).resolves.toMatchObject({
        ok: false,
        reply: 'Kun: model request failed: fetch failed'
      })
    } finally {
      fetchMock.mockRestore()
      configureWeixinBridgeRuntimeContextProvider(null)
    }
  })

  it('requires authentication and returns a rejected contract before dispatch', async () => {
    configureWeixinBridgeRuntimeContextProvider(async () => ({
      webhookUrl: 'http://127.0.0.1:18787/claw/im',
      webhookSecret: 'local-secret',
      channelId: 'channel_weixin'
    }))
    const request = new EventEmitter() as IncomingMessage
    request.headers = {}
    request.push = () => false
    const response = new EventEmitter() as ServerResponse
    let status = 0
    let body = ''
    response.writeHead = vi.fn((nextStatus: number) => {
      status = nextStatus
      return response
    }) as ServerResponse['writeHead']
    response.end = vi.fn((chunk?: unknown) => {
      body += chunk == null ? '' : String(chunk)
      return response
    }) as ServerResponse['end']

    try {
      await weixinBridgeRuntimeInternals.handleLocalSend(request, response)
      expect(status).toBe(401)
      expect(JSON.parse(body)).toEqual({
        status: 'rejected',
        error: { code: 'unauthorized', message: 'Unauthorized.' }
      })
    } finally {
      configureWeixinBridgeRuntimeContextProvider(null)
    }
  })

  it('cancels an in-flight GUI webhook when its account monitor stops', async () => {
    configureWeixinBridgeRuntimeContextProvider(async () => ({
      webhookUrl: 'http://127.0.0.1:18787/claw/im',
      webhookSecret: '',
      channelId: 'channel_weixin'
    }))
    const controller = new AbortController()
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_url, init) => {
        requestSignal = init?.signal as AbortSignal
        return new Promise<Response>((_resolve, reject) => {
          requestSignal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          }, { once: true })
        })
      }
    )

    try {
      const pending = weixinBridgeRuntimeInternals.postToDeepSeekGuiWebhook({
        message_id: 'wx_msg_abort',
        from_user_id: 'wx_user_abort',
        item_list: [{ type: 1, text_item: { text: '停止测试' } }]
      }, 'wx_account_1', controller.signal)
      await vi.waitFor(() => expect(requestSignal).toBeDefined())
      controller.abort()

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      expect(requestSignal?.aborted).toBe(true)
    } finally {
      fetchMock.mockRestore()
      configureWeixinBridgeRuntimeContextProvider(null)
    }
  })
})
