import { afterEach, expect, it, vi } from 'vitest'
import { officialWeixinApiUrl, routePrivateAgentWeixin, setPrivateAgentWeixinHandler } from './personal-agent-weixin-boundary'
afterEach(() => setPrivateAgentWeixinHandler(undefined))
it('allows only official HTTPS WeChat API hosts', () => {
  expect(officialWeixinApiUrl('https://ilinkai.weixin.qq.com')).toBe('https://ilinkai.weixin.qq.com/')
  expect(officialWeixinApiUrl('https://ilinkai.wechat.com')).toBe('https://ilinkai.wechat.com/')
  for (const url of ['http://ilinkai.weixin.qq.com', 'https://weixin.qq.com.evil.test', 'https://user:secret@ilinkai.weixin.qq.com', 'https://localhost', 'https://ilinkai.weixin.qq.com:1234']) {
    expect(() => officialWeixinApiUrl(url)).toThrow()
  }
})
it('stops routing after the owner service exits', async () => {
  const handle = vi.fn(async () => true)
  setPrivateAgentWeixinHandler(handle)
  expect(await routePrivateAgentWeixin({}, 'official-account')).toBe(true)
  setPrivateAgentWeixinHandler(undefined)
  expect(await routePrivateAgentWeixin({}, 'official-account')).toBe(false)
  expect(handle).toHaveBeenCalledTimes(1)
})
