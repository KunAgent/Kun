import type { WeixinMessage } from './weixin-bridge-state'

type Handler = (message: WeixinMessage, accountId: string) => Promise<boolean>
let handler: Handler | undefined
export function setPrivateAgentWeixinHandler(next: Handler | undefined): void { handler = next }
export async function routePrivateAgentWeixin(message: WeixinMessage, accountId: string): Promise<boolean> {
  return await handler?.(message, accountId) ?? false
}
export function officialWeixinApiUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['weixin.qq.com', 'wechat.com'].some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain))) {
    throw new Error('WeChat authorization returned an unsupported API host')
  }
  return url.toString()
}
